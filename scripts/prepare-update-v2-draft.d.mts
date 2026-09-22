export interface PrepareV2DraftInput {
  version: string
  commit: string
  repository: string
  token: string
  packagePath: string
  publicKeyPath: string
  floorUrls: string[]
  fetch: typeof globalThis.fetch
}

export interface PreparedV2Draft {
  tag: string
  commit: string
  releaseId: number
  versionFloor: string | null
  createdTag: boolean
  createdDraft: boolean
}

export function prepareV2Draft(input: PrepareV2DraftInput): Promise<PreparedV2Draft>
