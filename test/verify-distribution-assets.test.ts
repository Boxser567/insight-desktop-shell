import { createServer, type Server } from 'node:http'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Production scripts are plain ESM and expose runtime-tested helpers.
import { verifyDistributionAssets } from '../scripts/verify-distribution-assets.mjs'
import { writeReleaseFixture } from './release-script-fixtures'

const temporaryDirectories: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-distribution-verify-'))
  temporaryDirectories.push(root)
  const paths = await writeReleaseFixture(root)
  const built = spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'build-update-release.mjs'),
    '--dir', paths.releaseDir,
    '--version', '0.1.2',
    '--channel', 'stable',
    '--shell-commit', 'a'.repeat(40),
    '--runtime-manifest', paths.runtimeManifest,
    '--compatibility', paths.compatibility,
    '--policy', paths.policy,
    '--private-key', paths.privateKey
  ], { encoding: 'utf8' })
  expect(built.status, built.stderr).toBe(0)
  const files = new Map<string, Buffer>()
  for (const name of await readdir(paths.releaseDir)) {
    files.set(name, await readFile(path.join(paths.releaseDir, name)))
  }
  return { ...paths, files }
}

function contentType(name: string): string {
  if (name.endsWith('.json')) return 'application/json; charset=utf-8'
  if (name.endsWith('.yml')) return 'application/yaml'
  if (name.endsWith('.zip')) return 'application/zip'
  if (name.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (name.endsWith('.exe')) return 'application/x-msdownload'
  return 'application/octet-stream'
}

async function origin(
  files: Map<string, Buffer>,
  behavior: {
    tamper?: string
    truncate?: string
    noRange?: string
    wrongCache?: string
    redirect?: string
  } = {}
) {
  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname.split('/').at(-1) ?? '')
    const stored = files.get(name)
    if (!stored) {
      response.writeHead(404).end()
      return
    }
    if (behavior.redirect === name) {
      response.writeHead(302, { Location: `/redirected/${name}` }).end()
      return
    }
    let bytes = stored
    if (behavior.tamper === name) {
      bytes = Buffer.from(stored)
      bytes[0] = bytes[0]! ^ 0xff
    }
    if (behavior.truncate === name) bytes = bytes.subarray(0, bytes.length - 1)
    const headers = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': behavior.wrongCache === name
        ? 'public,max-age=60'
        : 'public,max-age=31536000,immutable',
      'Content-Type': contentType(name)
    }
    if (request.headers.range === 'bytes=0-0' && behavior.noRange !== name) {
      response.writeHead(206, {
        ...headers,
        'Content-Length': '1',
        'Content-Range': `bytes 0-0/${bytes.length}`
      })
      response.end(bytes.subarray(0, 1))
      return
    }
    response.writeHead(200, { ...headers, 'Content-Length': String(bytes.length) })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP address.')
  return `http://127.0.0.1:${address.port}`
}

async function verify(
  value: Awaited<ReturnType<typeof fixture>>,
  updateOrigin: string,
  overrides: Record<string, unknown> = {}
) {
  return verifyDistributionAssets({
    releaseDir: value.releaseDir,
    version: '0.1.2',
    channel: 'stable',
    origin: updateOrigin,
    publicKeyPath: value.publicKey,
    allowHttpLoopback: true,
    ...overrides
  })
}

describe('final distribution verifier', () => {
  it('accepts exact immutable bytes with HEAD and byte range support', async () => {
    const value = await fixture()
    const result = await verify(value, await origin(value.files))

    expect(result.version).toBe('0.1.2')
    expect(result.files).toHaveLength(value.files.size)
    expect(result.releaseBaseUrl).toContain('/desktop/releases/v0.1.2/')
  })

  it('retries network failures without relaxing response validation', async () => {
    const value = await fixture()
    const updateOrigin = await origin(value.files)
    let attempts = 0
    const fetchImpl: typeof fetch = async (...args) => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed')
      return fetch(...args)
    }

    const result = await verify(value, updateOrigin, {
      fetchImpl,
      delayImpl: async () => undefined
    })
    expect(result.version).toBe('0.1.2')
    expect(attempts).toBeGreaterThan(value.files.size * 3)
  })

  it('rejects truncated or digest-mismatched remote bytes', async () => {
    const truncated = await fixture()
    await expect(verify(
      truncated,
      await origin(truncated.files, { truncate: 'insight-0.1.2-mac-arm64.dmg' })
    )).rejects.toThrow('Content-Length')

    const tampered = await fixture()
    await expect(verify(
      tampered,
      await origin(tampered.files, { tamper: 'insight-update.json.sig' })
    )).rejects.toThrow('bytes do not match')
  })

  it('rejects missing Range support, mutable cache headers, and redirects', async () => {
    const noRange = await fixture()
    await expect(verify(
      noRange,
      await origin(noRange.files, { noRange: 'latest.yml' })
    )).rejects.toThrow('Range latest.yml')

    const wrongCache = await fixture()
    await expect(verify(
      wrongCache,
      await origin(wrongCache.files, { wrongCache: 'insight-update.json' })
    )).rejects.toThrow('cache policy')

    const redirected = await fixture()
    await expect(verify(
      redirected,
      await origin(redirected.files, { redirect: 'latest-mac.yml' })
    )).rejects.toThrow('redirected or has an unexpected status')
  })

  it('rejects non-HTTPS non-loopback and path-bearing origins', async () => {
    const value = await fixture()
    await expect(verify(value, 'http://updates.example.test')).rejects.toThrow('HTTPS origin')
    await expect(verify(value, 'https://updates.example.test/desktop')).rejects.toThrow('HTTPS origin')
  })
})
