import type { ShellAuthApi } from '../../shared/shell-api'
import type { DesktopUpdateApi } from '../../shared/update-api'
import type { ShellStartupApi } from '../../shared/startup-api'

declare global {
  interface Window {
    insightAuth: ShellAuthApi
    insightStartup: ShellStartupApi
    insightDesktopUpdates: DesktopUpdateApi
  }
}

export {}
