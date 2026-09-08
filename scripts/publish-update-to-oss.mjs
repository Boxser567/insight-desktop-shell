import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  releaseAssetNames,
  releaseChannelForVersion
} from './update-release-contract.mjs'
import { verifyDistributionAssets } from './verify-distribution-assets.mjs'
import { verifyReleaseAssets } from './verify-release-assets.mjs'

const execFile = promisify(execFileCallback)
const repository = 'Boxser567/insight-desktop-shell'
const expectedBucket = 'insight-desktop-updates'
const expectedOrigin = 'https://updates.insight-aigc.com'
const expectedProfile = 'desktop-updates-publisher'
const requiredOssutilVersion = '2.3.0'
const immutableCache = 'public,max-age=31536000,immutable'
const pointerCache = 'public,max-age=60,must-revalidate'
const lockPath = join(tmpdir(), 'insight-desktop-update-publisher.lock')
const sensitiveEnvironmentNames = new Set([
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_SESSION_TOKEN',
  'OSSUTIL_CONFIG_FILE',
  'OSSUTIL_PROFILE'
])

function usage() {
  return [
    'Usage:',
    '  publish-update-to-oss.mjs stage --tag <v-semver> --bucket insight-desktop-updates --origin https://updates.insight-aigc.com --profile desktop-updates-publisher',
    '  publish-update-to-oss.mjs promote --tag <v-semver> --bucket insight-desktop-updates --origin https://updates.insight-aigc.com --profile desktop-updates-publisher --confirm-version <semver>'
  ].join('\n')
}

export function parsePublisherArguments(argv) {
  const [command, ...rest] = argv
  if (command !== 'stage' && command !== 'promote') throw new Error(usage())
  const allowed = new Set([
    '--tag',
    '--bucket',
    '--origin',
    '--profile',
    ...(command === 'promote' ? ['--confirm-version'] : [])
  ])
  const values = new Map()
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]
    const value = rest[index + 1]
    if (!allowed.has(name) || !value || values.has(name)) throw new Error(usage())
    values.set(name, value)
  }
  if (values.size !== allowed.size) throw new Error(usage())
  const tag = values.get('--tag')
  if (!/^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/u.test(tag)) throw new Error('Release tag is invalid.')
  const version = tag.slice(1)
  const channel = releaseChannelForVersion(version)
  if (values.get('--bucket') !== expectedBucket) throw new Error('OSS bucket is not approved.')
  if (values.get('--origin') !== expectedOrigin) throw new Error('Update origin is not approved.')
  if (values.get('--profile') !== expectedProfile) throw new Error('ossutil profile is not approved.')
  const confirmedVersion = values.get('--confirm-version')
  if (command === 'promote' && confirmedVersion !== version) {
    throw new Error('Promotion confirmation does not match the release version.')
  }
  return {
    command,
    tag,
    version,
    channel,
    bucket: expectedBucket,
    origin: expectedOrigin,
    profile: expectedProfile
  }
}

export function assertNoOssCredentialEnvironment(environment) {
  const found = Object.keys(environment).find((name) => sensitiveEnvironmentNames.has(name))
  if (found) {
    throw new Error('Remove OSS credential or config environment variables before running the publisher.')
  }
}

function childEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !sensitiveEnvironmentNames.has(name))
  )
}

export function ossArguments(args, profile) {
  return [...args, '--profile', profile, '--ignore-env-var', '--loglevel', 'off']
}

async function run(file, args, environment = process.env) {
  try {
    return await execFile(file, args, {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: childEnvironment(environment),
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30 * 60_000,
      windowsHide: true
    })
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr).trim()
      : ''
    throw new Error(`${file} failed${stderr ? `: ${stderr}` : '.'}`)
  }
}

async function runOss(args, profile) {
  return run('ossutil', ossArguments(args, profile))
}

export async function acquirePublisherLock() {
  let handle
  try {
    handle = await open(lockPath, 'wx', 0o600)
    await handle.writeFile(`${process.pid}\n`, 'utf8')
    return async () => {
      try {
        await handle.close()
      } finally {
        await unlink(lockPath).catch((error) => {
          if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error
        })
      }
    }
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined)
      await unlink(lockPath).catch(() => undefined)
    }
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error(`Another local desktop update publisher holds ${lockPath}.`)
    }
    throw error
  }
}

