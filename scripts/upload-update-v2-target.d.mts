export type V2TargetId = 'darwin-arm64' | 'darwin-x64' | 'win32-x64'

export interface UploadV2TargetInput {
  repository: string
  token: string
  tag: string
  target: V2TargetId
  directory: string
  fetch: typeof globalThis.fetch
}

export interface UploadedV2Asset {
  name: string
  sha512: string
  action: 'uploaded' | 'verified'
}

export function uploadV2Target(input: UploadV2TargetInput): Promise<UploadedV2Asset[]>
