import type {
  ReleaseUpdateChannel,
  SignedReleaseManifest,
  UpdateTarget
} from '../../shared/update-contracts'

export interface ResolvedRelease {
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
