import type { ShellAuthApi, ShellWorkspaceApi } from '../../shared/shell-api'

declare global {
  interface Window {
    insightAuth: ShellAuthApi
    insightWorkspace: ShellWorkspaceApi
  }
}

export {}
