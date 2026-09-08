import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GenericReleaseSource } from '../src/main/update/generic-release-source'
import { parseUpdateDistribution } from '../src/main/update/update-environment'
import type {
  ReleaseArtifact,
  SignedReleaseManifest,
  UpdateTarget
} from '../src/shared/update-contracts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const sha512 = Buffer.alloc(64, 3).toString('base64')
const distribution = parseUpdateDistribution({
  schema: 1,
  updateOrigin: 'https://updates.example.test'
})
const stableTarget: UpdateTarget = {
  channel: 'stable',
  platform: 'darwin',
  arch: 'arm64'
}

function artifact(
  platform: ReleaseArtifact['platform'],
  arch: ReleaseArtifact['arch'],
  kind: ReleaseArtifact['kind'],
  name: string
): ReleaseArtifact {
  return { platform, arch, kind, name, size: 128, sha512 }
}

function manifest(version = '0.1.2'): SignedReleaseManifest {
  return {
    schema: 'insight-desktop-update/v1',
    version,
    channel: version.includes('-rc.') ? 'candidate' : 'stable',
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
      artifact('darwin', 'arm64', 'dmg', `insight-${version}-mac-arm64.dmg`),
      artifact('darwin', 'arm64', 'zip', `insight-${version}-mac-arm64.zip`),
      artifact('darwin', 'arm64', 'blockmap', `insight-${version}-mac-arm64.zip.blockmap`),
      artifact('darwin', 'arm64', 'updater-metadata', 'latest-mac.yml'),
      artifact('win32', 'x64', 'nsis', `insight-${version}-windows-x64-setup.exe`),
      artifact('win32', 'x64', 'blockmap', `insight-${version}-windows-x64-setup.exe.blockmap`),
      artifact('win32', 'x64', 'updater-metadata', 'latest.yml')
    ]
  }
}

function response(url: string, body: BodyInit, status = 200, finalUrl = url): Response {
  const value = new Response(body, { status })
  Object.defineProperty(value, 'url', { value: finalUrl })
  return value
}

function fixture(options: {
  version?: string
  pointer?: unknown
  manifest?: SignedReleaseManifest
  corruptSignature?: boolean
  pointerStatus?: number
  redirectManifestTo?: string
} = {}) {
  const release = options.manifest ?? manifest(options.version)
  const manifestBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`)
  const signatureBytes = options.corruptSignature
    ? Buffer.alloc(64)
    : sign(null, manifestBytes, privateKey)
  const pointer = options.pointer ?? {
    schemaVersion: 1,
    channel: release.channel,
    version: options.version ?? release.version
  }
  const pointerUrl = distribution.currentPointerUrl(release.channel).href
  const releaseBaseUrl = distribution.releaseBaseUrl(release.channel, options.version ?? release.version)
  const manifestUrl = new URL('insight-update.json', releaseBaseUrl).href
  const signatureUrl = new URL('insight-update.json.sig', releaseBaseUrl).href
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url === pointerUrl) {
      return response(url, JSON.stringify(pointer), options.pointerStatus ?? 200)
    }
    if (url === manifestUrl) {
      return response(url, manifestBytes, 200, options.redirectManifestTo ?? url)
    }
    if (url === signatureUrl) return response(url, signatureBytes)
    return response(url, 'missing', 404)
  })
  return {
    fetchMock,
    source: new GenericReleaseSource({ distribution, publicKeyPem, fetch: fetchMock })
  }
}

describe('Generic release source', () => {
  it('resolves a signed release and derives its manual installer from one origin', async () => {
    const { source, fetchMock } = fixture()

    const release = await source.resolve('stable', stableTarget)

    expect(release.manifest.version).toBe('0.1.2')
    expect(release.releaseBaseUrl.href).toBe(
      'https://updates.example.test/desktop/releases/v0.1.2/'
    )
    expect(release.manualInstallerUrl.href).toBe(
      'https://updates.example.test/desktop/releases/v0.1.2/insight-0.1.2-mac-arm64.dmg'
    )
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://updates.example.test/desktop/stable/current.json'),
      {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        redirect: 'follow'
      }
    )
  })

  it('selects the Windows NSIS installer for manual recovery', () => {
    const { source } = fixture()
    expect(source.manualInstallerUrl(manifest(), {
      channel: 'stable',
      platform: 'win32',
      arch: 'x64'
    }).href).toContain('insight-0.1.2-windows-x64-setup.exe')
  })

  it.each([
    { schemaVersion: 1, channel: 'stable', version: '0.1.2', url: 'https://attacker.test' },
    { schemaVersion: 1, channel: 'candidate', version: '0.1.2' },
    { schemaVersion: 1, channel: 'stable', version: '0.1.2-rc.1' },
    { schemaVersion: 2, channel: 'stable', version: '0.1.2' }
  ])('rejects an invalid pointer %#', async (pointer) => {
    const { source } = fixture({ pointer })
    await expect(source.resolve('stable', stableTarget)).rejects.toThrow()
  })

  it('rejects a signed manifest whose version differs from the pointer', async () => {
    const { source } = fixture({
      pointer: { schemaVersion: 1, channel: 'stable', version: '0.1.2' },
      manifest: manifest('0.1.1'),
      version: '0.1.2'
    })
    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('版本不一致')
  })

  it('rejects an invalid product signature', async () => {
    const { source } = fixture({ corruptSignature: true })
    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('签名无效')
  })

  it('rejects redirects outside the exact immutable path', async () => {
    const { source } = fixture({ redirectManifestTo: 'https://attacker.test/insight-update.json' })
    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('不受信任')
  })

  it.each([403, 404, 500])('reports pointer HTTP %s without consulting release files', async (status) => {
    const { source, fetchMock } = fixture({ pointerStatus: status })
    await expect(source.resolve('stable', stableTarget)).rejects.toThrow(`HTTP ${status}`)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
