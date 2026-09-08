import { createHash, createPrivateKey, sign } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { parseDocument } from 'yaml'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const commitPattern = /^[0-9a-f]{40}$/u

function parseArguments(argv) {
  const names = new Set([
    '--dir',
    '--version',
    '--channel',
    '--shell-commit',
    '--runtime-manifest',
    '--compatibility',
    '--policy',
    '--private-key'
  ])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!names.has(name) || !value || values.has(name)) throw new Error(usage())
    values.set(name, value)
  }
  if (values.size !== names.size) throw new Error(usage())
  return Object.fromEntries(values)
}

function usage() {
  return 'Usage: build-update-release.mjs --dir <path> --version <semver> --channel <candidate|stable> --shell-commit <40-hex> --runtime-manifest <path> --compatibility <path> --policy <path> --private-key <path>'
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains missing or unknown fields.`)
  }
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function validatePolicy(value, version, channel) {
  assertExactKeys(
    value,
    ['schema', 'releaseVersion', 'channel', 'mode', 'minimumSupportedVersion'],
    'Release policy'
  )
  if (
    value.schema !== 1 ||
    semver.valid(value.releaseVersion) !== value.releaseVersion ||
    !['candidate', 'stable'].includes(value.channel) ||
    !['optional', 'required'].includes(value.mode) ||
    semver.valid(value.minimumSupportedVersion) !== value.minimumSupportedVersion
  ) {
    throw new Error('Release policy is invalid.')
  }
  if (value.releaseVersion !== version || value.channel !== channel) {
    throw new Error('Release policy version and channel must match the build arguments.')
  }
  if (semver.gt(value.minimumSupportedVersion, version)) {
    throw new Error('Release policy minimum supported version cannot exceed the release version.')
  }
  return value
}

function validateCompatibility(value) {
  const keys = [
    'profileSchema',
    'accountStorageSchema',
    'minimumReadableDataSchema',
    'maximumReadableDataSchema'
  ]
  assertExactKeys(value, keys, 'Update compatibility')
  if (keys.some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0)) {
    throw new Error('Update compatibility schemas must be non-negative safe integers.')
  }
  if (value.minimumReadableDataSchema > value.maximumReadableDataSchema) {
    throw new Error('Update compatibility readable schema range is invalid.')
  }
  return value
}

function validateRuntimeManifest(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !value.core ||
    typeof value.core !== 'object' ||
    typeof value.core.releaseTag !== 'string' ||
    value.core.releaseTag.length === 0 ||
    typeof value.core.commit !== 'string' ||
    !commitPattern.test(value.core.commit)
  ) {
    throw new Error('Core Runtime manifest does not contain a valid release tag and commit.')
  }
  return value.core
}

function artifactDefinitions(channel) {
  const prefix = channel === 'candidate' ? 'insight-candidate' : 'insight'
  const mac = (arch) => `${prefix}-mac-${arch}`
  const windows = channel === 'candidate'
    ? 'insight-candidate-windows-x64-setup.exe'
    : 'insight-windows-x64-setup.exe'
  return [
    ['darwin', 'arm64', 'dmg', `${mac('arm64')}.dmg`],
    ['darwin', 'arm64', 'zip', `${mac('arm64')}.zip`],
    ['darwin', 'arm64', 'blockmap', `${mac('arm64')}.zip.blockmap`],
    ['darwin', 'arm64', 'updater-metadata', 'latest-mac.yml'],
    ['darwin', 'x64', 'dmg', `${mac('x64')}.dmg`],
    ['darwin', 'x64', 'zip', `${mac('x64')}.zip`],
    ['darwin', 'x64', 'blockmap', `${mac('x64')}.zip.blockmap`],
    ['darwin', 'x64', 'updater-metadata', 'latest-mac.yml'],
    ['win32', 'x64', 'nsis', windows],
    ['win32', 'x64', 'blockmap', `${windows}.blockmap`],
    ['win32', 'x64', 'updater-metadata', 'latest.yml']
  ]
}

async function artifact(releaseDir, definition) {
  const [platform, arch, kind, name] = definition
  const path = join(releaseDir, name)
  const bytes = await readFile(path)
  const fileStat = await stat(path)
  if (fileStat.size <= 0) throw new Error(`Release asset is empty: ${name}`)
  return {
    platform,
    arch,
    kind,
    name,
    size: fileStat.size,
    sha512: createHash('sha512').update(bytes).digest('base64')
  }
}

async function validateUpdaterVersion(path, version) {
  const document = parseDocument(await readFile(path, 'utf8'))
  if (document.errors.length > 0) throw new Error(`Invalid updater YAML: ${path}`)
  const value = document.toJS()
  if (!value || typeof value !== 'object' || value.version !== version) {
    throw new Error(`Updater metadata version does not match ${version}: ${path}`)
  }
}

function compareArtifacts(left, right) {
  const leftKey = [left.platform, left.arch, left.kind, left.name].join('\0')
  const rightKey = [right.platform, right.arch, right.kind, right.name].join('\0')
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const version = args['--version']
  const channel = args['--channel']
  const shellCommit = args['--shell-commit']
  if (semver.valid(version) !== version) throw new Error('Release version must be valid semver.')
  if (!['candidate', 'stable'].includes(channel)) throw new Error('Release channel is invalid.')
  if (!commitPattern.test(shellCommit)) throw new Error('Shell commit must be a 40-character lowercase SHA.')

  const releaseDir = resolve(args['--dir'])
  const privateKeyPath = resolve(args['--private-key'])
  const privateKeyRelative = relative(repositoryRoot, privateKeyPath)
  if (privateKeyRelative === '' || (!privateKeyRelative.startsWith('..') && !isAbsolute(privateKeyRelative))) {
    throw new Error('The update signing private key must be stored outside the repository.')
  }

  const [runtimeManifest, compatibility, policy] = await Promise.all([
    readJson(resolve(args['--runtime-manifest']), 'Core Runtime manifest'),
    readJson(resolve(args['--compatibility']), 'update compatibility'),
    readJson(resolve(args['--policy']), 'release policy')
  ])
  const core = validateRuntimeManifest(runtimeManifest)
  const validatedCompatibility = validateCompatibility(compatibility)
  const validatedPolicy = validatePolicy(policy, version, channel)
  await Promise.all([
    validateUpdaterVersion(join(releaseDir, 'latest-mac.yml'), version),
    validateUpdaterVersion(join(releaseDir, 'latest.yml'), version)
  ])

  const artifacts = await Promise.all(
    artifactDefinitions(channel).map((definition) => artifact(releaseDir, definition))
  )
  artifacts.sort(compareArtifacts)
  const manifest = {
    schema: 'insight-desktop-update/v1',
    version,
    channel,
    publishedAt: new Date().toISOString(),
    shellCommit,
    coreRuntime: {
      tag: core.releaseTag,
      commit: core.commit
    },
    policy: {
      mode: validatedPolicy.mode,
      minimumSupportedVersion: validatedPolicy.minimumSupportedVersion
    },
    compatibility: validatedCompatibility,
    artifacts
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  const privateKey = createPrivateKey(await readFile(privateKeyPath, 'utf8'))
  const signature = sign(null, manifestBytes, privateKey)
  await Promise.all([
    writeFile(join(releaseDir, 'insight-update.json'), manifestBytes),
    writeFile(join(releaseDir, 'insight-update.json.sig'), signature)
  ])
}

await main()
