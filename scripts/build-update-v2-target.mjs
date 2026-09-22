import { createHash, createPrivateKey, sign } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { artifactDefinitions } from './update-release-contract.mjs'
import {
  UPDATE_V2_SCHEMAS,
  UPDATE_V2_TARGET_IDS,
  parseV2TargetManifest
} from './update-v2-contract.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const commitPattern = /^[0-9a-f]{40}$/u

function parseArguments(argv) {
  const names = new Set([
    '--asset-dir', '--out-dir', '--version', '--target', '--shell-commit',
    '--runtime-manifest', '--compatibility', '--private-key'
  ])
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
  return 'Usage: build-update-v2-target.mjs --asset-dir <path> --out-dir <path> --version <final-semver> --target <darwin-arm64|darwin-x64|win32-x64> --shell-commit <sha> --runtime-manifest <path> --compatibility <path> --private-key <path>'
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

function validateRuntime(value) {
  if (
    !value || typeof value !== 'object' || !value.core || typeof value.core !== 'object' ||
    typeof value.core.releaseTag !== 'string' || value.core.releaseTag.length === 0 ||
    typeof value.core.commit !== 'string' || !commitPattern.test(value.core.commit)
  ) {
    throw new Error('Core Runtime manifest does not contain a valid release tag and commit.')
  }
  return { tag: value.core.releaseTag, commit: value.core.commit }
}

function validateCompatibility(value) {
  const values = [
    value?.profileSchema,
    value?.accountStorageSchema,
    value?.readsDataSchema?.minimum,
    value?.readsDataSchema?.maximum,
    value?.writesDataSchema
  ]
  if (values.some((entry) => !Number.isSafeInteger(entry) || entry < 0)) {
    throw new Error('Update compatibility schemas must be non-negative safe integers.')
  }
  if (value.readsDataSchema.minimum > value.readsDataSchema.maximum) {
    throw new Error('Update compatibility readable schema range is invalid.')
  }
  return value
}

function targetParts(target) {
  if (!UPDATE_V2_TARGET_IDS.includes(target)) throw new Error('Update target is invalid.')
  const [platform, arch] = target.split('-')
  return { platform, arch }
}

async function buildArtifact(assetDir, definition) {
  const [platform, arch, kind, name] = definition
  const path = join(assetDir, name)
  const file = await stat(path)
  if (file.size <= 0) throw new Error(`Release asset is empty: ${name}`)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return {
    platform,
    arch,
    kind,
    name,
    size: file.size,
    sha512: hash.digest('base64')
  }
}

async function validateUpdaterMetadata(assetDir, definition, version) {
  const metadataName = definition.find((entry) => entry[2] === 'updater-metadata')?.[3]
  const updateKind = definition[0]?.[0] === 'darwin' ? 'zip' : 'nsis'
  const expectedAsset = definition.find((entry) => entry[2] === updateKind)?.[3]
  if (!metadataName || !expectedAsset) throw new Error('Target updater asset definition is incomplete.')
  const document = parseDocument(await readFile(join(assetDir, metadataName), 'utf8'))
  if (document.errors.length > 0) throw new Error(`Invalid updater YAML: ${metadataName}`)
  const value = document.toJS()
  const updateArtifact = await buildArtifact(
    assetDir,
    definition.find((entry) => entry[3] === expectedAsset)
  )
  const metadataFile = Array.isArray(value?.files) && value.files.length === 1
    ? value.files[0]
    : undefined
  if (
    value?.version !== version || metadataFile?.url !== expectedAsset ||
    metadataFile.sha512 !== updateArtifact.sha512 || metadataFile.size !== updateArtifact.size ||
    value.path !== expectedAsset || value.sha512 !== updateArtifact.sha512
  ) {
    throw new Error('Updater metadata must reference exactly the current target and version.')
  }
}

function assertPrivateKeyOutsideRepository(path) {
  const keyRelative = relative(repositoryRoot, path)
  if (keyRelative === '' || (!keyRelative.startsWith('..') && !isAbsolute(keyRelative))) {
    throw new Error('The update signing private key must be stored outside the repository.')
  }
}

export async function buildV2Target(input) {
  const assetDir = resolve(input.assetDir)
  const outDir = resolve(input.outDir)
  const privateKeyPath = resolve(input.privateKeyPath)
  assertPrivateKeyOutsideRepository(privateKeyPath)
  if (!commitPattern.test(input.shellCommit)) {
    throw new Error('Shell commit must be a 40-character lowercase SHA.')
  }
  const target = targetParts(input.target)
  const definitions = artifactDefinitions('stable', input.version).filter((entry) =>
    entry[0] === target.platform && entry[1] === target.arch)
  await validateUpdaterMetadata(assetDir, definitions, input.version)
  const [runtime, compatibility, artifacts] = await Promise.all([
    readJson(resolve(input.runtimeManifest), 'Core Runtime manifest').then(validateRuntime),
    readJson(resolve(input.compatibility), 'update compatibility').then(validateCompatibility),
    Promise.all(definitions.map((definition) => buildArtifact(assetDir, definition)))
  ])
  artifacts.sort((left, right) => {
    const a = [left.platform, left.arch, left.kind, left.name].join('\0')
    const b = [right.platform, right.arch, right.kind, right.name].join('\0')
    return a < b ? -1 : a > b ? 1 : 0
  })
  const manifest = parseV2TargetManifest({
    schema: UPDATE_V2_SCHEMAS.target,
    version: input.version,
    target,
    shellCommit: input.shellCommit,
    coreRuntime: runtime,
    compatibility,
    artifacts
  })
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  const privateKey = createPrivateKey(await readFile(privateKeyPath, 'utf8'))
  const signature = sign(null, manifestBytes, privateKey)
  await mkdir(outDir, { recursive: true })
  if (assetDir !== outDir) {
    await Promise.all(definitions.map((definition) =>
      copyFile(join(assetDir, definition[3]), join(outDir, definition[3]))
    ))
  }
  await Promise.all([
    writeFile(join(outDir, 'insight-target.json'), manifestBytes),
    writeFile(join(outDir, 'insight-target.json.sig'), signature)
  ])
  return manifest
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  await buildV2Target({
    assetDir: args['--asset-dir'],
    outDir: args['--out-dir'],
    version: args['--version'],
    target: args['--target'],
    shellCommit: args['--shell-commit'],
    runtimeManifest: args['--runtime-manifest'],
    compatibility: args['--compatibility'],
    privateKeyPath: args['--private-key']
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
