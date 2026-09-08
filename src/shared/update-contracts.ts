export type UpdateChannel = 'development' | 'candidate' | 'stable'

export type ReleaseUpdateChannel = Exclude<UpdateChannel, 'development'>

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

export type UpdateStatus =
  | { phase: 'idle'; currentVersion: string; lastCheckedAt?: string }
  | { phase: 'checking'; currentVersion: string; manual: boolean }
  | { phase: 'available'; currentVersion: string; availableVersion: string; required: boolean; manual: boolean }
  | { phase: 'downloading'; currentVersion: string; availableVersion: string; required: boolean; percent: number; manual: boolean }
  | { phase: 'downloaded'; currentVersion: string; availableVersion: string; required: boolean; manual: boolean }
  | { phase: 'installing'; currentVersion: string; availableVersion: string; required: boolean; manual: boolean }
  | { phase: 'up-to-date'; currentVersion: string; manual: true }
  | { phase: 'unsupported'; currentVersion: string; reason: string; manual: boolean }
  | { phase: 'error'; currentVersion: string; availableVersion?: string; required: boolean; message: string; manual: boolean; retryable: boolean }
