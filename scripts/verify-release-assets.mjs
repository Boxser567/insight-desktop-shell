import { createHash, createPublicKey, verify } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import semver from 'semver'
import { parseDocument } from 'yaml'
import { z } from 'zod'

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const artifactSchema = z.object({
  platform: z.enum(['darwin', 'win32']),
  arch: z.enum(['arm64', 'x64']),
  kind: z.enum(['dmg', 'zip', 'nsis', 'blockmap', 'updater-metadata']),
  name: z.string().min(1),
  size: safeInteger,
  sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u)
}).strict()
const manifestSchema = z.object({
  schema: z.literal('insight-desktop-update/v1'),
  version: z.string().min(1),
  channel: z.enum(['candidate', 'stable']),
  publishedAt: z.iso.datetime({ offset: true }),
  shellCommit: z.string().regex(/^[0-9a-f]{40}$/u),
  coreRuntime: z.object({
    tag: z.string().min(1),
    commit: z.string().regex(/^[0-9a-f]{40}$/u)
  }).strict(),
  policy: z.object({
    mode: z.enum(['optional', 'required']),
    minimumSupportedVersion: z.string().min(1)
  }).strict(),
  compatibility: z.object({
    profileSchema: safeInteger,
    accountStorageSchema: safeInteger,
    minimumReadableDataSchema: safeInteger,
    maximumReadableDataSchema: safeInteger
  }).strict(),
  artifacts: z.array(artifactSchema)
}).strict()

function parseArguments(argv) {
  const names = new Set(['--dir', '--version', '--channel', '--public-key'])
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
  return 'Usage: verify-release-assets.mjs --dir <path> --version <semver> --channel <candidate|stable> --public-key <path>'
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

function identity(values) {
  return values.slice(0, 4).join('\0')
}

function verifyZipCentralDirectory(bytes, name) {
  const minimumEocdSize = 22
  if (bytes.length < minimumEocdSize) throw new Error(`ZIP is truncated: ${name}`)
  const firstPossible = Math.max(0, bytes.length - 65_557)
  let eocdOffset = -1
  for (let offset = bytes.length - minimumEocdSize; offset >= firstPossible; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) throw new Error(`ZIP central directory is unavailable: ${name}`)
  const entryCount = bytes.readUInt16LE(eocdOffset + 10)
  const centralSize = bytes.readUInt32LE(eocdOffset + 12)
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16)
  if (
    entryCount < 1 ||
    centralSize < 46 ||
    centralOffset + centralSize > eocdOffset ||
    centralOffset + 4 > bytes.length ||
    bytes.readUInt32LE(centralOffset) !== 0x02014b50
  ) {
    throw new Error(`ZIP central directory is invalid: ${name}`)
  }
}

function verifyWindowsInstaller(bytes, name) {
  if (bytes.length < 70 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error(`Windows installer has an invalid DOS header: ${name}`)
  }
  const peOffset = bytes.readUInt32LE(0x3c)
  if (
    peOffset < 0x40 ||
    peOffset + 6 > bytes.length ||
    bytes.readUInt32LE(peOffset) !== 0x00004550
  ) {
    throw new Error(`Windows installer has an invalid PE signature: ${name}`)
  }
}

function parseUpdaterMetadata(bytes, name) {
  const document = parseDocument(bytes.toString('utf8'))
  if (document.errors.length > 0) throw new Error(`Invalid updater YAML: ${name}`)
  const value = document.toJS()
  if (!value || typeof value !== 'object' || !Array.isArray(value.files)) {
    throw new Error(`Invalid updater metadata: ${name}`)
  }
  return value
}

