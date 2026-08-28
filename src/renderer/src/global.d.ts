import type { ShellAuthApi } from '../../shared/shell-api'

declare global {
  interface Window {
    insightAuth: ShellAuthApi
  }
}

export {}
