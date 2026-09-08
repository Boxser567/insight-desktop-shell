import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GitHubReleaseSource } from '../src/main/update/github-release-source'
import type {
  ReleaseArtifact,
  ReleaseUpdateChannel,
  SignedReleaseManifest,
  UpdateTarget
} from '../src/shared/update-contracts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const sha512 = Buffer.alloc(64, 3).toString('base64')
const stableTarget: UpdateTarget = {
  channel: 'stable',
  platform: 'darwin',
  arch: 'arm64'
}

interface GitHubAssetFixture {
  name: string
  browser_download_url: string
}

interface GitHubReleaseFixture {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: GitHubAssetFixture[]
}

interface ReleaseFixture {
  release: GitHubReleaseFixture
  downloads: Map<string, Uint8Array>
}

function artifact(
  platform: ReleaseArtifact['platform'],
  arch: ReleaseArtifact['arch'],
  kind: ReleaseArtifact['kind'],
  name: string
): ReleaseArtifact {
  return { platform, arch, kind, name, size: 128, sha512 }
}

function manifest(version: string, channel: ReleaseUpdateChannel): SignedReleaseManifest {
  return {
    schema: 'insight-desktop-update/v1',
    version,
    channel,
    publishedAt: '2026-09-04T03:00:00.000Z',
    shellCommit: 'a'.repeat(40),
    coreRuntime: {
      tag: 'insight-runtime-v0.1.1-rc.10',
      commit: 'b'.repeat(40)
    },
    policy: { mode: 'optional', minimumSupportedVersion: '0.1.1' },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      minimumReadableDataSchema: 1,
      maximumReadableDataSchema: 1
    },
    artifacts: [
      artifact('darwin', 'arm64', 'dmg', 'insight-mac-arm64.dmg'),
      artifact('darwin', 'arm64', 'zip', 'insight-mac-arm64.zip'),
      artifact('darwin', 'arm64', 'blockmap', 'insight-mac-arm64.zip.blockmap'),
      artifact('darwin', 'arm64', 'updater-metadata', 'latest-mac.yml')
    ]
  }
}

function releaseFixture(
  tag: string,
  options: {
    channel?: ReleaseUpdateChannel
    manifestVersion?: string
    draft?: boolean
    prerelease?: boolean
    mutateManifestBytes?: (bytes: Uint8Array) => Uint8Array
    additionalArtifacts?: ReleaseArtifact[]
  } = {}
): ReleaseFixture {
  const version = options.manifestVersion ?? tag.slice(1)
  const channel = options.channel ?? (version.includes('-rc.') ? 'candidate' : 'stable')
  const base = manifest(version, channel)
  const value = {
    ...base,
    artifacts: [...base.artifacts, ...(options.additionalArtifacts ?? [])]
  }
  const originalBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  const signatureBytes = sign(null, originalBytes, privateKey)
  const manifestBytes = options.mutateManifestBytes?.(originalBytes) ?? originalBytes
  const baseUrl = `https://github.com/Boxser567/insight-desktop-shell/releases/download/${tag}`
  const assets = [
    { name: 'insight-update.json', browser_download_url: `${baseUrl}/insight-update.json` },
    { name: 'insight-update.json.sig', browser_download_url: `${baseUrl}/insight-update.json.sig` },
    ...[...new Set(value.artifacts.map(({ name }) => name))]
      .map((name) => ({ name, browser_download_url: `${baseUrl}/${name}` }))
  ]
  const downloads = new Map<string, Uint8Array>([
    [`${baseUrl}/insight-update.json`, manifestBytes],
    [`${baseUrl}/insight-update.json.sig`, signatureBytes]
  ])

  return {
    release: {
      tag_name: tag,
      draft: options.draft ?? false,
      prerelease: options.prerelease ?? channel === 'candidate',
      assets
    },
    downloads
  }
}

function createSource(
  pages: GitHubReleaseFixture[][],
  fixtures: ReleaseFixture[],
  options: { forceNextAfterLastPage?: boolean; apiStatus?: number } = {}
) {
  const downloads = new Map(fixtures.flatMap((fixture) => [...fixture.downloads]))
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.hostname === 'api.github.com') {
      const status = options.apiStatus ?? 200
      const page = Number(url.searchParams.get('page'))
      const hasNext = page < pages.length || (options.forceNextAfterLastPage && page === pages.length)
      return new Response(JSON.stringify(pages[page - 1] ?? []), {
        status,
        headers: {
          'content-type': 'application/json',
          ...(hasNext ? { link: `<${url.origin}${url.pathname}?per_page=100&page=${page + 1}>; rel="next"` } : {}),
          ...(status === 403 ? { 'x-ratelimit-remaining': '0' } : {})
        }
      })
    }

    const body = downloads.get(url.href)
    if (!body) return new Response('missing', { status: 404 })
    const responseBody = new Uint8Array(body.byteLength)
    responseBody.set(body)
    return new Response(responseBody.buffer, { status: 200 })
  })

  return {
    fetchMock,
    source: new GitHubReleaseSource({ publicKeyPem, fetch: fetchMock })
  }
}