export function parseObjectList(stdout) {
  const value = JSON.parse(stdout)
  if (value?.IsTruncated === true || value?.isTruncated === true) {
    throw new Error('OSS release prefix contains more objects than the publisher permits.')
  }
  const contents = value?.Contents ?? value?.contents ?? value?.ListBucketResult?.Contents ?? []
  const entries = contents === null ? [] : Array.isArray(contents) ? contents : [contents]
  return entries.map((entry) => {
    const key = entry?.Key ?? entry?.key
    const size = Number(entry?.Size ?? entry?.size)
    if (typeof key !== 'string' || !Number.isSafeInteger(size) || size < 0) {
      throw new Error('OSS object listing is invalid.')
    }
    return { key, size }
  })
}

export function assertBucketVersioningDisabled(stdout) {
  const value = JSON.parse(stdout)
  const status = value?.Status ?? value?.status
  if (status !== undefined && status !== null && status !== '') {
    throw new Error('OSS bucket versioning must remain unconfigured so forbid-overwrite is enforceable.')
  }
}

async function listObjects(prefix, options) {
  const result = await runOss([
    'api',
    'list-objects-v2',
    '--bucket', options.bucket,
    '--prefix', prefix,
    '--max-keys', '1000',
    '--output-format', 'json'
  ], options.profile)
  return parseObjectList(result.stdout)
}

async function releaseFiles(releaseDir, channel, version) {
  const names = releaseAssetNames(channel, version)
  const files = []
  for (const name of names) {
    const bytes = await readFile(join(releaseDir, name))
    files.push({
      name,
      size: bytes.length,
      sha512: createHash('sha512').update(bytes).digest('base64')
    })
  }
  return files
}

export function assertExactRemoteFiles(objects, files, prefix) {
  const expected = files
    .map((file) => ({ key: `${prefix}${file.name}`, size: file.size }))
    .sort((left, right) => left.key.localeCompare(right.key))
  const actual = [...objects].sort((left, right) => left.key.localeCompare(right.key))
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) =>
      entry.key !== expected[index].key || entry.size !== expected[index].size
    )
  ) {
    throw new Error('OSS immutable release prefix is partial or differs from the verified Draft.')
  }
}

async function viewRelease(options) {
  const result = await run('gh', [
    'release', 'view', options.tag,
    '--repo', repository,
    '--json', 'tagName,isDraft,isPrerelease'
  ])
  const release = JSON.parse(result.stdout)
  if (
    release.tagName !== options.tag ||
    typeof release.isDraft !== 'boolean' ||
    typeof release.isPrerelease !== 'boolean' ||
    release.isPrerelease !== (options.channel === 'candidate')
  ) {
    throw new Error('GitHub Release identity does not match the requested release.')
  }
  return release
}

async function downloadAndVerifyRelease(options, temporaryDirectory) {
  const release = await viewRelease(options)
  const releaseDir = join(temporaryDirectory, 'release-assets')
  await mkdir(releaseDir, { mode: 0o700 })
  await run('gh', [
    'release', 'download', options.tag,
    '--repo', repository,
    '--dir', releaseDir
  ])
  const manifest = await verifyReleaseAssets({
    releaseDir,
    version: options.version,
    channel: options.channel,
    publicKeyPath: join(resolve('.'), 'build', 'update-signing-public.pem')
  })
  return { release, releaseDir, manifest }
}

async function assertOssutilVersion(options) {
  const result = await runOss(['version'], options.profile)
  if (!new RegExp(`(?:^|\\D)${requiredOssutilVersion.replaceAll('.', '\\.')}(?:\\D|$)`, 'u').test(result.stdout)) {
    throw new Error(`ossutil ${requiredOssutilVersion} is required.`)
  }
}

async function verifyBucketConfiguration(options) {
  const result = await runOss([
    'api', 'get-bucket-versioning',
    '--bucket', options.bucket,
    '--output-format', 'json'
  ], options.profile)
  assertBucketVersioningDisabled(result.stdout)
}

