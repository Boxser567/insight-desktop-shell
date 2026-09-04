import type { HarnessAccountApi } from '../../../../src/shared/harness-account-api'
import type { DesktopUpdateApi } from '../../../../src/shared/update-api'

declare global {
  interface Window {
    readonly insightDesktopAccount: HarnessAccountApi
    readonly insightDesktopUpdates: DesktopUpdateApi
  }
}

export {}
