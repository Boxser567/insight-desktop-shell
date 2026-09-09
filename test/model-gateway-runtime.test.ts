import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import electronExecutable from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AuthApiError } from '../src/main/auth/auth-api-client'
import { bindModelCredentialBridge } from '../src/main/runtime/model-credential-bridge'

let fixture: string
const hasPreparedCore = existsSync(resolve('build/core-runtime/runtime.json'))
beforeAll(async () => {
  if (!hasPreparedCore) return
  fixture = await mkdtemp(join(tmpdir(), 'insight-model-gateway-'))
  await symlink(resolve('build/core-runtime/node_modules'), join(fixture, 'node_modules'), 'dir')
  await cp('test/fixtures/model-gateway-runtime.mjs', join(fixture, 'run.mjs'))
  await cp('test/fixtures/model-gateway-electron.cjs', join(fixture, 'electron.cjs'))
  await build({
    entryPoints: ['packages/insight-desktop-integration/src/model-gateway.ts', 'packages/insight-desktop-integration/src/model-credential-client.ts'],
    outdir: fixture, outExtension: { '.js': '.mjs' }, bundle: true,
    format: 'esm', platform: 'node', external: ['@deepseek-ai/*']
  })
  await build({
    entryPoints: ['src/main/runtime/model-credential-bridge.ts'],
    outfile: join(fixture, 'model-credential-bridge.mjs'), bundle: true,
    format: 'esm', platform: 'node'
  })
})
afterAll(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }) })

describe.skipIf(!hasPreparedCore)('locked Core adapter with real Node parent/child IPC', () => {
  it.runIf(process.platform === 'darwin')('uses real Electron utilityProcess IPC on macOS', async () => {
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(String(electronExecutable), [join(fixture, 'electron.cjs')], {
      cwd: fixture, env: environment, stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout!.on('data', chunk => { output += chunk.toString() })
    child.stderr!.on('data', chunk => { output += chunk.toString() })
    try {
      const code = await new Promise<number | null>((resolveExit, reject) => {
        child.once('exit', resolveExit)
        child.once('error', reject)
      })
      expect(code, output).toBe(0)
      expect(output).toContain('runtime assertions passed')
      expect(output).not.toContain('test-user-center-token')
    } finally { if (child.exitCode === null) child.kill() }
  }, 20000)

  it.each(['success', 'expired', 'gateway401', 'cancel'])(
    'handles %s without a user-supplied model key', async (mode) => {
      const resolveToken = vi.fn(async () => {
        if (mode === 'expired') throw new AuthApiError('expired', 'test-secret')
        return 'test-user-center-token'
      })
      const peer = spawn(process.execPath, [join(fixture, 'run.mjs')], {
        cwd: fixture, env: { ...process.env, DSH_HOME: join(fixture, mode), TEST_MODE: mode },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      })
      let output = ''
      peer.stdout!.on('data', chunk => { output += chunk.toString() })
      peer.stderr!.on('data', chunk => { output += chunk.toString() })
      const dispose = bindModelCredentialBridge(peer, resolveToken, () => peer.exitCode === null)
      try {
        const code = await new Promise<number | null>((resolveExit, reject) => {
          peer.once('exit', resolveExit)
          peer.once('error', reject)
        })
        expect(code, output).toBe(0)
        expect(output).toContain('runtime assertions passed')
        expect(output).not.toContain('test-user-center-token')
        expect(resolveToken).toHaveBeenCalledTimes(mode === 'success' ? 2 : 1)
      } finally { dispose(); if (peer.exitCode === null) peer.kill() }
    }, 15000
  )
})
