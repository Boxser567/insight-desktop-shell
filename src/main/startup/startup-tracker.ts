import type { StartupPhase, StartupView } from '../../shared/startup-contracts'

const PHASE_ORDER: readonly StartupPhase[] = [
  'restoring-session',
  'preparing-profile',
  'repairing-profile',
  'auditing-runtime',
  'starting-runtime',
  'loading-client',
  'ready'
]

type StartupListener = (view: StartupView) => void

/** Track and publish ordered phases for one desktop launch. */
export class StartupTracker {
  private startedAt: number
  private view: StartupView
  private readonly listeners = new Set<StartupListener>()
  private readonly now: () => number
  private readonly log: (message: string) => void

  constructor(options: {
    now?: () => number
    log?: (message: string) => void
  } = {}) {
    this.now = options.now ?? (() => performance.now())
    this.log = options.log ?? (() => undefined)
    this.startedAt = this.now()
    this.view = {
      phase: 'restoring-session',
      detail: '正在安全恢复登录状态…',
      elapsedMs: 0
    }
  }

  current(): StartupView {
    return { ...this.view }
  }

  subscribe(listener: StartupListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  reset(detail: string): void {
    this.startedAt = this.now()
    this.publish('restoring-session', detail)
  }

  transition(phase: StartupPhase, detail: string): void {
    const currentIndex = PHASE_ORDER.indexOf(this.view.phase)
    const nextIndex = PHASE_ORDER.indexOf(phase)
    if (nextIndex < currentIndex) {
      throw new Error(`Startup phase cannot move backward from ${this.view.phase} to ${phase}.`)
    }
    this.publish(phase, detail)
  }

  private publish(phase: StartupPhase, detail: string): void {
    const elapsedMs = Math.max(0, Math.round(this.now() - this.startedAt))
    this.view = { phase, detail, elapsedMs }
    this.log(`[desktop] startup phase ${phase} at ${elapsedMs}ms: ${detail}`)
    for (const listener of this.listeners) listener(this.current())
  }
}
