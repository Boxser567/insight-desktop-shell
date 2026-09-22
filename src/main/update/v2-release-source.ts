import { createHash } from 'node:crypto'
import semver from 'semver'
import { parse } from 'yaml'
import type {
  SignedReleaseIndex,
  SignedTargetManifest,
  UpdateTarget,
  UpdateTargetId,
  UpdateTrack
} from '../../shared/update-contracts'
import type { UpdateDistribution } from './update-environment'
import type { ResolvedV2Release } from './update-source'
import { UPDATE_SOURCE_REQUEST_TIMEOUT_MS } from './generic-release-source'
import {
  updateTargetId,
  verifyReleaseIndex,
  verifyRolloutEnvelope,
  verifyTargetManifest
} from './v2-release-contract'

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

const RELEASE_INDEX_NAME = 'insight-release.json'
const RELEASE_INDEX_SIGNATURE_NAME = 'insight-release.json.sig'
const TARGET_MANIFEST_NAME = 'insight-target.json'
const TARGET_MANIFEST_SIGNATURE_NAME = 'insight-target.json.sig'

export interface V2ReleaseSourceOptions {
  distribution: UpdateDistribution
  publicKeyPem: string
  fetch?: FetchImplementation
}

export class V2ReleaseSource {
  readonly #distribution: UpdateDistribution
  readonly #publicKeyPem: string
  readonly #fetch: FetchImplementation

  constructor(options: V2ReleaseSourceOptions) {
    this.#distribution = options.distribution
    this.#publicKeyPem = options.publicKeyPem
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async resolve(
    track: UpdateTrack,
    target: Pick<UpdateTarget, 'platform' | 'arch'>
  ): Promise<ResolvedV2Release> {
    const targetId = updateTargetId(target.platform, target.arch)
    const pointerUrl = this.#distribution.v2PointerUrl(
      track,
      track === 'candidate' ? targetId : undefined
    )
    const rolloutEnvelopeBytes = await this.#download(pointerUrl, '更新投放信封', {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    })
    const { payload: rollout } = verifyRolloutEnvelope(
      rolloutEnvelopeBytes,
      this.#publicKeyPem
    )
    if (rollout.track !== track) throw new Error('更新投放 Track 与请求不一致。')
    if (track === 'candidate' && rollout.target !== targetId) {
      throw new Error('Candidate 更新投放目标与当前平台不一致。')
    }

    let releaseIndex: SignedReleaseIndex | undefined
    let releaseIndexBytes: Uint8Array | undefined
    let releaseIndexSignatureBytes: Uint8Array | undefined
    let expectedManifestSha512 = rollout.referencedSha512

    if (track === 'stable') {
      const releaseBaseUrl = this.#distribution.v2ReleaseBaseUrl(rollout.version)
      ;[releaseIndexBytes, releaseIndexSignatureBytes] = await Promise.all([
        this.#download(new URL(RELEASE_INDEX_NAME, releaseBaseUrl), 'Release Index'),
        this.#download(new URL(RELEASE_INDEX_SIGNATURE_NAME, releaseBaseUrl), 'Release Index 签名')
      ])
      releaseIndex = verifyReleaseIndex({
        indexBytes: releaseIndexBytes,
        signatureBytes: releaseIndexSignatureBytes,
        publicKeyPem: this.#publicKeyPem,
        expectedSha512: rollout.referencedSha512,
        expectedVersion: rollout.version
      })
      const reference = releaseIndex.targets.find(({ id }) => id === targetId)
      if (!reference) throw new Error('Release Index 缺少当前目标。')
      expectedManifestSha512 = reference.manifestSha512
    }

    const releaseBaseUrl = this.#distribution.v2TargetBaseUrl(rollout.version, targetId)
    const [manifestBytes, signatureBytes] = await Promise.all([
      this.#download(new URL(TARGET_MANIFEST_NAME, releaseBaseUrl), '目标 Manifest'),
      this.#download(new URL(TARGET_MANIFEST_SIGNATURE_NAME, releaseBaseUrl), '目标 Manifest 签名')
    ])
    const manifest = verifyTargetManifest({
      manifestBytes,
      signatureBytes,
      publicKeyPem: this.#publicKeyPem,
      expectedSha512: expectedManifestSha512,
      expectedTarget: targetId,
      expectedVersion: rollout.version
    })
    if (releaseIndex) assertIndexIdentity(releaseIndex, manifest)

    const metadataArtifact = manifest.artifacts.find(({ kind }) => kind === 'updater-metadata')!
    const metadataBytes = await this.#download(
      new URL(metadataArtifact.name, releaseBaseUrl),
      '平台更新元数据'
    )
    if (
      metadataBytes.byteLength !== metadataArtifact.size ||
      createHash('sha512').update(metadataBytes).digest('base64') !== metadataArtifact.sha512
    ) {
      throw new Error('平台更新元数据与可信发布记录不一致。')
    }
    const metadata = parse(Buffer.from(metadataBytes).toString('utf8')) as {
      version?: unknown
      minimumSystemVersion?: unknown
    } | null
    if (metadata?.version !== manifest.version) throw new Error('平台更新元数据版本不一致。')
    const minimumSystemVersion = metadata.minimumSystemVersion
    if (
      minimumSystemVersion !== undefined &&
      (
        typeof minimumSystemVersion !== 'string' ||
        semver.valid(minimumSystemVersion) !== minimumSystemVersion
      )
    ) {
      throw new Error('平台更新元数据的最低系统版本无效。')
    }

