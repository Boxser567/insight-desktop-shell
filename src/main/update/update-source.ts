import type {
  ReleaseUpdateChannel,
  SignedReleaseManifest,
  UpdateTarget
} from '../../shared/update-contracts'

export interface ResolvedRelease {
  manifest: SignedReleaseManifest
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
  artifactUrls: ReadonlyMap<string, URL>
}

export interface UpdateSource {
  resolve(
    channel: ReleaseUpdateChannel,
    target: UpdateTarget
  ): Promise<ResolvedRelease>
}
