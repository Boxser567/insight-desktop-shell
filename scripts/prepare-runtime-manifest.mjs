import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Builds the immutable runtime description shipped with one desktop target.
 *
 * @param {{ releaseTag?: unknown, targets?: Record<string, unknown> }} runtimeLock
 * @param {{ core?: unknown, entry?: unknown, node?: unknown, target?: unknown }} runtimeMetadata
 * @param {{ platform: string, arch: string }} target
 * @returns {{ schemaVersion: 1, core: { source: 'release', repository: string, version: string, commit: string, releaseTag: string }, harness: { entry: string }, node: { version: string }, target: { platform: string, arch: string }, checksums: { archiveSha256: string } }}
 */
export function createRuntimeManifest(runtimeLock, runtimeMetadata, target) {
  const selected = runtimeLock.targets?.[`${target.platform}-${target.arch}`]
  const core = runtimeMetadata.core

  if (!selected || typeof selected !== 'object' || typeof selected.sha256 !== 'string') {
    throw new Error(`core-runtime.lock.json has no selected Runtime for ${target.platform}-${target.arch}.`)
  }
  if (!core || typeof core !== 'object' || typeof runtimeMetadata.entry !== 'string' || typeof runtimeMetadata.node?.version !== 'string') {
    throw new Error('The prepared Core Runtime metadata is invalid.')
  }
  if (
    core.repository !== selected.core?.repository ||
    core.version !== selected.core?.version ||
    core.commit !== selected.core?.commit ||
    runtimeMetadata.node.version !== selected.node?.version ||
    runtimeMetadata.target?.platform !== target.platform ||
    runtimeMetadata.target?.arch !== target.arch
  ) {
    throw new Error('The prepared Core Runtime metadata does not match core-runtime.lock.json.')
  }

  return {
    schemaVersion: 1,
    core: {
      source: 'release',
      repository: core.repository,
      version: core.version,
      commit: core.commit,
      releaseTag: runtimeLock.releaseTag
    },
    harness: { entry: runtimeMetadata.entry },
    node: { version: runtimeMetadata.node.version },
    target,
    checksums: { archiveSha256: selected.sha256 }
  }
}

/**
 * Writes a readable manifest only after the full JSON document is available.
 *
 * @param {string} outputPath
 * @param {ReturnType<typeof createRuntimeManifest>} manifest
 * @returns {Promise<void>}
 */
export async function writeRuntimeManifest(outputPath, manifest) {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function main() {
  const [runtimeLock, runtimeMetadata] = await Promise.all([
    readFile(join(projectRoot, 'core-runtime.lock.json'), 'utf8').then(JSON.parse),
    readFile(join(projectRoot, 'build', 'core-runtime', 'runtime.json'), 'utf8').then(JSON.parse)
  ])
  const manifest = createRuntimeManifest(runtimeLock, runtimeMetadata, {
    platform: process.platform,
    arch: process.arch
  })
  const outputPath = join(projectRoot, 'build', 'runtime-manifest.json')
  await writeRuntimeManifest(outputPath, manifest)
  console.log(`Prepared runtime manifest: ${outputPath}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
