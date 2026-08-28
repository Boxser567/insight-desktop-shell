import type { HarnessAccountApi } from '../../../../src/shared/harness-account-api'

declare global {
  interface Window {
    readonly insightDesktopAccount: HarnessAccountApi
  }
}

export {}
