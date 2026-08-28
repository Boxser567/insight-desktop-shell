import type { IpcMain } from 'electron'
import type { AccountSummary } from '../../shared/auth-contracts'
import type { DesktopClientInfo } from '../../shared/harness-account-api'
import type { AuthSessionManager } from '../auth/auth-session-manager'

interface HarnessInvokeEvent {
  sender: unknown
  senderFrame: unknown
}

interface HarnessAccountWebContents {
  send(channel: string, value: AccountSummary | undefined): void
}

const HARNESS_ACCOUNT_CHANNELS = [
  'harness-account:current',
  'harness-account:sign-out',
  'harness-account:info'
] as const

function accountSummary(manager: AuthSessionManager): AccountSummary | undefined {
  const view = manager.current()
  return view.kind === 'authenticated' ? view.account : undefined
}

/** Register the account IPC surface accepted only from the active Harness main frame. */
export function registerHarnessAccountIpc(input: {
  ipcMain: IpcMain
  manager: AuthSessionManager
  assertTrusted(event: HarnessInvokeEvent): void
  harnessWebContents(): HarnessAccountWebContents | undefined
  info(): DesktopClientInfo
}): () => void {
  for (const channel of HARNESS_ACCOUNT_CHANNELS) input.ipcMain.removeHandler(channel)

  input.ipcMain.handle('harness-account:current', (event) => {
    input.assertTrusted(event)
    return accountSummary(input.manager)
  })
  input.ipcMain.handle('harness-account:sign-out', async (event) => {
    input.assertTrusted(event)
    await input.manager.signOut()
  })
  input.ipcMain.handle('harness-account:info', (event) => {
    input.assertTrusted(event)
    return input.info()
  })

  const unsubscribe = input.manager.subscribe(() => {
    input.harnessWebContents()?.send('harness-account:changed', accountSummary(input.manager))
  })

  return () => {
    unsubscribe()
    for (const channel of HARNESS_ACCOUNT_CHANNELS) input.ipcMain.removeHandler(channel)
  }
}
