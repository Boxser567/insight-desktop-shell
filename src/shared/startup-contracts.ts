/** Ordered Shell-owned phases for one authenticated desktop launch. */
export type StartupPhase =
  | 'restoring-session'
  | 'preparing-profile'
  | 'repairing-profile'
  | 'auditing-runtime'
  | 'starting-runtime'
  | 'loading-client'
  | 'ready'

/** Renderer-safe projection of the current desktop launch; ready means the Harness view has taken over. */
export interface StartupView {
  phase: StartupPhase
  detail: string
  elapsedMs: number
}
