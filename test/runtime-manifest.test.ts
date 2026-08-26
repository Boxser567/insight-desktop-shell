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
  it('records the locked Core Runtime for the active build target', async () => {
    await run(process.execPath, ['scripts/prepare-runtime-manifest.mjs'])

    const manifest = readRuntimeManifest(manifestPath)
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      core: {
        source: 'release',
        repository: 'Boxser567/insight-harness-core',
        version: '0.1.1-rc.2',
          commit: 'c36eadb9f9e51419e14de991b4a0523e58542622',
        releaseTag: 'insight-runtime-v0.1.1-rc.6'
      },
      harness: { entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js' },
      node: { version: '24.9.0' },
      target: { platform: process.platform, arch: process.arch }
    })
    expect(manifest.checksums.archiveSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a malformed bundled resource', async () => {
    await writeFile(manifestPath, '{"schemaVersion":1}\n', 'utf8')
    expect(() => readRuntimeManifest(manifestPath)).toThrow('runtime-manifest.json')
  })
})