    return {
      ...(typeof minimumSystemVersion === 'string' ? { minimumSystemVersion } : {}),
      rollout,
      rolloutEnvelopeBytes,
      ...(releaseIndex ? { releaseIndex } : {}),
      ...(releaseIndexBytes ? { releaseIndexBytes } : {}),
      ...(releaseIndexSignatureBytes ? { releaseIndexSignatureBytes } : {}),
      manifest,
      manifestBytes,
      signatureBytes,
      releaseBaseUrl,
      manualInstallerUrl: this.manualInstallerUrl(manifest, targetId)
    }
  }

  manualInstallerUrl(manifest: SignedTargetManifest, target: UpdateTargetId): URL {
    if (updateTargetId(manifest.target.platform, manifest.target.arch) !== target) {
      throw new Error('目标 Manifest 与整包目标不一致。')
    }
    const kind = manifest.target.platform === 'darwin' ? 'dmg' : 'nsis'
    const installer = manifest.artifacts.find((artifact) => artifact.kind === kind)
    if (!installer) throw new Error('目标 Manifest 缺少整包安装器。')
    return this.#distribution.v2TargetArtifactUrl(
      manifest.version,
      target,
      installer.name
    )
  }

  async #download(url: URL, label: string, init?: RequestInit): Promise<Uint8Array> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new Error(`${label}请求超时，请稍后重试。`)),
      UPDATE_SOURCE_REQUEST_TIMEOUT_MS
    )
    try {
      const response = await this.#fetch(url, {
        ...init,
        redirect: 'manual',
        signal: controller.signal
      })
      if (response.url !== url.href) throw new Error(`${label} 响应地址不受信任。`)
      if (!response.ok) throw new Error(`${label}请求失败：HTTP ${response.status}。`)
      return new Uint8Array(await response.arrayBuffer())
    } finally {
      clearTimeout(timeout)
    }
  }
}

function assertIndexIdentity(
  index: SignedReleaseIndex,
  manifest: SignedTargetManifest
): void {
  if (
    manifest.version !== index.version ||
    manifest.shellCommit !== index.shellCommit ||
    manifest.coreRuntime.tag !== index.coreRuntime.tag ||
    manifest.coreRuntime.commit !== index.coreRuntime.commit
  ) {
    throw new Error('Release Index 与目标 Manifest 的发布身份不一致。')
  }
}
