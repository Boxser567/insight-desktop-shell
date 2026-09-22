import type {
  ReleaseUpdateChannel,
  RolloutPayload,
  SignedReleaseIndex,
  SignedReleaseManifest,
  SignedTargetManifest,
  UpdateTarget
} from '../../shared/update-contracts'

export interface ResolvedRelease {
  /** Kernel release requirement read from hash-verified updater metadata. */
  minimumSystemVersion?: string
  manifest: SignedReleaseManifest
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
  releaseBaseUrl: URL
  manualInstallerUrl: URL
}

export interface UpdateSource {
  resolve(
    channel: ReleaseUpdateChannel,
    target: UpdateTarget
  ): Promise<ResolvedRelease>
  releaseBaseUrl(channel: ReleaseUpdateChannel, version: string): URL
  manualInstallerUrl(manifest: SignedReleaseManifest, target: UpdateTarget): URL
}

export interface ResolvedV2Release {
  /** Kernel release requirement read from hash-verified updater metadata. */
  minimumSystemVersion?: string
  rollout: RolloutPayload
  rolloutEnvelopeBytes: Uint8Array
  releaseIndex?: SignedReleaseIndex
  releaseIndexBytes?: Uint8Array
  releaseIndexSignatureBytes?: Uint8Array
  manifest: SignedTargetManifest
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
  releaseBaseUrl: URL
  manualInstallerUrl: URL
}

export type AnyResolvedRelease = ResolvedRelease | ResolvedV2Release

export interface V2UpdateSource {
  resolve(
    track: ReleaseUpdateChannel,
    target: Pick<UpdateTarget, 'platform' | 'arch'>
  ): Promise<ResolvedV2Release>
  v2ReleaseBaseUrl(version: string, target: Pick<UpdateTarget, 'platform' | 'arch'>): URL
  v2ManualInstallerUrl(
    manifest: SignedTargetManifest,
    target: Pick<UpdateTarget, 'platform' | 'arch'>
  ): URL
}

export type AnyUpdateSource = UpdateSource | V2UpdateSource
