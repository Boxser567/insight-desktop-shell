import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { proxyErrorCode, SkillProxyError, type SkillProxyRequest } from './skill-proxy-http';

const MAX_REQUEST = 2 * 1024 * 1024;


/** Script bridge, deliberately NOT an LLM tool or a public Web route.
 * A per-launch capability is stored in a private local descriptor. User tokens
 * are obtained through private main-process IPC and are never returned to scripts.
 */
export async function startSkillProxy(
  requestRawStream: SkillProxyRequest,
  home: string,
): Promise<() => Promise<void>> {
  const capability = randomBytes(32).toString('hex');
  const directory = join(home, 'skill-proxy');
  const descriptor = join(directory, 'connection.json');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const controllers = new Set<AbortController>();
  let expectedHost = '';
  const server = createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const controller = new AbortController();
    controllers.add(controller);
    res.on('close', () => controller.abort());
    const fail = (status: number, code: string) => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: { code } }));
    };
    try {
      // Block browser CSRF, DNS rebinding and non-capability clients. No CORS.
      const provided = req.headers.authorization ?? '';
      const expected = `Bearer ${capability}`;
      if (req.headers.origin || req.headers['sec-fetch-site'] || req.headers.host !== expectedHost
        || Buffer.byteLength(provided) !== Buffer.byteLength(expected)
        || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
        fail(403, 'LOCAL_PROXY_FORBIDDEN'); return;
      }
      const match = /^\/proxy\/([a-z][a-z0-9-]{0,63})$/.exec(req.url ?? '');
      if (req.method !== 'POST' || !match || !req.headers['content-type']?.startsWith('application/json')) {
        fail(400, 'INVALID_PROXY_REQUEST'); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > MAX_REQUEST) { fail(413, 'REQUEST_TOO_LARGE'); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString('utf8');
      try { JSON.parse(body); } catch { fail(400, 'INVALID_JSON'); return; }
      // No retry: a paid upstream operation may already have been accepted.
      const response = await requestRawStream(`/api/skill-proxy/${match[1]}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body, signal: controller.signal, redirect: 'error',
      });
      if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
        // Gateway can report expired login in a JSON envelope with HTTP 200.
        const code = await proxyErrorCode(response);
        fail(code === 'USER_NOT_LOGIN' ? 401 : 502,
          code === 'USER_NOT_LOGIN' ? 'LOGIN_REQUIRED' : 'SKILL_PROXY_PROTOCOL_MISMATCH');
        return;
      }
      res.writeHead(response.status, {
        'content-type': response.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store', 'x-accel-buffering': 'no',
      });
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (!controller.signal.aborted) {
            const item = await reader.read();
            if (item.done) break;
            if (!res.write(Buffer.from(item.value))) {
              await new Promise<void>((resolve) => {
                const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
                res.once('drain', done); res.once('close', done);
              });
            }
          }
        } finally { await reader.cancel().catch(() => undefined); }
      }
      res.end();
    } catch (error) {
      // Never echo upstream bodies, tokens, paths or request headers on failure.
      const status = error instanceof SkillProxyError ? error.status : 502;
      const code = error instanceof SkillProxyError && /^(SKILL_|INVALID_|CLIENT_|MEDIA_|MESSAGES_|SIGNED_)[A-Z0-9_]{1,70}$/.test(error.code)
        ? error.code : 'SKILL_PROXY_FAILED';
      fail(status, status === 401 ? 'LOGIN_REQUIRED' : code);
    } finally { controllers.delete(controller); }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Skill proxy did not start');
  expectedHost = `127.0.0.1:${address.port}`;
  try {
    const temporary = `${descriptor}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, url: `http://${expectedHost}`, capability }), { mode: 0o600 });
    await rename(temporary, descriptor);
  } catch (error) { server.close(); throw error; }
  return async () => {
    controllers.forEach((controller) => controller.abort());
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Another profile may have replaced the descriptor; never remove its file.
    try {
      const current = JSON.parse(await readFile(descriptor, 'utf8'));
      if (current.capability === capability) await rm(descriptor, { force: true });
    } catch { /* already cleaned */ }
  };
}