async function uploadImmutableRelease(options, releaseDir, files) {
  const prefix = `desktop/releases/v${options.version}/`
  const existing = await listObjects(prefix, options)
  if (existing.length > 0) {
    assertExactRemoteFiles(existing, files, prefix)
    return { prefix, reused: true }
  }
  for (const file of files) {
    const args = [
      'api', 'put-object',
      '--bucket', options.bucket,
      '--key', `${prefix}${file.name}`,
      '--body', pathToFileURL(join(releaseDir, file.name)).href,
      '--forbid-overwrite', 'true',
      '--cache-control', immutableCache
    ]
    if (file.name.endsWith('.dmg') || file.name.endsWith('.exe')) {
      args.push('--content-disposition', `attachment; filename="${basename(file.name)}"`)
    }
    await runOss(args, options.profile)
  }
  assertExactRemoteFiles(await listObjects(prefix, options), files, prefix)
  return { prefix, reused: false }
}

async function verifyCdn(options, releaseDir) {
  return verifyDistributionAssets({
    releaseDir,
    version: options.version,
    channel: options.channel,
    origin: options.origin,
    publicKeyPath: join(resolve('.'), 'build', 'update-signing-public.pem')
  })
}

async function readAuthoritativePointer(options, temporaryDirectory, suffix) {
  const key = `desktop/${options.channel}/current.json`
  const objects = await listObjects(key, options)
  if (objects.length === 0) return { key, path: undefined, bytes: undefined, value: undefined }
  if (objects.length !== 1 || objects[0].key !== key) {
    throw new Error('OSS channel pointer prefix contains unexpected objects.')
  }
  const output = join(temporaryDirectory, `current-${suffix}.json`)
  await runOss([
    'cp',
    `oss://${options.bucket}/${key}`,
    output,
    '--force'
  ], options.profile)
  const bytes = await readFile(output)
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('OSS channel pointer is not valid JSON.')
  }
  return { key, path: output, bytes, value }
}

async function buildPointer(options, temporaryDirectory, current) {
  const output = join(temporaryDirectory, 'next-current.json')
  const args = [
    join(resolve('.'), 'scripts', 'build-update-pointer.mjs'),
    '--channel', options.channel,
    '--version', options.version,
    '--output', output
  ]
  if (current.path) args.push('--current', current.path)
  await run(process.execPath, args)
  return { path: output, bytes: await readFile(output) }
}

function pointerIsTarget(pointer, options) {
  return pointer.value?.schemaVersion === 1 &&
    pointer.value?.channel === options.channel &&
    pointer.value?.version === options.version &&
    Object.keys(pointer.value).sort().join(',') === 'channel,schemaVersion,version'
}

function pointersEqual(left, right) {
  if (left.bytes === undefined || right.bytes === undefined) return left.bytes === right.bytes
  return left.bytes.equals(right.bytes)
}

async function publishGithubRelease(options, release) {
  if (!release.isDraft) return false
  const args = [
    'release', 'edit', options.tag,
    '--draft=false',
    '--repo', repository
  ]
  if (options.channel === 'candidate') args.push('--prerelease')
  await run('gh', args)
  return true
}

async function uploadPointer(options, pointer) {
  await runOss([
    'api', 'put-object',
    '--bucket', options.bucket,
    '--key', `desktop/${options.channel}/current.json`,
    '--body', pathToFileURL(pointer.path).href,
    '--cache-control', pointerCache
  ], options.profile)
}

async function waitForPointer(options, expectedBytes, timeoutMs = 120_000) {
  const url = new URL(`desktop/${options.channel}/current.json`, options.origin)
  const deadline = Date.now() + timeoutMs
  let lastError
  do {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000)
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      const cacheControl = (response.headers.get('cache-control') ?? '').toLowerCase()
      if (
        response.status === 200 &&
        response.url === url.href &&
        bytes.equals(expectedBytes) &&
        response.headers.get('content-type')?.toLowerCase().startsWith('application/json') &&
        cacheControl.includes('max-age=60') &&
        cacheControl.includes('must-revalidate')
      ) return
      lastError = new Error('CDN channel pointer has not converged.')
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))
  } while (Date.now() < deadline)
  throw lastError ?? new Error('CDN channel pointer did not converge.')
}

