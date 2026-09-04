import semver from 'semver'
import { verifyReleaseManifest } from './release-manifest'
import type {
  ReleaseUpdateChannel,
  UpdateTarget
} from '../../shared/update-contracts'
import type { ResolvedRelease, UpdateSource } from './update-source'

const releasesEndpoint =
  'https://api.github.com/repos/Boxser567/insight-desktop-shell/releases'
const maximumPages = 5
const allowedAssetHosts = new Set(['github.com', 'api.github.com'])

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

interface GitHubAsset {
  name: string
  browserDownloadUrl: string
}

interface GitHubRelease {
  tagName: string
  draft: boolean
  prerelease: boolean
  assets: GitHubAsset[]
}

export interface GitHubReleaseSourceOptions {
  publicKeyPem: string
  fetch?: FetchImplementation
}

export class GitHubReleaseSource implements UpdateSource {
  readonly #publicKeyPem: string
  readonly #fetch: FetchImplementation

  constructor(options: GitHubReleaseSourceOptions) {
    this.#publicKeyPem = options.publicKeyPem
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async resolve(
    channel: ReleaseUpdateChannel,
    target: UpdateTarget
  ): Promise<ResolvedRelease> {
    if (target.channel !== channel) {
      throw new Error('更新源渠道与目标渠道不一致。')
    }

    const releases = await this.#listReleases()
    const selected = selectRelease(releases, channel)
    const assets = indexAssets(selected)
    const manifestAsset = requireAsset(assets, 'insight-update.json')
    const signatureAsset = requireAsset(assets, 'insight-update.json.sig')
    const [manifestBytes, signatureBytes] = await Promise.all([
      this.#download(manifestAsset),
      this.#download(signatureAsset)
    ])
    const manifest = verifyReleaseManifest({
      manifestBytes,
      signatureBytes,
      publicKeyPem: this.#publicKeyPem,
      target
    })
    const tagVersion = versionFromTag(selected.tagName, channel)

    if (tagVersion !== manifest.version) {
      throw new Error('GitHub Release Tag 与更新 Manifest 版本不一致。')
    }

    const artifactUrls = new Map<string, URL>()
    for (const artifact of manifest.artifacts) {
      if (artifactUrls.has(artifact.name)) {
        throw new Error(`更新 Manifest 包含重复资产名：${artifact.name}。`)
      }
      const releaseAsset = requireAsset(assets, artifact.name)
      artifactUrls.set(artifact.name, trustedAssetUrl(releaseAsset.browserDownloadUrl))
    }

    return { manifest, artifactUrls }
  }

  async #listReleases(): Promise<GitHubRelease[]> {
    const releases: GitHubRelease[] = []

    for (let page = 1; page <= maximumPages; page += 1) {
      const url = `${releasesEndpoint}?per_page=100&page=${page}`
      const response = await this.#fetch(url, {
        headers: { Accept: 'application/vnd.github+json' }
      })

      if (!response.ok) {
        if (
          response.status === 429 ||
          (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
        ) {
          throw new Error('GitHub Releases API 已触发限流，请稍后重试。')
        }
        throw new Error(`GitHub Releases API 请求失败：HTTP ${response.status}。`)
      }

      releases.push(...parseReleaseList(await response.json()))
      if (!hasNextPage(response.headers.get('link'))) return releases
      if (page === maximumPages) {
        throw new Error('GitHub Releases 超出分页上限，无法安全选择最新版本。')
      }
    }

    return releases
  }

  async #download(asset: GitHubAsset): Promise<Uint8Array> {
    const url = trustedAssetUrl(asset.browserDownloadUrl)
    const response = await this.#fetch(url, { redirect: 'follow' })
    if (!response.ok) {
      throw new Error(`GitHub Release 资产下载失败：${asset.name}。`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }
}

function selectRelease(
  releases: GitHubRelease[],
  channel: ReleaseUpdateChannel
): GitHubRelease {
  const candidates = releases.flatMap((release) => {
    if (release.draft) return []
    if (channel === 'stable' ? release.prerelease : !release.prerelease) return []
    const version = versionFromTag(release.tagName, channel)
    return version ? [{ release, version }] : []
  })
  candidates.sort((left, right) => semver.rcompare(left.version, right.version))

  const selected = candidates[0]?.release
  if (!selected) throw new Error(`没有找到可信的 ${channel} GitHub Release。`)
  return selected
}

function versionFromTag(
  tag: string,
  channel: ReleaseUpdateChannel
): string | undefined {
  const match = channel === 'stable'
    ? /^v(\d+\.\d+\.\d+)$/.exec(tag)
    : /^v(\d+\.\d+\.\d+-rc\.\d+)$/.exec(tag)
  const version = match?.[1]
  return version && semver.valid(version) === version ? version : undefined
}

function indexAssets(release: GitHubRelease): ReadonlyMap<string, GitHubAsset> {
  const assets = new Map<string, GitHubAsset>()
  for (const asset of release.assets) {
    if (assets.has(asset.name)) {
      throw new Error(`GitHub Release 包含重复资产名：${asset.name}。`)
    }
    assets.set(asset.name, asset)
  }
  return assets
}

function requireAsset(
  assets: ReadonlyMap<string, GitHubAsset>,
  name: string
): GitHubAsset {
  const asset = assets.get(name)
  if (!asset) throw new Error(`GitHub Release 缺少资产：${name}。`)
  return asset
}

function trustedAssetUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('GitHub Release 资产 URL 无效。')
  }
  if (url.protocol !== 'https:') {
    throw new Error('GitHub Release 资产 URL 必须使用 HTTPS。')
  }
  if (!allowedAssetHosts.has(url.hostname)) {
    throw new Error(`GitHub Release 资产 Host 不受信任：${url.hostname}。`)
  }
  return url
}

function hasNextPage(link: string | null): boolean {
  return link?.split(',').some((part) => /;\s*rel="?next"?\s*$/.test(part)) ?? false
}

function parseReleaseList(value: unknown): GitHubRelease[] {
  if (!Array.isArray(value)) throw new Error('GitHub Releases API 返回格式无效。')
  return value.map(parseRelease)
}

function parseRelease(value: unknown): GitHubRelease {
  if (!isRecord(value)) throw new Error('GitHub Release 条目格式无效。')
  if (
    typeof value.tag_name !== 'string' ||
    typeof value.draft !== 'boolean' ||
    typeof value.prerelease !== 'boolean' ||
    !Array.isArray(value.assets)
  ) {
    throw new Error('GitHub Release 条目格式无效。')
  }
  return {
    tagName: value.tag_name,
    draft: value.draft,
    prerelease: value.prerelease,
    assets: value.assets.map(parseAsset)
  }
}

function parseAsset(value: unknown): GitHubAsset {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.browser_download_url !== 'string'
  ) {
    throw new Error('GitHub Release 资产格式无效。')
  }
  return {
    name: value.name,
    browserDownloadUrl: value.browser_download_url
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
