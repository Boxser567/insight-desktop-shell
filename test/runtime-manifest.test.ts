import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { readRuntimeManifest } from '../src/main/state/runtime-manifest'
// @ts-expect-error The build script is JavaScript and has no declaration file.
import { createRuntimeManifest, writeRuntimeManifest } from '../scripts/prepare-runtime-manifest.mjs'

const temporaryDirectories: string[] = []

async function temporaryManifestPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-runtime-manifest-'))
  temporaryDirectories.push(directory)
  return join(directory, 'runtime-manifest.json')
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('runtime manifest', () => {
  it('records the locked Core Runtime for the active build target', async () => {
    const runtimeLock = JSON.parse(await readFile('core-runtime.lock.json', 'utf8'))
    const target = { platform: process.platform, arch: process.arch }
    const selected = runtimeLock.targets[`${target.platform}-${target.arch}`]
    const manifestPath = await temporaryManifestPath()
    const manifest = createRuntimeManifest(
      runtimeLock,
      {
        core: selected.core,
        entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js',
        node: selected.node,
        target
      },
      target
    )
    await writeRuntimeManifest(manifestPath, manifest)

    expect(readRuntimeManifest(manifestPath)).toMatchObject({
      schemaVersion: 1,
      core: {
        source: 'release',
        repository: 'Boxser567/insight-harness-core',
        version: '0.1.1-rc.2',
        commit: 'b580d6f4ce72aa1e37515eea75ff7fc408e2cb1a',
        releaseTag: 'insight-runtime-v0.1.1-rc.8'
      },
      harness: { entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js' },
      node: { version: '24.9.0' },
      target: { platform: process.platform, arch: process.arch }
    })
    expect(manifest.checksums.archiveSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a malformed bundled resource', async () => {
    const manifestPath = await temporaryManifestPath()
    await writeFile(manifestPath, '{"schemaVersion":1}\n', 'utf8')
    expect(() => readRuntimeManifest(manifestPath)).toThrow('runtime-manifest.json')
  })
})
