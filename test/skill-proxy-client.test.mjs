import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { request } from '../packages/insight-desktop-integration/resources/skill-proxy-client.mjs';

const cleanup = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const fn of cleanup.reverse()) await fn();
  cleanup.length = 0;
});

async function setup(handler) {
  const home = await mkdtemp(join(tmpdir(), 'skill js 中文-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await mkdir(join(home, 'skill-proxy'), { mode: 0o700 });
  const file = join(home, 'skill-proxy/connection.json');
  const descriptor = { version: 1, url: `http://127.0.0.1:${server.address().port}`, capability: 'a'.repeat(64) };
  await writeFile(file, JSON.stringify(descriptor), { mode: 0o600 });
  vi.stubEnv('DSH_HOME', home);
  return { home, file, descriptor };
}

const result = (status = 200, body = { message: '中文 🐕' }) => JSON.stringify({ type: 'result', status, body }) + '\n';
const ndjson = res => res.writeHead(200, { 'content-type': 'application/x-ndjson' });

it('decodes UTF-8 across chunks, skips heartbeats and returns original JSON', async () => {
  await setup((req, res) => {
    expect(req.url).toBe('/proxy/tikhub');
    expect(req.headers.authorization).toBe('Bearer ' + 'a'.repeat(64));
    ndjson(res);
    const bytes = Buffer.from('{"type":"accepted"}\n{"type":"heartbeat"}\n' + result());
    // Force a network flush inside a multibyte Chinese character.
    const cut = bytes.indexOf(Buffer.from('中文')) + 1;
    res.write(bytes.subarray(0, cut));
    setTimeout(() => res.end(bytes.subarray(cut)), 5);
  });
  expect(await request('tikhub', 'GET', '/path')).toEqual({ message: '中文 🐕' });
});

it('preserves upstream errors without retrying', async () => {
  let calls = 0;
  await setup((_req, res) => { calls++; ndjson(res); res.end(result(429, { code: 'QUOTA' })); });
  await expect(request('tikhub', 'GET', '/path')).rejects.toMatchObject({ status: 429, body: { code: 'QUOTA' } });
  expect(calls).toBe(1);
});

it.each([
  ['{broken}\n', 'INVALID_PROXY_RESPONSE'],
  ['null\n', 'INVALID_PROXY_RESPONSE'],
  ['{"type":"heartbeat"}\n', 'PROXY_DISCONNECTED_OUTCOME_UNKNOWN'],
  ['{"type":"result","body":{}}\n', 'INVALID_PROXY_RESPONSE'],
  ['{"type":"error","code":"SKILL_PROXY_CREDENTIAL_MISSING","status":503}\n', 'SKILL_PROXY_CREDENTIAL_MISSING'],
])('reports invalid/incomplete/error NDJSON (%s)', async (body, code) => {
  await setup((_req, res) => { ndjson(res); res.end(body); });
  await expect(request('tikhub', 'GET', '/path')).rejects.toMatchObject({ code });
});

it('never forwards local capability to redirect destinations', async () => {
  let calls = 0;
  await setup((_req, res) => {
    calls++; res.writeHead(302, { location: '/must-not-follow' }); res.end('redirect');
  });
  await expect(request('tikhub', 'GET', '/path')).rejects.toMatchObject({ code: 'PROXY_HTTP_ERROR', status: 302 });
  expect(calls).toBe(1);
});

it('preserves safe HTTP errors and rejects HTML success responses', async () => {
  let calls = 0;
  await setup((_req, res) => {
    if (calls++ === 0) { res.writeHead(401); res.end('{"error":{"code":"LOGIN_REQUIRED"}}'); }
    else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('private HTML'); }
  });
  await expect(request('tikhub', 'GET', '/path')).rejects.toMatchObject({ code: 'LOGIN_REQUIRED', status: 401 });
  await expect(request('tikhub', 'GET', '/path')).rejects.toMatchObject({ code: 'INVALID_PROXY_RESPONSE' });
});

it('enforces a total deadline even with continuing heartbeat data', async () => {
  let calls = 0;
  await setup((_req, res) => {
    calls++; ndjson(res);
    const timer = setInterval(() => res.write('{"type":"heartbeat"}\n'), 5);
    res.on('close', () => clearInterval(timer));
  });
  await expect(request('tikhub', 'GET', '/path', { timeout: 0.08 })).rejects.toMatchObject({ code: 'PROXY_TIMEOUT_OUTCOME_UNKNOWN', status: 504 });
  expect(calls).toBe(1);
});

it('enforces request/response bounds', async () => {
  let calls = 0;
  await setup((_req, res) => { calls++; ndjson(res); res.end('x'.repeat(9 * 1024 * 1024 + 1)); });
  await expect(request('tikhub', 'POST', '/path', { body: 'x'.repeat(2 * 1024 * 1024) })).rejects.toMatchObject({ status: 413 });
  expect(calls).toBe(0);
  await expect(request('tikhub', 'GET', '/path')).rejects.toMatchObject({ code: 'PROXY_RESPONSE_TOO_LARGE' });
});

it('refuses missing home, unsafe file modes and non-loopback descriptors', async () => {
  const fixture = await setup((_req, res) => res.end());
  if (process.platform !== 'win32') {
    await chmod(fixture.file, 0o644);
    await expect(request('tikhub', 'GET', '/path')).rejects.toMatchObject({ code: 'UNSAFE_LOCAL_PROXY_DESCRIPTOR' });
    await chmod(fixture.file, 0o600);
  }
  await writeFile(fixture.file, JSON.stringify({ ...fixture.descriptor, url: 'http://example.com:80' }));
  await expect(request('tikhub', 'GET', '/path')).rejects.toMatchObject({ code: 'LOCAL_PROXY_UNAVAILABLE' });
  vi.stubEnv('DSH_HOME', '');
  await expect(request('tikhub', 'GET', '/path')).rejects.toMatchObject({ code: 'DSH_HOME_MISSING' });
});
