import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import electronExecutable from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AuthApiError } from '../src/main/auth/auth-api-client'
import { bindModelCredentialBridge } from '../src/main/runtime/model-credential-bridge'

let fixture: string
const coreRoot = resolve(process.env.INSIGHT_TEST_CORE_RUNTIME ?? 'build/core-runtime')
const prepared = existsSync(join(coreRoot, 'runtime.json'))
const node = join(coreRoot, 'node_modules/node/bin', process.platform === 'win32' ? 'node.exe' : 'node')
beforeAll(async () => {
  if (!prepared) return
  fixture = await mkdtemp(join(tmpdir(), 'insight skill proxy 中文-'))
  await symlink(join(coreRoot, 'node_modules'), join(fixture, 'node_modules'), 'dir')
  await cp('test/fixtures/skill-proxy-runtime.mjs', join(fixture, 'run.mjs'))
  // Existing Electron main fixture asserts two token requests over actual utilityProcess IPC.
  await cp('test/fixtures/model-gateway-electron.cjs', join(fixture, 'electron.cjs'))
  await mkdir(join(fixture, 'resources'))
  await cp('packages/insight-desktop-integration/resources/skill-proxy-client.mjs', join(fixture, 'resources/skill-proxy-client.mjs'))
  await build({ entryPoints: ['skill-proxy', 'skill-proxy-http', 'skill-proxy-environment', 'model-credential-client'].map(name =>
    `packages/insight-desktop-integration/src/${name}.ts`),
    outdir: join(fixture, 'lib'), outExtension: { '.js': '.mjs' }, bundle: true, splitting: true, format: 'esm', platform: 'node' })
  await build({ entryPoints: ['src/main/runtime/model-credential-bridge.ts'],
    outfile: join(fixture, 'model-credential-bridge.mjs'), bundle: true, format: 'esm', platform: 'node' })
})
afterAll(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }) })

describe.skipIf(!prepared)('skill SDK → Host → main-process credentials → backend (offline)', () => {
  it.each(['success', 'expired'])('uses real bundled Node and IPC: %s', async mode => {
    const token = vi.fn(async () => {
      if (mode === 'expired') throw new AuthApiError('expired', 'private failure')
      return 'test-user-center-token'
    })
    const peer = spawn(node, [join(fixture, 'run.mjs')], { cwd: fixture,
      env: { ...process.env, DSH_HOME: join(fixture, mode), TEST_MODE: mode, INSIGHT_BUNDLED_NODE_PATH: node },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
    let output = ''
    peer.stdout!.on('data', data => { output += data.toString() })
    peer.stderr!.on('data', data => { output += data.toString() })
    const stop = bindModelCredentialBridge(peer, token, () => peer.exitCode === null)
    try {
      const code = await new Promise(resolveExit => peer.once('exit', resolveExit))
      expect(code, output).toBe(0)
      expect(output).toContain('runtime assertions passed')
      expect(output).not.toContain('test-user-center-token')
      expect(token).toHaveBeenCalledTimes(mode === 'success' ? 2 : 1)
    } finally { stop(); if (peer.exitCode === null) peer.kill() }
  }, 15000)

  it.runIf(process.platform === 'darwin')('uses bundled Node, not Electron Helper, from a real utilityProcess', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, INSIGHT_BUNDLED_NODE_PATH: node }
    delete env.ELECTRON_RUN_AS_NODE
    const peer = spawn(String(electronExecutable), [join(fixture, 'electron.cjs')], { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    peer.stdout!.on('data', data => { output += data.toString() })
    peer.stderr!.on('data', data => { output += data.toString() })
    try {
      const code = await new Promise((resolveExit, reject) => { peer.once('exit', resolveExit); peer.once('error', reject) })
      expect(code, output).toBe(0)
      expect(existsSync(join(fixture, 'electron-utility-success'))).toBe(true)
      expect(output).not.toContain('test-user-center-token')
    } finally { if (peer.exitCode === null) peer.kill() }
  }, 20000)
})
