import { execFile } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { readRuntimeManifest } from '../src/main/state/runtime-manifest'

const run = promisify(execFile)
const manifestPath = 'build/runtime-manifest.json'

afterEach(async () => {
  await rm(manifestPath, { force: true })
})

describe('runtime manifest', () => {
  it('records the pinned registry runtime for the active build target', async () => {
    await run(process.execPath, ['scripts/prepare-runtime-manifest.mjs'])

    const manifest = readRuntimeManifest(manifestPath)
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      core: { source: 'registry', commit: null },
      harness: { package: '@deepseek-ai/dsh', version: '0.1.1-rc.1' },
      node: { version: '24.9.0' },
      target: { platform: process.platform, arch: process.arch }
    })
    expect(manifest.checksums.dshPackage).toMatch(/^sha512-/)
  })

  it('rejects a malformed bundled resource', async () => {
    await writeFile(manifestPath, '{"schemaVersion":1}\n', 'utf8')
    expect(() => readRuntimeManifest(manifestPath)).toThrow('runtime-manifest.json')
  })
})
