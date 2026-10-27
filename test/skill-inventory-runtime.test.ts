import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, cp, rm, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { linkRuntimePackages } from './fixtures/link-runtime-packages.mjs'

it('uses public filesystem observers and the real Typert Gateway without registering execution skills', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'insight-skill-inventory-')))
  try {
    await linkRuntimePackages(resolve('build/core-runtime'), join(fixture, 'node_modules'))
    await cp('test/fixtures/skill-inventory-runtime.mjs', join(fixture, 'run.mjs'))
    await build({ entryPoints: ['packages/insight-desktop-integration/src/skill-inventory-service.ts'], outfile: join(fixture, 'inventory.mjs'), bundle: true, format: 'esm', platform: 'node', external: ['@deepseek-ai/*'] })
    const peer = spawn(resolve('build/core-runtime/node_modules/node/bin', process.platform === 'win32' ? 'node.exe' : 'node'), [join(fixture, 'run.mjs')], { cwd: fixture, env: { ...process.env, DSH_HOME: join(fixture, 'home'), DSH_AGENTS_HOME: join(fixture, 'agents'), DSH_BUNDLED_SKILL_DIR: join(fixture, 'platform') }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    peer.stdout.on('data', chunk => { output += chunk })
    peer.stderr.on('data', chunk => { output += chunk })
    const code = await new Promise((resolveExit, reject) => { peer.once('exit', resolveExit); peer.once('error', reject) })
    expect(code, output).toBe(0)
    expect(output).toContain('inventory runtime passed')
  } finally { await rm(fixture, { recursive: true, force: true }) }
}, 20000)
