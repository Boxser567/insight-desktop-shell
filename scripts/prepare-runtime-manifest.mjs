import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const dshPackagePath = 'node_modules/@deepseek-ai/dsh'

/**
 * Builds the immutable runtime description shipped with one desktop target.
 *
 * @param {{ dependencies?: Record<string, unknown> }} packageJson
 * @param {{ packages?: Record<string, { integrity?: unknown, version?: unknown }> }} packageLock
 * @param {{ platform: string, arch: string }} target
 * @returns {{ schemaVersion: 1, core: { source: 'registry', commit: null }, harness: { package: '@deepseek-ai/dsh', version: string }, node: { version: string }, target: { platform: string, arch: string }, checksums: { dshPackage: string } }}
 */
export function createRuntimeManifest(packageJson, packageLock, target) {
  const harnessVersion = packageJson.dependencies?.['@deepseek-ai/dsh']
  const nodeVersion = packageJson.dependencies?.node
  const dsh = packageLock.packages?.[dshPackagePath]

  if (typeof harnessVersion !== 'string' || !harnessVersion) {
    throw new Error('package.json must declare @deepseek-ai/dsh as a production dependency.')
  }
  if (typeof nodeVersion !== 'string' || !nodeVersion) {
    throw new Error('package.json must declare the bundled node runtime as a production dependency.')
  }
  if (dsh?.version !== harnessVersion) {
    throw new Error(`package-lock.json must pin ${dshPackagePath} to ${harnessVersion}.`)
  }
  if (typeof dsh.integrity !== 'string' || !dsh.integrity) {
    throw new Error(`package-lock.json must include an integrity checksum for ${dshPackagePath}.`)
  }

  return {
    schemaVersion: 1,
    core: { source: 'registry', commit: null },
    harness: { package: '@deepseek-ai/dsh', version: harnessVersion },
    node: { version: nodeVersion },
    target,
    checksums: { dshPackage: dsh.integrity }
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
  const [packageJson, packageLock] = await Promise.all([
    readFile(join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(projectRoot, 'package-lock.json'), 'utf8').then(JSON.parse)
  ])
  const manifest = createRuntimeManifest(packageJson, packageLock, {
    platform: process.platform,
    arch: process.arch
  })
  const outputPath = join(projectRoot, 'build', 'runtime-manifest.json')
  await writeRuntimeManifest(outputPath, manifest)
  console.log(`Prepared runtime manifest: ${outputPath}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
