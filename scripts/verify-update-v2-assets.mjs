import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { parseV2TargetManifest } from './update-v2-contract.mjs'

function parseArguments(argv) {
  const names = new Set(['--dir', '--version', '--target', '--public-key'])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!names.has(name) || !value || values.has(name)) throw new Error(usage())
    values.set(name, value)
  }
  if ([...names].some((name) => !values.has(name))) throw new Error(usage())
  return Object.fromEntries(values)
}

function usage() {
  return 'Usage: verify-update-v2-assets.mjs --dir <target-dir> --version <semver> --target <id> --public-key <path>'
}

export async function verifyV2TargetAssets(input) {
  const targetDir = resolve(input.targetDir)
  const [manifestBytes, signatureBytes, publicKeyPem] = await Promise.all([
    readFile(join(targetDir, 'insight-target.json')),
    readFile(join(targetDir, 'insight-target.json.sig')),
    readFile(resolve(input.publicKeyPath), 'utf8')
  ])
  if (!verify(null, manifestBytes, createPublicKey(publicKeyPem), signatureBytes)) {
    throw new Error('Target Manifest signature is invalid.')
  }
  const manifest = parseV2TargetManifest(JSON.parse(manifestBytes.toString('utf8')))
  if (
    manifest.version !== input.version ||
    `${manifest.target.platform}-${manifest.target.arch}` !== input.target
  ) {
    throw new Error('Target Manifest version or target does not match the requested release.')
  }
  const expectedFiles = [
    ...manifest.artifacts.map(({ name }) => name),
    'insight-target.json',
    'insight-target.json.sig'
  ].sort()
  const actualFiles = (await readdir(targetDir, { withFileTypes: true }))
  if (actualFiles.some((entry) => !entry.isFile())) {
    throw new Error('Target release directory may contain files only.')
  }
  if (JSON.stringify(actualFiles.map(({ name }) => name).sort()) !== JSON.stringify(expectedFiles)) {
    throw new Error('Target release directory contains missing or unexpected files.')
  }
  for (const artifact of manifest.artifacts) {
    const path = join(targetDir, artifact.name)
    const file = await stat(path)
    const hash = createHash('sha512')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    if (
      file.size !== artifact.size ||
      hash.digest('base64') !== artifact.sha512
    ) {
      throw new Error(`Target Manifest does not match release asset: ${artifact.name}`)
    }
  }
  const metadata = manifest.artifacts.find(({ kind }) => kind === 'updater-metadata')
  const updateAsset = manifest.artifacts.find(({ kind }) =>
    kind === (manifest.target.platform === 'darwin' ? 'zip' : 'nsis'))
  if (!metadata || !updateAsset) throw new Error('Target updater assets are incomplete.')
  const document = parseDocument(await readFile(join(targetDir, metadata.name), 'utf8'))
  const value = document.toJS()
  if (
    document.errors.length > 0 ||
    value?.version !== manifest.version ||
    !Array.isArray(value?.files) ||
    value.files.length !== 1 ||
    value.files[0]?.url !== updateAsset.name ||
    value.files[0]?.sha512 !== updateAsset.sha512 ||
    value.files[0]?.size !== updateAsset.size ||
    value.path !== updateAsset.name ||
    value.sha512 !== updateAsset.sha512
  ) {
    throw new Error('Target updater metadata is invalid.')
  }
  return manifest
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  await verifyV2TargetAssets({
    targetDir: args['--dir'],
    version: args['--version'],
    target: args['--target'],
    publicKeyPath: args['--public-key']
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
