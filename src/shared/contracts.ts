export type RuntimePhase =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'failed'

export interface RuntimeSnapshot {
  phase: RuntimePhase
  message: string
  workspace?: string
  logs: string[]
  url?: string
}
