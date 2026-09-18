import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createModelCredentialClient, parentCredentialTransport } from './lib/model-credential-client.mjs'
import { createSkillProxyRequest } from './lib/skill-proxy-http.mjs'
import { startSkillProxy } from './lib/skill-proxy.mjs'
import { registerSkillProxyEnvironment, skillProxyRuntimePaths } from './lib/skill-proxy-environment.mjs'

const credentials = createModelCredentialClient(parentCredentialTransport())
const paths = skillProxyRuntimePaths()
assert.equal(paths.node, process.env.INSIGHT_BUNDLED_NODE_PATH)
if (process.versions.electron) assert.notEqual(paths.node, process.execPath)
// Exercise the real Core registry, including disposal and model-visible metadata.
const { Context } = await import('@deepseek-ai/cordis')
const { ShellEnvRegistry } = await import('@deepseek-ai/dsh-shell-env')
const ctx = new Context()
new ShellEnvRegistry(ctx, { dshHome: process.env.DSH_HOME })
const unregister = registerSkillProxyEnvironment(ctx, paths)
const environment = ctx.shellEnv.collect({})
assert.equal(environment.DSH_SKILL_PROXY_NODE, paths.node)
assert.equal(environment.DSH_SKILL_PROXY_CLIENT, paths.client)
assert.equal(ctx.shellEnv.list().length, 2)

let fetches = 0
const request = createSkillProxyRequest('https://gapi-test.insight-aigc.com/insight-harness-service', () => credentials.getToken(), async (url, init) => {
  fetches++
  assert.equal(url, 'https://gapi-test.insight-aigc.com/insight-harness-service/api/skill-proxy/tikhub')
  assert.equal(new Headers(init.headers).get('token'), 'test-user-center-token')
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-user-center-token')
  assert.equal(init.redirect, 'error')
  assert.deepEqual(JSON.parse(init.body), { method: 'GET', path: '/example', query: { keyword: '中文' }, body: null })
  return new Response('{"type":"accepted"}\n{"type":"heartbeat"}\n{"type":"result","status":200,"body":{"ok":true}}\n', {
    headers: { 'content-type': 'application/x-ndjson' }
  })
})
const stop = await startSkillProxy(request, process.env.DSH_HOME)
const descriptor = join(process.env.DSH_HOME, 'skill-proxy/connection.json')
try {
  assert(!(await readFile(descriptor, 'utf8')).includes('test-user-center-token'))
  const invoke = () => promisify(execFile)(environment.DSH_SKILL_PROXY_NODE, [environment.DSH_SKILL_PROXY_CLIENT,
    'tikhub', 'GET', '/example', '--query', '{"keyword":"中文"}'], {
    env: { DSH_HOME: environment.DSH_HOME, PATH: '', HTTP_PROXY: 'http://127.0.0.1:1' }
  })
  if (process.env.TEST_MODE === 'expired') {
    await assert.rejects(invoke(), error => {
      assert.equal(JSON.parse(error.stderr).error.code, 'LOGIN_REQUIRED')
      return true
    })
    assert.equal(fetches, 0)
  } else {
    for (let i = 0; i < 2; i++) {
      const { stdout, stderr } = await invoke()
      assert.equal(stderr, '')
      assert.deepEqual(JSON.parse(stdout), { ok: true })
    }
    assert.equal(fetches, 2)
  }
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  await stop()
  assert.equal(existsSync(descriptor), false)
  unregister()
  assert.equal(ctx.shellEnv.list().length, 0)
  credentials.dispose()
  console.log('skill proxy runtime assertions passed')
  if (process.disconnect) process.disconnect()
  else process.exit(process.exitCode ?? 0)
}
