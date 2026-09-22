import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const targets = new Set(['darwin-arm64', 'darwin-x64', 'win32-x64'])

function parseArguments(argv) {
  const names = new Set(['--repository', '--token', '--tag', '--target', '--dir'])
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
  return 'Usage: upload-update-v2-target.mjs --repository <owner/name> --token <token> --tag <tag> --target <id> --dir <path>'
}

async function request(input, url, init = {}) {
  const response = await input.fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${input.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers
    }
  })
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`)
  return response
}

async function fileDigest(path) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const file = await stat(path)
  return { size: file.size, sha512: hash.digest('base64') }
}

async function responseDigest(response, maximumSize) {
  if (!response.body) throw new Error('GitHub asset response has no body.')
  const hash = createHash('sha512')
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > maximumSize) {
      await response.body.cancel().catch(() => undefined)
      throw new Error('GitHub asset response exceeds the expected size.')
    }
    hash.update(chunk)
  }
  return { size, sha512: hash.digest('base64') }
}

export async function uploadV2Target(input) {
  if (!targets.has(input.target)) throw new Error('Update target is invalid.')
  if (!/^v\d+\.\d+\.\d+$/u.test(input.tag)) throw new Error('v2 Release Tag is invalid.')
  const releaseResponse = await request(
    input,
    `https://api.github.com/repos/${input.repository}/releases/tags/${encodeURIComponent(input.tag)}`
  )
  const release = await releaseResponse.json()
  if (!release?.draft || release.tag_name !== input.tag) {
    throw new Error('Target assets may only be appended to the matching Draft Release.')
  }
  const existingResponse = await request(
    input,
    `https://api.github.com/repos/${input.repository}/releases/${release.id}/assets?per_page=100`
  )
  const existing = await existingResponse.json()
  if (!Array.isArray(existing)) throw new Error('GitHub Release assets response is invalid.')
  const byName = new Map(existing.map((asset) => [asset.name, asset]))
  const directory = resolve(input.directory)
  const names = (await readdir(directory, { withFileTypes: true }))
  if (names.some((entry) => !entry.isFile())) throw new Error('Target asset directory may contain files only.')

  const report = []
  for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name)
    const local = await fileDigest(path)
    const assetName = `${input.target}--${entry.name}`
    const current = byName.get(assetName)
    if (current) {
      if (current.size !== local.size) throw new Error(`Existing Draft asset conflicts: ${assetName}`)
      const downloaded = await request(input, current.url, {
        headers: { Accept: 'application/octet-stream' }
      })
      const remote = await responseDigest(downloaded, local.size)
      if (remote.size !== local.size || remote.sha512 !== local.sha512) {
        throw new Error(`Existing Draft asset conflicts: ${assetName}`)
      }
      report.push({ name: assetName, sha512: local.sha512, action: 'verified' })
      continue
    }
    const uploadUrl = release.upload_url.replace('{?name,label}', '')
    await request(input, `${uploadUrl}?name=${encodeURIComponent(assetName)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(local.size)
      },
      body: createReadStream(path),
      duplex: 'half'
    })
    report.push({ name: assetName, sha512: local.sha512, action: 'uploaded' })
  }
  return report
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const report = await uploadV2Target({
    repository: args['--repository'],
    token: args['--token'],
    tag: args['--tag'],
    target: args['--target'],
    directory: args['--dir'],
    fetch: globalThis.fetch
  })
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
