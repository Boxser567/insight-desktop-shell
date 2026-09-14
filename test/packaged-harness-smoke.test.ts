import { describe, expect, it } from 'vitest'
// @ts-expect-error The build script is JavaScript and has no declaration file.
import { buildPackagedHarnessArguments, createHarnessSmokeRpc, resolvePackagedHarnessPaths } from '../scripts/smoke-packaged-harness.mjs'

describe('packaged Harness smoke test', () => {
  const runtimeMetadata = {
    entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js',
    target: { platform: 'win32', arch: 'x64' }
  }

  it('launches the Windows Runtime shipped inside the package', () => {
    const paths = resolvePackagedHarnessPaths(
      'C:\\app\\resources',
      runtimeMetadata,
      { platform: 'win32', arch: 'x64' }
    )

    expect(paths.nodeExecutable).toContain('node.exe')
    expect(paths.dshEntry).toContain('@deepseek-ai')
    expect(buildPackagedHarnessArguments(paths, 43127)).toEqual([
      '--expose-internals',
      paths.nodeEntry,
      paths.dshEntry,
      'web',
      '--patch',
      paths.desktopPatch,
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '43127'
    ])
  })

  it('rejects a package built for a different target', () => {
    expect(() =>
      resolvePackagedHarnessPaths(
        '/app/resources',
        runtimeMetadata,
        { platform: 'darwin', arch: 'arm64' }
      )
    ).toThrow('win32-x64, not darwin-arm64')
  })
})

describe('smoke RPC compatibility', () => {
  it('exchanges the new Core launch token once and sends named Typert arguments', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('?token=')) return new Response('', { status: 302, headers: { 'set-cookie': 'dsh-session=test-cookie; HttpOnly; Path=/' } })
      const request = JSON.parse(String(init?.body))
      return Response.json({ rpcId: request.rpcId, result: { ok: true, value: { items: [] } } })
    }
    try {
      const rpc = createHarnessSmokeRpc('http://127.0.0.1:43129', 'test-token')
      await rpc.invoke('session.list', {})
      await rpc.invoke('session.create', { workspaceId: 'test-workspace' })
      expect(calls).toHaveLength(3)
      expect(calls[1]?.url).toBe('http://127.0.0.1:43129/api/session/list')
      expect(new Headers(calls[1]?.init?.headers).get('cookie')).toBe('dsh-session=test-cookie')
      expect(JSON.parse(String(calls[1]?.init?.body)).payload).toEqual({ args: { _request: {} } })
      expect(JSON.parse(String(calls[2]?.init?.body)).payload).toEqual({ args: { request: { workspaceId: 'test-workspace' } } })
    } finally { globalThis.fetch = original }
  })
})
