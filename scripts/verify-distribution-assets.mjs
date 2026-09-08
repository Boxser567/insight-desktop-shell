import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  assertReleaseIdentity,
  assertSafeAssetName,
  releaseAssetNames
} from './update-release-contract.mjs'
import { verifyReleaseAssets } from './verify-release-assets.mjs'

const immutableCacheDirectives = ['public', 'max-age=31536000', 'immutable']

function usage() {
  return 'Usage: verify-distribution-assets.mjs --dir <path> --version <semver> --channel <candidate|stable> --origin <https-origin> --public-key <path>'
}

function parseArguments(argv) {
  const allowed = new Set(['--dir', '--version', '--channel', '--origin', '--public-key'])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(name) || !value || values.has(name)) throw new Error(usage())
    values.set(name, value)
  }
  if (values.size !== allowed.size) throw new Error(usage())
  return Object.fromEntries(values)
}

function parseOrigin(value, allowHttpLoopback) {
  let origin
  try {
    origin = new URL(value)
  } catch {
    throw new Error('Distribution origin is invalid.')
  }
  const loopback = allowHttpLoopback &&
    origin.protocol === 'http:' &&
    (origin.hostname === '127.0.0.1' || origin.hostname === 'localhost' || origin.hostname === '::1')
  if (
    (!loopback && origin.protocol !== 'https:') ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    throw new Error('Distribution origin must be a pathless HTTPS origin.')
  }
  return origin
}

function expectedContentTypes(name) {
  if (name.endsWith('.json')) return new Set(['application/json'])
  if (name.endsWith('.yml')) {
    return new Set([
      'application/yaml',
      'application/x-yaml',
      'text/yaml',
      'text/x-yaml',
      'application/octet-stream'
    ])
  }
  if (name.endsWith('.dmg')) {
    return new Set(['application/x-apple-diskimage', 'application/octet-stream'])
  }
  if (name.endsWith('.zip')) {
    return new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream'])
  }
  if (name.endsWith('.exe')) {
    return new Set([
      'application/vnd.microsoft.portable-executable',
      'application/x-msdownload',
      'application/octet-stream'
    ])
  }
  if (name.endsWith('.sig')) {
    return new Set(['application/pgp-signature', 'application/octet-stream'])
  }
  return new Set(['application/octet-stream'])
}

function assertHeaders(response, name, size) {
  const contentLength = Number(response.headers.get('content-length'))
  if (!Number.isSafeInteger(contentLength) || contentLength !== size) {
    throw new Error(`Distribution Content-Length is invalid: ${name}`)
  }
  const cacheControl = (response.headers.get('cache-control') ?? '')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim())
  if (immutableCacheDirectives.some((directive) => !cacheControl.includes(directive))) {
    throw new Error(`Distribution cache policy is invalid: ${name}`)
  }
  if ((response.headers.get('accept-ranges') ?? '').toLowerCase() !== 'bytes') {
    throw new Error(`Distribution byte ranges are unavailable: ${name}`)
  }
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
  if (!expectedContentTypes(name).has(contentType)) {
    throw new Error(`Distribution Content-Type is invalid: ${name}`)
  }
}

function assertExactResponse(response, expectedUrl, status, label) {
  if (response.url !== expectedUrl.href || response.status !== status) {
    throw new Error(`${label} response is redirected or has an unexpected status.`)
  }
}

async function request(fetchImpl, url, init, status, label) {
  const fullDownload = init.method === 'GET' && !init.headers?.Range
  const response = await fetchImpl(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(fullDownload ? 10 * 60_000 : 30_000)
  })
  assertExactResponse(response, url, status, label)
  return response
}

async function verifyRemoteFile(fetchImpl, baseUrl, releaseDir, name) {
  assertSafeAssetName(name)
  const localPath = join(releaseDir, basename(name))
  const [localBytes, localStat] = await Promise.all([readFile(localPath), stat(localPath)])
  if (localStat.size <= 0) throw new Error(`Distribution asset is empty: ${name}`)
  const url = new URL(name, baseUrl)

  const head = await request(fetchImpl, url, { method: 'HEAD' }, 200, `HEAD ${name}`)
  assertHeaders(head, name, localStat.size)

  const full = await request(fetchImpl, url, { method: 'GET' }, 200, `GET ${name}`)
  const remoteBytes = Buffer.from(await full.arrayBuffer())
  if (
    remoteBytes.length !== localBytes.length ||
    !createHash('sha512').update(remoteBytes).digest().equals(
      createHash('sha512').update(localBytes).digest()
    )
  ) {
    throw new Error(`Distribution bytes do not match the verified release: ${name}`)
  }

  const range = await request(fetchImpl, url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' }
  }, 206, `Range ${name}`)
  const rangeBytes = Buffer.from(await range.arrayBuffer())
  if (
    rangeBytes.length !== 1 ||
    rangeBytes[0] !== localBytes[0] ||
    range.headers.get('content-range') !== `bytes 0-0/${localStat.size}`
  ) {
    throw new Error(`Distribution range response is invalid: ${name}`)
  }

  return {
    name,
    size: localStat.size,
    sha512: createHash('sha512').update(localBytes).digest('base64')
  }
}

export async function verifyDistributionAssets({
  releaseDir,
  version,
  channel,
  origin,
  publicKeyPath,
  fetchImpl = globalThis.fetch,
  allowHttpLoopback = false
}) {
  assertReleaseIdentity(channel, version)
  const parsedOrigin = parseOrigin(origin, allowHttpLoopback)
  const resolvedDir = resolve(releaseDir)
  await verifyReleaseAssets({
    releaseDir: resolvedDir,
    version,
    channel,
    publicKeyPath
  })
  const baseUrl = new URL(`desktop/releases/v${version}/`, parsedOrigin)
  const files = []
  for (const name of releaseAssetNames(channel, version)) {
    files.push(await verifyRemoteFile(fetchImpl, baseUrl, resolvedDir, name))
  }
  return {
    channel,
    version,
    releaseBaseUrl: baseUrl.href,
    files
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const result = await verifyDistributionAssets({
    releaseDir: args['--dir'],
    version: args['--version'],
    channel: args['--channel'],
    origin: args['--origin'],
    publicKeyPath: args['--public-key']
  })
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
