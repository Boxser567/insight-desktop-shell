export type UpdateChannel = 'development' | 'candidate' | 'stable'

export type ReleaseUpdateChannel = Exclude<UpdateChannel, 'development'>

export type UpdateTrack = ReleaseUpdateChannel

export type UpdateTargetId = 'darwin-arm64' | 'darwin-x64' | 'win32-x64'

export type UpdatePlatform = 'darwin' | 'win32'

export type UpdateArch = 'arm64' | 'x64'

export type ReleaseArtifactKind =
  | 'dmg'
  | 'zip'
  | 'nsis'
  | 'blockmap'
  | 'updater-metadata'

export interface UpdateTarget {
  channel: ReleaseUpdateChannel
  platform: UpdatePlatform
  arch: UpdateArch
}

export interface ReleaseArtifact {
  platform: UpdatePlatform
  arch: UpdateArch
  kind: ReleaseArtifactKind
  name: string
  size: number
  sha512: string
}

export interface SignedReleaseManifest {
  schema: 'insight-desktop-update/v1'
  version: string
  channel: ReleaseUpdateChannel
  publishedAt: string
  shellCommit: string
  coreRuntime: {
    tag: string
    commit: string
  }
  policy: {
    mode: 'optional' | 'required'
    minimumSupportedVersion: string
  }
  compatibility: {
    profileSchema: number
    accountStorageSchema: number
    minimumReadableDataSchema: number
    maximumReadableDataSchema: number
  }
  artifacts: ReleaseArtifact[]
}

export interface UpdateDataCompatibility {
  profileSchema: number
  accountStorageSchema: number
  readsDataSchema: {
    minimum: number
    maximum: number
  }
  writesDataSchema: number
}

export interface SignedTargetManifest {
  schema: 'insight-desktop-target/v2'
  version: string
  target: {
    platform: UpdatePlatform
    arch: UpdateArch
  }
  shellCommit: string
  coreRuntime: {
    tag: string
    commit: string
  }
  compatibility: UpdateDataCompatibility
  artifacts: ReleaseArtifact[]
}

export interface SignedReleaseIndex {
  schema: 'insight-desktop-release/v2'
  version: string
  shellCommit: string
  coreRuntime: {
    tag: string
    commit: string
  }
  targets: Array<{
    id: UpdateTargetId
    manifestSha512: string
  }>
}

export interface RolloutPayload {
  schema: 'insight-desktop-rollout/v2'
  track: UpdateTrack
  version: string
  target?: UpdateTargetId
  referencedSha512: string
  policy: {
    mode: 'optional' | 'required'
    minimumSupportedVersion: string
  }
  publishedAt: string
}

export interface SignedRolloutEnvelope {
  schema: 'insight-desktop-rollout-envelope/v2'
  payloadBase64: string
  signatureBase64: string
}

export type UpdateStatus =
  | { phase: 'idle'; currentVersion: string; lastCheckedAt?: string }
  | { phase: 'checking'; currentVersion: string; track: UpdateTrack; manual: boolean }
  | { phase: 'available'; currentVersion: string; availableVersion: string; track: UpdateTrack; required: boolean; manual: boolean }
  | { phase: 'downloading'; currentVersion: string; availableVersion: string; track: UpdateTrack; required: boolean; percent: number; manual: boolean }
  | { phase: 'downloaded'; currentVersion: string; availableVersion: string; track: UpdateTrack; required: boolean; manual: boolean }
  | { phase: 'installing'; currentVersion: string; availableVersion: string; track: UpdateTrack; required: boolean; manual: boolean }
  | { phase: 'up-to-date'; currentVersion: string; track: UpdateTrack; manual: true }
  | { phase: 'unsupported'; currentVersion: string; track: UpdateTrack; reason: string; manual: boolean }
  | { phase: 'error'; currentVersion: string; availableVersion?: string; track: UpdateTrack; required: boolean; message: string; manual: boolean; retryable: boolean; manualInstallerAvailable: boolean }
