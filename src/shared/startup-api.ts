import type { StartupView } from './startup-contracts'

/** Startup status exposed only to the Shell renderer. */
export interface ShellStartupApi {
  current(): Promise<StartupView>
  subscribe(listener: (view: StartupView) => void): () => void
}
