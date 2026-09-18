import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startSkillProxy } from '../packages/insight-desktop-integration/src/skill-proxy';
import { SkillProxyError } from '../packages/insight-desktop-integration/src/skill-proxy-http';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of cleanup.reverse()) await stop(); cleanup.length = 0; });


async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'skill-proxy-test-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const requestRawStream = vi.fn(async () => new Response(
    '{"type":"accepted"}\n{"type":"result","status":200,"body":{"ok":true}}\n',
    { headers: { 'content-type': 'application/x-ndjson' } },
  ));
  const stop = await startSkillProxy(requestRawStream, home);
  cleanup.push(stop);
  const path = join(home, 'skill-proxy', 'connection.json');
  return { home, path, requestRawStream, ...JSON.parse(await readFile(path, 'utf8')) };
}

it('forwards only to enterprise API with no capability in upstream headers', async () => {
  const fixture = await setup();
  const response = await fetch(fixture.url + '/proxy/tikhub', { method: 'POST', headers: {
    'content-type': 'application/json', authorization: 'Bearer ' + fixture.capability,
  }, body: JSON.stringify({ method: 'GET', path: '/api/v1/search' }) });
  expect(await response.text()).toContain('"ok":true');
  expect(fixture.requestRawStream).toHaveBeenCalledTimes(1);
  const [path, init] = fixture.requestRawStream.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe('/api/skill-proxy/tikhub');
  expect(JSON.stringify(init)).not.toContain(fixture.capability);
  if (process.platform !== 'win32') expect((await stat(fixture.path)).mode & 0o777).toBe(0o600);
});

it('rejects absent capability, browser origin, bad host, URL injection, malformed and large JSON', async () => {
  const fixture = await setup();
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + fixture.capability };
  const rejectedHeaders: Record<string, string>[] = [
    { authorization: 'Bearer wrong' }, { origin: 'http://evil.example' }, { 'sec-fetch-site': 'same-origin' },
  ];
  for (const change of rejectedHeaders) {
    const response = await fetch(fixture.url + '/proxy/tikhub', { method: 'POST', headers: { ...headers, ...change }, body: '{}' });
    expect(response.status, JSON.stringify(change)).toBe(403);
  }
  // fetch replaces Host; use raw HTTP to actually exercise DNS rebinding.
  const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(fixture.url + '/proxy/tikhub', { method: 'POST', headers: { ...headers, host: 'evil.example' } },
      (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end('{}');
  });
  expect(hostStatus).toBe(403);
  expect((await fetch(fixture.url + '/proxy/tikhub?url=evil', { method: 'POST', headers, body: '{}' })).status).toBe(400);
  expect((await fetch(fixture.url + '/proxy/tikhub', { method: 'POST', headers, body: '{' })).status).toBe(400);
  expect((await fetch(fixture.url + '/proxy/tikhub', { method: 'POST', headers, body: ' '.repeat(2 * 1024 * 1024 + 1) })).status).toBe(413);
  expect(fixture.requestRawStream).not.toHaveBeenCalled();
});

it('fails closed after logout and does not retry', async () => {
  const fixture = await setup();
  fixture.requestRawStream.mockRejectedValue(new SkillProxyError(401, 'LOGIN_REQUIRED'));
  const response = await fetch(fixture.url + '/proxy/tikhub', { method: 'POST', headers: {
    'content-type': 'application/json', authorization: 'Bearer ' + fixture.capability,
  }, body: '{}' });
  expect(response.status).toBe(401);
  expect(await response.text()).toContain('LOGIN_REQUIRED');
  expect(fixture.requestRawStream).toHaveBeenCalledTimes(1);
});

it('runs the distributed JavaScript client using bundled Node with empty PATH and no user token', async () => {
  const fixture = await setup();
  const node = resolve('build/core-runtime/node_modules/node', process.platform === 'win32' ? 'bin/node.exe' : 'bin/node');
  const { stdout, stderr } = await promisify(execFile)(node, [
    'packages/insight-desktop-integration/resources/skill-proxy-client.mjs', 'tikhub', 'POST', '/api/v1/douyin/search/fetch_general_search_v2',
    '--body', '{"keyword":"家居"}',
  ], { env: { PATH: '', DSH_HOME: fixture.home, HTTP_PROXY: 'http://127.0.0.1:1' } });
  expect(JSON.parse(stdout)).toEqual({ ok: true });
  expect(stderr).toBe('');
  const [, init] = fixture.requestRawStream.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string).body).toEqual({ keyword: '家居' });
});

it('preserves safe configuration errors and recognizes Gateway HTTP-200 login failures', async () => {
  const fixture = await setup();
  const init = { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + fixture.capability }, body: '{}' };
  fixture.requestRawStream.mockRejectedValueOnce(new SkillProxyError(503, 'SKILL_PROXY_CREDENTIAL_MISSING'));
  let response = await fetch(fixture.url + '/proxy/tikhub', init);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: 'SKILL_PROXY_CREDENTIAL_MISSING' } });
  fixture.requestRawStream.mockResolvedValueOnce(new Response('{"code":"USER_NOT_LOGIN"}', { headers: { 'content-type': 'application/json' } }));
  response = await fetch(fixture.url + '/proxy/tikhub', init);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: { code: 'LOGIN_REQUIRED' } });
});