describe('GitHub release source', () => {
  it('filters drafts and channels, then selects the highest semantic version', async () => {
    const oldStable = releaseFixture('v0.1.9')
    const newestStable = releaseFixture('v0.1.10')
    const draft = releaseFixture('v0.2.0', { draft: true })
    const candidate = releaseFixture('v0.2.0-rc.1')
    const { source } = createSource(
      [[oldStable.release, candidate.release, draft.release, newestStable.release]],
      [oldStable, newestStable, draft, candidate]
    )

    const resolved = await source.resolve('stable', stableTarget)

    expect(resolved.manifest.version).toBe('0.1.10')
    expect([...resolved.artifactUrls]).toHaveLength(4)
  })

  it('reads later pages before selecting a release', async () => {
    const first = releaseFixture('v0.1.1')
    const second = releaseFixture('v0.1.2')
    const { source, fetchMock } = createSource(
      [[first.release], [second.release]],
      [first, second]
    )

    await expect(source.resolve('stable', stableTarget)).resolves.toMatchObject({
      manifest: { version: '0.1.2' }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/Boxser567/insight-desktop-shell/releases?per_page=100&page=2',
      expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } })
    )
  })

  it('resolves candidate releases without exposing stable releases', async () => {
    const stable = releaseFixture('v0.2.0')
    const candidate = releaseFixture('v0.2.0-rc.2')
    const target: UpdateTarget = {
      channel: 'candidate',
      platform: 'darwin',
      arch: 'arm64'
    }
    const { source } = createSource(
      [[stable.release, candidate.release]],
      [stable, candidate]
    )

    await expect(source.resolve('candidate', target)).resolves.toMatchObject({
      manifest: { version: '0.2.0-rc.2', channel: 'candidate' }
    })
  })

  it('maps shared macOS metadata once when the manifest covers both architectures', async () => {
    const release = releaseFixture('v0.1.2', {
      additionalArtifacts: [
        artifact('darwin', 'x64', 'dmg', 'insight-mac-x64.dmg'),
        artifact('darwin', 'x64', 'zip', 'insight-mac-x64.zip'),
        artifact('darwin', 'x64', 'blockmap', 'insight-mac-x64.zip.blockmap'),
        artifact('darwin', 'x64', 'updater-metadata', 'latest-mac.yml')
      ]
    })
    const { source } = createSource([[release.release]], [release])

    const resolved = await source.resolve('stable', stableTarget)

    expect([...resolved.artifactUrls.keys()].filter((name) => name === 'latest-mac.yml')).toEqual([
      'latest-mac.yml'
    ])
    expect(resolved.artifactUrls.size).toBe(7)
  })

  it('rejects an incomplete result after the fifth page', async () => {
    const fixture = releaseFixture('v0.1.1')
    const pages = Array.from({ length: 5 }, () => [fixture.release])
    const { source } = createSource(pages, [fixture], { forceNextAfterLastPage: true })

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('分页上限')
  })

  it('rejects invalid tags instead of treating them as releases', async () => {
    const fixture = releaseFixture('release-0.1.2', { manifestVersion: '0.1.2' })
    const { source } = createSource([[fixture.release]], [fixture])

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('没有找到')
  })

  it('requires the selected tag and signed manifest version to match', async () => {
    const fixture = releaseFixture('v0.1.2', { manifestVersion: '0.1.1' })
    const { source } = createSource([[fixture.release]], [fixture])

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('Tag')
  })

  it.each(['insight-update.json', 'insight-update.json.sig'])('requires %s', async (name) => {
    const fixture = releaseFixture('v0.1.2')
    fixture.release.assets = fixture.release.assets.filter((asset) => asset.name !== name)
    const { source } = createSource([[fixture.release]], [fixture])

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow(name)
  })

  it('rejects duplicate GitHub asset names', async () => {
    const fixture = releaseFixture('v0.1.2')
    fixture.release.assets.push(fixture.release.assets[0]!)
    const { source } = createSource([[fixture.release]], [fixture])

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('重复')
  })

  it('rejects a tampered signed manifest', async () => {
    const older = releaseFixture('v0.1.1')
    const fixture = releaseFixture('v0.1.2', {
      mutateManifestBytes: (bytes) => Buffer.concat([bytes, Buffer.from(' ')])
    })
    const { source } = createSource(
      [[older.release, fixture.release]],
      [older, fixture]
    )

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('签名无效')
  })

  it('requires every artifact declared by the manifest to exist in the release', async () => {
    const fixture = releaseFixture('v0.1.2')
    fixture.release.assets = fixture.release.assets.filter(
      ({ name }) => name !== 'insight-mac-arm64.dmg'
    )
    const { source } = createSource([[fixture.release]], [fixture])

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow(
      'insight-mac-arm64.dmg'
    )
  })

  it('rejects non-HTTPS asset URLs before downloading', async () => {
    const fixture = releaseFixture('v0.1.2')
    fixture.release.assets[0]!.browser_download_url = 'http://github.com/manifest'
    const { source } = createSource([[fixture.release]], [fixture])

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('HTTPS')
  })

  it('rejects initial asset URLs outside trusted GitHub hosts', async () => {
    const fixture = releaseFixture('v0.1.2')
    fixture.release.assets[0]!.browser_download_url = 'https://example.com/manifest'
    const { source } = createSource([[fixture.release]], [fixture])

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('Host')
  })

  it('rejects failed asset redirects or downloads', async () => {
    const fixture = releaseFixture('v0.1.2')
    fixture.downloads.delete(fixture.release.assets[0]!.browser_download_url)
    const { source } = createSource([[fixture.release]], [fixture])

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('下载失败')
  })

  it('reports GitHub API rate limiting', async () => {
    const { source } = createSource([], [], { apiStatus: 403 })

    await expect(source.resolve('stable', stableTarget)).rejects.toThrow('限流')
  })

  it('rejects a channel argument that disagrees with the target', async () => {
    const fixture = releaseFixture('v0.1.2')
    const { source } = createSource([[fixture.release]], [fixture])

    await expect(source.resolve('candidate', stableTarget)).rejects.toThrow('渠道')
  })
})