async function writeReport(options, report) {
  const reportDirectory = join(resolve('.'), 'release-reports')
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 })
  const path = join(reportDirectory, `${options.tag}-${options.command}.json`)
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return path
}

async function stage(options, temporaryDirectory) {
  const { release, releaseDir, manifest } = await downloadAndVerifyRelease(options, temporaryDirectory)
  if (!release.isDraft) throw new Error('Stage requires a GitHub Draft Release.')
  const files = await releaseFiles(releaseDir, options.channel, options.version)
  const upload = await uploadImmutableRelease(options, releaseDir, files)
  const distribution = await verifyCdn(options, releaseDir)
  return {
    action: 'stage',
    tag: options.tag,
    channel: options.channel,
    version: options.version,
    shellCommit: manifest.shellCommit,
    coreRuntime: manifest.coreRuntime,
    githubRelease: `https://github.com/${repository}/releases/tag/${options.tag}`,
    ossPrefix: upload.prefix,
    reusedImmutablePrefix: upload.reused,
    files,
    distribution
  }
}

async function promote(options, temporaryDirectory) {
  const { release, releaseDir, manifest } = await downloadAndVerifyRelease(options, temporaryDirectory)
  const files = await releaseFiles(releaseDir, options.channel, options.version)
  const prefix = `desktop/releases/v${options.version}/`
  assertExactRemoteFiles(await listObjects(prefix, options), files, prefix)
  const distributionBefore = await verifyCdn(options, releaseDir)
  const currentBefore = await readAuthoritativePointer(options, temporaryDirectory, 'before')
  const alreadyCommitted = pointerIsTarget(currentBefore, options)
  if (alreadyCommitted && release.isDraft) {
    throw new Error('OSS pointer already targets a GitHub Draft; manual investigation is required.')
  }
  const pointer = alreadyCommitted
    ? { path: currentBefore.path, bytes: currentBefore.bytes }
    : await buildPointer(options, temporaryDirectory, currentBefore)
  const githubPublished = await publishGithubRelease(options, release)
  if (!alreadyCommitted) {
    const currentAfterGithub = await readAuthoritativePointer(options, temporaryDirectory, 'after-github')
    if (!pointersEqual(currentBefore, currentAfterGithub)) {
      throw new Error('OSS channel pointer changed during promotion.')
    }
    await buildPointer(options, temporaryDirectory, currentAfterGithub)
    await uploadPointer(options, pointer)
  }
  await waitForPointer(options, pointer.bytes)
  const distributionAfter = await verifyCdn(options, releaseDir)
  return {
    action: 'promote',
    tag: options.tag,
    channel: options.channel,
    version: options.version,
    shellCommit: manifest.shellCommit,
    coreRuntime: manifest.coreRuntime,
    githubRelease: `https://github.com/${repository}/releases/tag/${options.tag}`,
    githubPublished,
    pointerAlreadyCommitted: alreadyCommitted,
    pointerBefore: currentBefore.value ?? null,
    pointerAfter: JSON.parse(pointer.bytes.toString('utf8')),
    files,
    distributionBefore,
    distributionAfter
  }
}

async function main() {
  const options = parsePublisherArguments(process.argv.slice(2))
  assertNoOssCredentialEnvironment(process.env)
  const releaseLock = await acquirePublisherLock()
  let temporaryDirectory
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'insight-desktop-publish-'))
    await chmod(temporaryDirectory, 0o700)
    await assertOssutilVersion(options)
    await verifyBucketConfiguration(options)
    const report = options.command === 'stage'
      ? await stage(options, temporaryDirectory)
      : await promote(options, temporaryDirectory)
    const reportPath = await writeReport(options, {
      ...report,
      completedAt: new Date().toISOString()
    })
    console.log(JSON.stringify({ ok: true, reportPath, ...report }, null, 2))
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
    await releaseLock()
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
