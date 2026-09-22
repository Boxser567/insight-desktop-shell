import { verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { parseCanonicalV2Envelope } from './update-v2-contract.mjs'

const MAX_UPDATE_METADATA_BYTES = 4 * 1024 * 1024

function parseArguments(argv) {
  const names = new Set([
    '--version', '--commit', '--repository', '--token', '--package', '--public-key', '--floor-url'
  ])
  const values = new Map()
  const floorUrls = []
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!names.has(name) || !value || (values.has(name) && name !== '--floor-url')) {
      throw new Error(usage())
    }
    if (name === '--floor-url') {
      floorUrls.push(value)
      continue
    }
    values.set(name, value)
  }
  for (const name of ['--version', '--commit', '--repository', '--token', '--package', '--public-key']) {
    if (!values.has(name)) throw new Error(usage())
  }
  return { ...Object.fromEntries(values), floorUrls }
}

function usage() {
  return 'Usage: prepare-update-v2-draft.mjs --version <final-semver> --commit <sha> --repository <owner/name> --token <token> --package <path> --public-key <path> [--floor-url <https-url>]...'
}

function assertVersion(version) {
  const parsed = semver.parse(version)
  if (
    semver.valid(version) !== version || !parsed ||
    parsed.prerelease.length > 0 || parsed.build.length > 0
  ) throw new Error('v2 release version must be a final semantic version.')
}

async function githubRequest(input, path, init = {}) {
  const response = await input.fetch(`https://api.github.com/repos/${input.repository}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${input.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers
    }
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status} ${path}`)
  return response.json()
}

