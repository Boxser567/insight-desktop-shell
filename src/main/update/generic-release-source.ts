import { z } from 'zod'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import semver from 'semver'
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

export const UPDATE_SOURCE_REQUEST_TIMEOUT_MS = 30_000
const MAX_UPDATE_METADATA_BYTES = 4 * 1024 * 1024

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
    const pointerBytes = await this.#download(pointerUrl, '渠道指针', {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    })
    const pointer = pointerSchema.parse(JSON.parse(Buffer.from(pointerBytes).toString('utf8')))
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

    const metadataArtifact = manifest.artifacts.find(artifact =>
      artifact.platform === target.platform && artifact.arch === target.arch && artifact.kind === 'updater-metadata'
    )!
    const metadataBytes = await this.#download(new URL(metadataArtifact.name, releaseBaseUrl), '平台更新元数据')
    if (metadataBytes.byteLength !== metadataArtifact.size ||
      createHash('sha512').update(metadataBytes).digest('base64') !== metadataArtifact.sha512) {
      throw new Error('平台更新元数据与可信发布记录不一致。')
    }
    const metadata = parse(Buffer.from(metadataBytes).toString('utf8')) as {
      version?: unknown; minimumSystemVersion?: unknown
    } | null
    if (metadata?.version !== manifest.version) throw new Error('平台更新元数据版本不一致。')
    const minimumSystemVersion = metadata.minimumSystemVersion
    if (minimumSystemVersion !== undefined &&
      (typeof minimumSystemVersion !== 'string' || semver.valid(minimumSystemVersion) !== minimumSystemVersion)) {
      throw new Error('平台更新元数据的最低系统版本无效。')
    }

    return {
      ...(typeof minimumSystemVersion === 'string' ? { minimumSystemVersion } : {}),
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

  async #download(url: URL, label: string, init?: RequestInit): Promise<Uint8Array> {
    const controller = new AbortController()
    let rejectDeadline!: (error: Error) => void
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject
    })
    const timeout = setTimeout(() => {
      const error = new Error(`${label}请求超时，请稍后重试。`)
      controller.abort(error)
      rejectDeadline(error)
    }, UPDATE_SOURCE_REQUEST_TIMEOUT_MS)
    try {
      const response = await Promise.race([
        this.#fetch(url, { ...init, redirect: 'follow', signal: controller.signal }),
        deadline
      ])
      assertTrustedResponse(response, url, label)
      return await Promise.race([
        readBoundedResponse(response, label, controller.signal),
        deadline
      ])
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function readBoundedResponse(
  response: Response,
  label: string,
  signal: AbortSignal
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_UPDATE_METADATA_BYTES)
  ) throw new Error(`${label}响应超过允许大小。`)
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await readChunk(reader, signal)
    if (done) break
    total += value.byteLength
    if (total > MAX_UPDATE_METADATA_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`${label}响应超过允许大小。`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

function assertTrustedResponse(response: Response, expected: URL, label: string): void {
  if (response.url !== expected.href) {
    throw new Error(`${label} 响应地址不受信任。`)
  }
  if (!response.ok) {
    throw new Error(`${label}请求失败：HTTP ${response.status}。`)
  }
}
