export interface RecoveryRuntimeIdentity {
  schemaVersion: number
  core: { repository: string; version: string; commit: string }
  node: { version: string }
  target: { platform: string; arch: string }
}

export interface SessionRecoveryPhase {
  phase: 'previous' | 'candidate' | 'recovery' | 'verify'
  writer: number
  sessions: { id: string; events: number; toolResults: number; developerMessages: number; turns: number }[]
}

export interface SessionRecoveryProof {
  schema: 'insight-session-recovery-proof/v1'
  checkedAt: string
  candidate: RecoveryRuntimeIdentity
  recovery: RecoveryRuntimeIdentity
  previous?: RecoveryRuntimeIdentity
  preservedHistoricalFiles?: Record<string, string>
  phases: SessionRecoveryPhase[]
}

export function verifySessionRecovery(input: {
  candidateRuntime: string
  recoveryRuntime: string
  previousRuntime?: string
}): Promise<SessionRecoveryProof>
