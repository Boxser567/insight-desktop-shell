import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

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

function parseCanonicalBase64(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is invalid.`)
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error(`${label} is not canonical Base64.`)
  return bytes
}

async function readPointerVersion(input, rawUrl, publicKeyPem) {
  const url = new URL(rawUrl)
  if (
    url.protocol !== 'https:' || url.hostname !== 'updates.insight-aigc.com' ||
    url.username || url.password || url.hash
  ) throw new Error('Version floor URL is not an approved public update URL.')
  const response = await input.fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000)
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Version floor request failed: ${response.status}`)
  const value = await response.json()
  if (
    value?.schemaVersion === 1 &&
    (value.channel === 'stable' || value.channel === 'candidate') &&
    semver.valid(value.version) === value.version
  ) return value.version
  const { verify } = await import('node:crypto')
  const payloadBytes = parseCanonicalBase64(value?.payloadBase64, 'Rollout payload')
  const signature = parseCanonicalBase64(value?.signatureBase64, 'Rollout signature')
  if (!verify(null, payloadBytes, publicKeyPem, signature)) {
    throw new Error('Version floor rollout signature is invalid.')
  }
  const payload = JSON.parse(payloadBytes.toString('utf8'))
  if (
    payload?.schema !== 'insight-desktop-rollout/v2' ||
    semver.valid(payload.version) !== payload.version
  ) throw new Error('Version floor rollout payload is invalid.')
  return payload.version
}

async function assertAboveAuthoritativePointers(input) {
  const urls = input.floorUrls ?? []
  if (urls.length === 0) throw new Error('At least one authoritative version floor URL is required.')
  const publicKeyPem = await readFile(resolve(input.publicKeyPath), 'utf8')
  const versions = (await Promise.all(urls.map((url) =>
    readPointerVersion(input, url, publicKeyPem)
  ))).filter(Boolean)
  const floor = versions.sort(semver.rcompare)[0]
  if (floor && !semver.gt(input.version, floor)) {
    throw new Error(`v2 release version must be greater than authoritative floor ${floor}.`)
  }
  return floor ?? null
}

export async function prepareV2Draft(input) {
  assertVersion(input.version)
  if (!/^[0-9a-f]{40}$/u.test(input.commit)) throw new Error('Release commit is invalid.')
  const packageJson = JSON.parse(await readFile(resolve(input.packagePath), 'utf8'))
  if (packageJson.version !== input.version) {
    throw new Error('package.json version does not match the requested v2 release.')
  }
  const versionFloor = await assertAboveAuthoritativePointers(input)
  const tag = `v${input.version}`
  const refPath = `/git/ref/tags/${encodeURIComponent(tag)}`
  let ref = await githubRequest(input, refPath)
  let createdTag = false
  if (!ref) {
    ref = await githubRequest(input, '/git/refs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/tags/${tag}`, sha: input.commit })
    })
    createdTag = true
  }
  if (ref?.object?.sha !== input.commit) {
    throw new Error('Existing v2 release Tag points to another commit.')
  }

  let release = await githubRequest(input, `/releases/tags/${encodeURIComponent(tag)}`)
  let createdDraft = false
  if (!release) {
    release = await githubRequest(input, '/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: input.commit,
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
    commit: input.commit,
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
