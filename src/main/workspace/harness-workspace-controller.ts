import type { WorkspaceBounds } from '../../shared/shell-api'
import type { WorkspaceAccount, WorkspaceDriver } from './workspace-lifecycle'

interface AccountRuntime {
  configureDshHome(dshHome: string): void
  stop(): Promise<void>
}

interface AccountWorkspaceView {
  setScope(scope: string): void
  setBounds(bounds: WorkspaceBounds | null): void
  open(url: string): Promise<void>
  close(): Promise<void>
  isTrustedSender(sender: unknown, senderFrame: unknown): boolean
}

/** Coordinates one account-scoped Harness runtime with its isolated view. */
export class HarnessWorkspaceController implements WorkspaceDriver {
  private account?: WorkspaceAccount

  constructor(
    private readonly runtime: AccountRuntime,
    private readonly view: AccountWorkspaceView,
    private readonly launch: (account: WorkspaceAccount) => Promise<void>
  ) {}

  async start(account: WorkspaceAccount): Promise<void> {
    this.runtime.configureDshHome(account.dshHome)
    this.view.setScope(account.scope)
    this.account = account
    try {
      await this.launch(account)
    } catch (error) {
      this.account = undefined
      throw error
    }
  }

  async stop(): Promise<void> {
    this.account = undefined
    await this.view.close()
    await this.runtime.stop()
  }

  setBounds(bounds: WorkspaceBounds | null): void {
    this.view.setBounds(bounds)
  }

  async open(url: string): Promise<void> {
    if (!this.account) throw new Error('An authenticated workspace is required.')
    await this.view.open(url)
  }

  currentDshHome(): string | undefined {
    return this.account?.dshHome
  }

  isTrustedSender(sender: unknown, senderFrame: unknown): boolean {
    return this.view.isTrustedSender(sender, senderFrame)
  }
}