async function readPointerVersion(input, rawUrl, publicKeyPem) {
  const url = new URL(rawUrl)
  if (
    url.protocol !== 'https:' || url.hostname !== 'updates.insight-aigc.com' ||
    url.username || url.password || url.hash || url.search
  ) throw new Error('Version floor URL is not an approved public update URL.')
  const legacyCandidate = url.pathname === '/desktop/candidate/current.json'
  const stable = url.pathname === '/desktop/stable/current.json'
  const candidateMatch = /^\/desktop\/candidate-v2\/(darwin-arm64|darwin-x64|win32-x64)\/current\.json$/u.exec(
    url.pathname
  )
  if (!legacyCandidate && !stable && !candidateMatch) {
    throw new Error('Version floor URL is not an approved public update URL.')
  }
  const response = await input.fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000)
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Version floor request failed: ${response.status}`)
  const bytes = await readBoundedResponse(response, 'Version floor pointer')
  const value = JSON.parse(bytes.toString('utf8'))
  if (
    legacyCandidate && value?.schemaVersion === 1 &&
    value.channel === 'candidate' && semver.valid(value.version) === value.version &&
    Object.keys(value).sort().join(',') === 'channel,schemaVersion,version'
  ) {
    if (value.version !== '1.0.0-rc.19') {
      throw new Error('Legacy version floor must be exactly the signed rc.19 bridge.')
    }
    const releaseUrl = new URL(`/desktop/releases/v${value.version}/insight-update.json`, url)
    const signatureUrl = new URL(`${releaseUrl.pathname}.sig`, url)
    const [manifestResponse, signatureResponse] = await Promise.all([
      input.fetch(releaseUrl, { redirect: 'error', signal: AbortSignal.timeout(30_000) }),
      input.fetch(signatureUrl, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
    ])
    if (!manifestResponse.ok || !signatureResponse.ok) {
      throw new Error('Signed rc.19 recovery bridge is unavailable.')
    }
    const [manifestBytes, signatureBytes] = await Promise.all([
      readBoundedResponse(manifestResponse, 'rc.19 recovery Manifest'),
      readBoundedResponse(signatureResponse, 'rc.19 recovery signature')
    ])
    if (!verify(null, manifestBytes, publicKeyPem, signatureBytes)) {
      throw new Error('Signed rc.19 recovery bridge is invalid.')
    }
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    if (
      manifest?.schema !== 'insight-desktop-update/v1' ||
      manifest.version !== value.version || manifest.channel !== 'candidate'
    ) throw new Error('Signed rc.19 recovery bridge identity is invalid.')
    return value.version
  }
  const authenticated = parseCanonicalV2Envelope(bytes)
  const { payload, payloadBytes, signatureBytes } = authenticated
  if (!verify(null, payloadBytes, publicKeyPem, signatureBytes)) {
    throw new Error('Version floor rollout signature is invalid.')
  }
  if (stable && (payload.track !== 'stable' || payload.target !== undefined)) {
    throw new Error('Version floor Stable pointer identity is invalid.')
  }
  if (candidateMatch && (
    payload.track !== 'candidate' || payload.target !== candidateMatch[1]
  )) throw new Error('Version floor Candidate pointer identity is invalid.')
  return payload.version
}

async function readBoundedResponse(response, label) {
  const contentLength = response.headers.get('content-length')
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_UPDATE_METADATA_BYTES)
  ) throw new Error(`${label} exceeds the allowed size.`)
  if (!response.body) return Buffer.alloc(0)
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.byteLength
    if (total > MAX_UPDATE_METADATA_BYTES) {
      throw new Error(`${label} exceeds the allowed size.`)
    }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks, total)
}

async function assertAuthoritativePointerFloor(input, continuation) {
  const urls = input.floorUrls ?? []
  if (urls.length === 0) throw new Error('At least one authoritative version floor URL is required.')
  const publicKeyPem = await readFile(resolve(input.publicKeyPath), 'utf8')
  const versions = (await Promise.all(urls.map((url) =>
    readPointerVersion(input, url, publicKeyPem)
  ))).filter(Boolean)
  const floor = versions.sort(semver.rcompare)[0]
  if (floor && (semver.gt(floor, input.version) || (!continuation && !semver.gt(input.version, floor)))) {
    throw new Error(continuation
      ? `v2 release version is below authoritative floor ${floor}.`
      : `v2 release version must be greater than authoritative floor ${floor}.`)
  }
  return floor ?? null
}

export async function prepareV2Draft(input) {
  assertVersion(input.version)
  if (!/^[0-9a-f]{40}$/u.test(input.commit)) throw new Error('Release commit is invalid.')
  const tag = `v${input.version}`
  const refPath = `/git/ref/tags/${encodeURIComponent(tag)}`
  let ref = await githubRequest(input, refPath)
  const continuation = ref !== undefined
  const packageJson = JSON.parse(await readFile(resolve(input.packagePath), 'utf8'))
  if (!continuation && packageJson.version !== input.version) {
    throw new Error('package.json version does not match the requested v2 release.')
  }
  const versionFloor = await assertAuthoritativePointerFloor(input, continuation)
  const tagRefs = await githubRequest(input, '/git/matching-refs/tags/v')
  if (!Array.isArray(tagRefs)) throw new Error('GitHub Tag listing is invalid.')
  const allocatedVersions = tagRefs.flatMap((entry) => {
    const match = /^refs\/tags\/v(\d+\.\d+\.\d+)$/u.exec(entry?.ref)
    return match && semver.valid(match[1]) === match[1] ? [match[1]] : []
  })
  const allocatedFloor = allocatedVersions.sort(semver.rcompare)[0]
  if (
    allocatedFloor &&
    (semver.gt(allocatedFloor, input.version) || (!ref && !semver.gt(input.version, allocatedFloor)))
  ) throw new Error(`v2 release version must exceed allocated Tag floor ${allocatedFloor}.`)
  let createdTag = false
  if (!ref) {
    ref = await githubRequest(input, '/git/refs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: input.commit })
    })
    createdTag = true
  }
  const pinnedCommit = ref?.object?.sha
  if (!/^[0-9a-f]{40}$/u.test(pinnedCommit ?? '')) throw new Error('v2 release Tag is invalid.')

  let release = await githubRequest(input, `/releases/tags/${encodeURIComponent(tag)}`)
  let createdDraft = false
  if (!release) {
    release = await githubRequest(input, '/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: pinnedCommit,
        name: `因赛AI v${input.version}`,
        draft: true,
        prerelease: false,
        generate_release_notes: false
      })
    })
    createdDraft = true
  }
  if (!release?.draft || release.tag_name !== tag) {
    throw new Error('Existing GitHub Release is not the expected Draft.')
  }
  return {
    tag,
    commit: pinnedCommit,
    releaseId: release.id,
    versionFloor,
    createdTag,
    createdDraft
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const result = await prepareV2Draft({
    version: args['--version'],
    commit: args['--commit'],
    repository: args['--repository'],
    token: args['--token'],
    packagePath: args['--package'],
    publicKeyPath: args['--public-key'],
    floorUrls: args.floorUrls,
    fetch: globalThis.fetch
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
