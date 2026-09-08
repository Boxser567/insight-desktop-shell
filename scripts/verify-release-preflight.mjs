import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const targetNames = ['darwin-arm64', 'darwin-x64', 'win32-x64']
const commitPattern = /^[0-9a-f]{40}$/u
const sha256Pattern = /^[0-9a-f]{64}$/u
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/u

function parseVersion(value) {
  if (typeof value !== 'string') return undefined
  const match = versionPattern.exec(value)
  if (!match) return undefined
  const numbers = match.slice(1).map((part) => part === undefined ? undefined : Number(part))
  if (numbers.some((part) => part !== undefined && !Number.isSafeInteger(part))) return undefined
  return { major: numbers[0], minor: numbers[1], patch: numbers[2], rc: numbers[3] }
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (left.rc === undefined) return right.rc === undefined ? 0 : 1
  if (right.rc === undefined) return -1
  return left.rc - right.rc
}

function parseArguments(argv) {
  const names = new Set([
    '--tag',
    '--expected-channel',
    '--package',
    '--policy',
    '--runtime-lock'
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
  return 'Usage: verify-release-preflight.mjs --tag <v-semver> --expected-channel <candidate|stable> --package <path> --policy <path> --runtime-lock <path>'
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
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

function parseTag(tag) {
  const version = typeof tag === 'string' ? /^v(.+)$/u.exec(tag)?.[1] : undefined
  const parsed = parseVersion(version)
  if (version && parsed) {
    return { version, channel: parsed.rc === undefined ? 'stable' : 'candidate' }
  }
  throw new Error('Release tag must be v<semver> or v<semver>-rc.<number>.')
}

function validatePackage(value, version) {
  if (!value || typeof value !== 'object' || value.version !== version) {
    throw new Error(`package.json version must equal ${version}.`)
  }
}

function validatePolicy(value, version, channel) {
  assertExactKeys(
    value,
    ['schema', 'releaseVersion', 'channel', 'mode', 'minimumSupportedVersion'],
    'Release policy'
  )
  const minimum = parseVersion(value.minimumSupportedVersion)
  const release = parseVersion(version)
  if (
    value.schema !== 1 ||
    value.releaseVersion !== version ||
    value.channel !== channel ||
    !['optional', 'required'].includes(value.mode) ||
    !minimum ||
    !release ||
    compareVersions(minimum, release) > 0
  ) {
    throw new Error('Release policy does not match the requested release.')
  }
}

function validateRuntimeTarget(value, name, releaseTag) {
  assertExactKeys(value, ['url', 'sha256', 'core', 'node', 'pnpm'], `Runtime target ${name}`)
  assertExactKeys(value.core, ['repository', 'version', 'commit'], `Runtime target ${name} core`)
  assertExactKeys(value.node, ['version'], `Runtime target ${name} node`)
  assertExactKeys(value.pnpm, ['version'], `Runtime target ${name} pnpm`)
  const expectedUrl =
    `https://github.com/Boxser567/insight-harness-core/releases/download/${releaseTag}/` +
    `insight-harness-runtime-${value.core.version}-${name}.tar.gz`
  if (
    value.url !== expectedUrl ||
    typeof value.sha256 !== 'string' ||
    !sha256Pattern.test(value.sha256) ||
    value.core.repository !== 'Boxser567/insight-harness-core' ||
    !parseVersion(value.core.version) ||
    typeof value.core.commit !== 'string' ||
    !commitPattern.test(value.core.commit) ||
    !parseVersion(value.node.version) ||
    !parseVersion(value.pnpm.version)
  ) {
    throw new Error(`Runtime target ${name} is invalid.`)
  }
}

function validateRuntimeLock(value) {
  assertExactKeys(value, ['schemaVersion', 'releaseTag', 'targets'], 'Core Runtime lock')
  const tagVersion = typeof value.releaseTag === 'string'
    ? /^insight-runtime-v(.+)$/u.exec(value.releaseTag)?.[1]
    : undefined
  if (value.schemaVersion !== 1 || !parseVersion(tagVersion)) {
    throw new Error('Core Runtime lock header is invalid.')
  }
  assertExactKeys(value.targets, targetNames, 'Core Runtime targets')
  for (const name of targetNames) validateRuntimeTarget(value.targets[name], name, value.releaseTag)
  const commits = new Set(targetNames.map((name) => value.targets[name].core.commit))
  if (commits.size !== 1) throw new Error('Core Runtime targets do not use one Core commit.')
  return { tag: value.releaseTag, commit: [...commits][0] }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const expectedChannel = args['--expected-channel']
  if (!['candidate', 'stable'].includes(expectedChannel)) {
    throw new Error('Expected channel must be candidate or stable.')
  }
  const release = parseTag(args['--tag'])
  if (release.channel !== expectedChannel) {
    throw new Error(`Release tag channel must be ${expectedChannel}.`)
  }
  const [packageJson, policy, runtimeLock] = await Promise.all([
    readJson(args['--package'], 'package.json'),
    readJson(args['--policy'], 'release policy'),
    readJson(args['--runtime-lock'], 'Core Runtime lock')
  ])
  validatePackage(packageJson, release.version)
  validatePolicy(policy, release.version, release.channel)
  const runtime = validateRuntimeLock(runtimeLock)
  process.stdout.write(`${JSON.stringify({
    tag: args['--tag'],
    version: release.version,
    channel: release.channel,
    runtimeTag: runtime.tag,
    runtimeCommit: runtime.commit,
    targets: targetNames
  })}\n`)
}

await main()
