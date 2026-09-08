import type { SessionView } from '../../shared/auth-contracts'

/** Main-owned paths required to start one authenticated workspace. */
export interface WorkspaceAccount {
  scope: string
  dshHome: string
}

/** Runtime and view operations controlled by the authentication gate. */
export interface WorkspaceDriver {
  start(account: WorkspaceAccount): Promise<void>
  stop(): Promise<void>
}

/** Serialize session changes so an obsolete account cannot remain visible. */
export class WorkspaceLifecycle {
  private revision = 0
  private scope?: string
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly driver: WorkspaceDriver) {}

  activeScope(): string | undefined {
    return this.scope
  }

  apply(view: SessionView, account?: WorkspaceAccount): Promise<void> {
    const revision = ++this.revision
    const operation = this.queue.then(() => this.applyNext(revision, view, account))
    this.queue = operation.catch(() => undefined)
    return operation
  }

  stop(): Promise<void> {
    ++this.revision
    const operation = this.queue.then(() => this.stopActive())
    this.queue = operation.catch(() => undefined)
    return operation
  }

  private async applyNext(
    revision: number,
    view: SessionView,
    account?: WorkspaceAccount
  ): Promise<void> {
    if (revision !== this.revision) return
    if (view.kind !== 'authenticated') {
      await this.stopActive()
      return
    }
    if (!account) throw new Error('An authenticated session requires a workspace account.')
    if (this.scope === account.scope) return

    if (this.scope !== undefined) {
      await this.stopActive()
    }

    await this.driver.start(account)
    if (revision !== this.revision) {
      await this.driver.stop()
      return
    }
    this.scope = account.scope
  }

  private async stopActive(): Promise<void> {
    if (this.scope === undefined) return
    this.scope = undefined
    await this.driver.stop()
  }
}