async function verifyUpdaterMetadata(releaseDir, manifest, expectedDefinitions) {
  const expectedByName = new Map()
  for (const definition of expectedDefinitions) {
    const name = definition[3]
    if (!expectedByName.has(name)) expectedByName.set(name, definition)
  }
  for (const metadataName of ['latest-mac.yml', 'latest.yml']) {
    const metadata = parseUpdaterMetadata(await readFile(join(releaseDir, metadataName)), metadataName)
    if (metadata.version !== manifest.version || metadata.files.length === 0) {
      throw new Error(`Updater metadata version or files are invalid: ${metadataName}`)
    }
    const expectedNames = metadataName === 'latest-mac.yml'
      ? expectedDefinitions.filter((entry) => entry[2] === 'zip').map((entry) => entry[3]).sort()
      : expectedDefinitions.filter((entry) => entry[2] === 'nsis').map((entry) => entry[3]).sort()
    const actualNames = metadata.files.map((file) => basename(file.url ?? '')).sort()
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      throw new Error(`Updater metadata references the wrong platform or architecture: ${metadataName}`)
    }
    for (const file of metadata.files) {
      const name = basename(file.url)
      if (!expectedByName.has(name)) throw new Error(`Unexpected updater asset: ${name}`)
      const bytes = await readFile(join(releaseDir, name))
      const fileStat = await stat(join(releaseDir, name))
      const digest = createHash('sha512').update(bytes).digest('base64')
      if (file.size !== fileStat.size || file.sha512 !== digest) {
        throw new Error(`Updater metadata does not match release asset: ${name}`)
      }
    }
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const releaseDir = resolve(args['--dir'])
  const version = args['--version']
  const channel = args['--channel']
  if (semver.valid(version) !== version) throw new Error('Release version must be valid semver.')
  if (!['candidate', 'stable'].includes(channel)) throw new Error('Release channel is invalid.')

  const manifestPath = join(releaseDir, 'insight-update.json')
  const signaturePath = join(releaseDir, 'insight-update.json.sig')
  const [manifestBytes, signatureBytes, publicKeyPem] = await Promise.all([
    readFile(manifestPath),
    readFile(signaturePath),
    readFile(resolve(args['--public-key']), 'utf8')
  ])
  if (
    manifestBytes.length === 0 ||
    manifestBytes.at(-1) !== 0x0a ||
    manifestBytes.at(-2) === 0x0a
  ) {
    throw new Error('Release manifest must end with exactly one newline.')
  }
  if (!verify(null, manifestBytes, createPublicKey(publicKeyPem), signatureBytes)) {
    throw new Error('Release manifest signature is invalid.')
  }

  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
  if (
    manifest.version !== version ||
    manifest.channel !== channel ||
    semver.valid(manifest.version) !== manifest.version ||
    semver.valid(manifest.policy.minimumSupportedVersion) !== manifest.policy.minimumSupportedVersion ||
    semver.gt(manifest.policy.minimumSupportedVersion, manifest.version) ||
    manifest.compatibility.minimumReadableDataSchema > manifest.compatibility.maximumReadableDataSchema
  ) {
    throw new Error('Release manifest version, channel, policy, or compatibility is invalid.')
  }

  const definitions = artifactDefinitions(channel)
  const expectedIdentities = definitions.map(identity).sort()
  const actualIdentities = manifest.artifacts
    .map((entry) => identity([entry.platform, entry.arch, entry.kind, entry.name]))
  if (JSON.stringify(actualIdentities) !== JSON.stringify([...actualIdentities].sort())) {
    throw new Error('Release manifest artifacts are not sorted.')
  }
  if (JSON.stringify(actualIdentities) !== JSON.stringify(expectedIdentities)) {
    throw new Error('Release manifest artifact set is incomplete or unexpected.')
  }

  const duplicateFiles = new Map()
  for (const artifact of manifest.artifacts) {
    const previous = duplicateFiles.get(artifact.name)
    if (previous && (
      previous.kind !== artifact.kind ||
      previous.size !== artifact.size ||
      previous.sha512 !== artifact.sha512
    )) {
      throw new Error(`Repeated manifest asset has inconsistent metadata: ${artifact.name}`)
    }
    duplicateFiles.set(artifact.name, artifact)
  }

  const expectedFiles = [...new Set([
    ...definitions.map((entry) => entry[3]),
    'insight-update.json',
    'insight-update.json.sig'
  ])].sort()
  const directoryEntries = await readdir(releaseDir, { withFileTypes: true })
  if (directoryEntries.some((entry) => !entry.isFile())) {
    throw new Error('Release asset directory may contain files only.')
  }
  const actualFiles = directoryEntries.map((entry) => entry.name).sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('Release asset directory contains missing or unexpected files.')
  }

  for (const artifact of duplicateFiles.values()) {
    const path = join(releaseDir, artifact.name)
    const bytes = await readFile(path)
    const fileStat = await stat(path)
    if (fileStat.size <= 0) throw new Error(`Release asset is empty: ${artifact.name}`)
    const digest = createHash('sha512').update(bytes).digest('base64')
    if (fileStat.size !== artifact.size || digest !== artifact.sha512) {
      throw new Error(`Release manifest does not match release asset: ${artifact.name}`)
    }
    if (artifact.kind === 'zip') verifyZipCentralDirectory(bytes, artifact.name)
    if (artifact.kind === 'nsis') verifyWindowsInstaller(bytes, artifact.name)
  }

  await verifyUpdaterMetadata(releaseDir, manifest, definitions)
}

await main()
