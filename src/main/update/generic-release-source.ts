import { z } from 'zod'
import { selectManualInstaller, verifyReleaseManifest } from './release-manifest'
import type { UpdateDistribution } from './update-environment'
import type {
  ReleaseUpdateChannel,
  SignedReleaseManifest,
  UpdateTarget
} from '../../shared/update-contracts'
import type { ResolvedRelease, UpdateSource } from './update-source'

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

const pointerSchema = z.object({
  schemaVersion: z.literal(1),
  channel: z.enum(['candidate', 'stable']),
  version: z.string().min(1)
}).strict()

export interface GenericReleaseSourceOptions {
  distribution: UpdateDistribution
  publicKeyPem: string
  fetch?: FetchImplementation
}

export class GenericReleaseSource implements UpdateSource {
  readonly #distribution: UpdateDistribution
  readonly #publicKeyPem: string
  readonly #fetch: FetchImplementation

  constructor(options: GenericReleaseSourceOptions) {
    this.#distribution = options.distribution
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

    const pointerUrl = this.#distribution.currentPointerUrl(channel)
    const pointerResponse = await this.#fetch(pointerUrl, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      redirect: 'follow'
    })
    assertTrustedResponse(pointerResponse, pointerUrl, '渠道指针')
    const pointer = pointerSchema.parse(await pointerResponse.json())
    if (pointer.channel !== channel) {
      throw new Error('更新指针渠道与当前客户端不一致。')
    }

    const releaseBaseUrl = this.releaseBaseUrl(channel, pointer.version)
    const manifestUrl = new URL('insight-update.json', releaseBaseUrl)
    const signatureUrl = new URL('insight-update.json.sig', releaseBaseUrl)
    const [manifestBytes, signatureBytes] = await Promise.all([
      this.#download(manifestUrl, '更新 Manifest'),
      this.#download(signatureUrl, '更新 Manifest 签名')
    ])
    const manifest = verifyReleaseManifest({
      manifestBytes,
      signatureBytes,
      publicKeyPem: this.#publicKeyPem,
      target
    })
    if (manifest.version !== pointer.version) {
      throw new Error('更新指针与 Manifest 版本不一致。')
    }

    return {
      manifest,
      manifestBytes,
      signatureBytes,
      releaseBaseUrl,
      manualInstallerUrl: this.manualInstallerUrl(manifest, target)
    }
  }

  releaseBaseUrl(channel: ReleaseUpdateChannel, version: string): URL {
    return this.#distribution.releaseBaseUrl(channel, version)
  }

  manualInstallerUrl(manifest: SignedReleaseManifest, target: UpdateTarget): URL {
    if (manifest.channel !== target.channel) {
      throw new Error('更新 Manifest 与整包目标渠道不一致。')
    }
    const installer = selectManualInstaller(manifest, target)
    return this.#distribution.artifactUrl(
      manifest.channel,
      manifest.version,
      installer.name
    )
  }

  async #download(url: URL, label: string): Promise<Uint8Array> {
    const response = await this.#fetch(url, { redirect: 'follow' })
    assertTrustedResponse(response, url, label)
    return new Uint8Array(await response.arrayBuffer())
  }
}

function assertTrustedResponse(response: Response, expected: URL, label: string): void {
  if (response.url !== expected.href) {
    throw new Error(`${label} 响应地址不受信任。`)
  }
  if (!response.ok) {
    throw new Error(`${label}请求失败：HTTP ${response.status}。`)
  }
}
