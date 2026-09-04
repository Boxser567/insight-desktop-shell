import type { ShellAuthApi } from '../../shared/shell-api'
import type { DesktopUpdateApi } from '../../shared/update-api'

declare global {
  interface Window {
    insightAuth: ShellAuthApi
    insightDesktopUpdates: DesktopUpdateApi
  }
}

export {}
