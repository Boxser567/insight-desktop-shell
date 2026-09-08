import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import { GenericReleaseSource } from '../src/main/update/generic-release-source'
import { parseUpdateDistribution } from '../src/main/update/update-environment'
import type { ExecutorEvent, UpdateExecutor } from '../src/main/update/update-executor'
import { UpdateManager, type UpdateManagerTimers } from '../src/main/update/update-manager'
import type { ReleaseArtifact, SignedReleaseManifest } from '../src/shared/update-contracts'

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

function artifact(
  kind: ReleaseArtifact['kind'],
  name: string,
  bytes: Uint8Array
): ReleaseArtifact {
  return {
    platform: 'darwin',
    arch: 'arm64',
    kind,
    name,
    size: bytes.byteLength,
    sha512: createHash('sha512').update(bytes).digest('base64')
  }
}

class PassiveTimers implements UpdateManagerTimers {
  setTimeout(): object { return {} }
  clearTimeout(): void {}
  setInterval(): object { return {} }
  clearInterval(): void {}
}

class HttpExecutor implements UpdateExecutor {
  readonly configure = vi.fn()
  readonly useRelease = vi.fn((baseUrl: URL) => { this.baseUrl = baseUrl })
  readonly quitAndInstall = vi.fn()
  private readonly listeners = new Set<(event: ExecutorEvent) => void>()
  private baseUrl?: URL

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly downloadPath: string,
    private readonly version: string,
    private readonly archiveName: string
  ) {}

  on(listener: (event: ExecutorEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async check(): Promise<{ version: string }> {
    if (!this.baseUrl) throw new Error('Generic feed was not configured.')
    const response = await this.fetchImpl(new URL('latest-mac.yml', this.baseUrl))
    if (!response.ok || !(await response.text()).includes(`version: ${this.version}`)) {
      throw new Error('Updater metadata is invalid.')
    }
    return { version: this.version }
  }

  async download(): Promise<void> {
    if (!this.baseUrl) throw new Error('Generic feed was not configured.')
    const response = await this.fetchImpl(new URL(this.archiveName, this.baseUrl))
    if (!response.ok) throw new Error('Archive download failed.')
    await writeFile(this.downloadPath, Buffer.from(await response.arrayBuffer()))
    for (const listener of this.listeners) {
      listener({ type: 'progress', percent: 100 })
      listener({ type: 'downloaded', version: this.version, downloadedFile: this.downloadPath })
    }
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-generic-update-flow-'))
  temporaryDirectories.push(root)
  const version = '0.1.2'
  const archiveName = `insight-${version}-mac-arm64.zip`
  const archive = Buffer.from('verified updater archive')
  const dmg = Buffer.from('verified full installer')
  const blockmap = Buffer.from('verified blockmap')
  const metadata = Buffer.from(stringify({
    version,
    files: [{
      url: archiveName,
      sha512: createHash('sha512').update(archive).digest('base64'),
      size: archive.length
    }],
    path: archiveName,
    sha512: createHash('sha512').update(archive).digest('base64')
  }))
  const manifest: SignedReleaseManifest = {
    schema: 'insight-desktop-update/v1',
    version,
    channel: 'stable',
    publishedAt: '2026-09-08T03:00:00.000Z',
    shellCommit: 'a'.repeat(40),
    coreRuntime: { tag: 'insight-runtime-v0.1.1', commit: 'b'.repeat(40) },
    policy: { mode: 'optional', minimumSupportedVersion: '0.1.1' },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      minimumReadableDataSchema: 1,
      maximumReadableDataSchema: 1
    },
    artifacts: [
      artifact('dmg', `insight-${version}-mac-arm64.dmg`, dmg),
      artifact('zip', archiveName, archive),
      artifact('blockmap', `${archiveName}.blockmap`, blockmap),
      artifact('updater-metadata', 'latest-mac.yml', metadata)
    ]
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  const signatureBytes = sign(null, manifestBytes, privateKey)
  const files = new Map<string, Buffer>([
    ['/desktop/stable/current.json', Buffer.from(JSON.stringify({
      schemaVersion: 1,
      channel: 'stable',
      version
    }))],
    [`/desktop/releases/v${version}/insight-update.json`, manifestBytes],
    [`/desktop/releases/v${version}/insight-update.json.sig`, signatureBytes],
    [`/desktop/releases/v${version}/latest-mac.yml`, metadata],
    [`/desktop/releases/v${version}/${archiveName}`, archive]
  ])
  const server = createServer((request, response) => {
    const bytes = files.get(request.url ?? '')
    if (!bytes) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'Content-Length': String(bytes.length) })
    response.end(bytes)
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.')
  const loopbackOrigin = `http://127.0.0.1:${address.port}`
  const productionOrigin = 'https://updates.insight-aigc.com'
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const requestedUrl = new URL(input instanceof Request ? input.url : input.toString())
    const response = await fetch(new URL(`${requestedUrl.pathname}${requestedUrl.search}`, loopbackOrigin), init)
    const wrapped = new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: response.headers
    })
    Object.defineProperty(wrapped, 'url', { value: requestedUrl.href })
    return wrapped
  }
  return {
    root,
    version,
    archiveName,
    archive,
    publicKeyPem,
    productionOrigin,
    fetchImpl: fetchImpl as typeof fetch
  }
}

describe('Generic update production flow', () => {
  it('checks, downloads, verifies, and installs only the signed immutable release', async () => {
    const value = await fixture()
    const distribution = parseUpdateDistribution({
      schema: 1,
      updateOrigin: value.productionOrigin
    })
    const source = new GenericReleaseSource({
      distribution,
      publicKeyPem: value.publicKeyPem,
      fetch: value.fetchImpl
    })
    const downloadedFile = path.join(value.root, value.archiveName)
    const executor = new HttpExecutor(
      value.fetchImpl,
      downloadedFile,
      value.version,
      value.archiveName
    )
    const manager = new UpdateManager({
      currentVersion: '0.1.1',
      environment: {
        packaged: true,
        channel: 'stable',
        platform: 'darwin',
        arch: 'arm64'
      },
      source,
      executor,
      publicKeyPem: value.publicKeyPem,
      userData: value.root,
      prepareToInstall: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn().mockResolvedValue(undefined),
      timers: new PassiveTimers(),
      random: () => 0
    })

    await manager.start()
    await manager.check(true)
    expect(manager.status()).toMatchObject({
      phase: 'available',
      availableVersion: value.version
    })
    expect(executor.useRelease).toHaveBeenCalledWith(new URL(
      `${value.productionOrigin}/desktop/releases/v${value.version}/`
    ))

    await manager.download()
    expect(manager.status()).toMatchObject({ phase: 'downloaded' })
    await expect(readFile(downloadedFile)).resolves.toEqual(value.archive)
    expect(executor.quitAndInstall).not.toHaveBeenCalled()

    await manager.install()
    expect(executor.quitAndInstall).toHaveBeenCalledOnce()
    await manager.stop()
  })
})
