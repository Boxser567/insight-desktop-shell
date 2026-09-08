import type { IpcMain } from 'electron'
import type { StartupTracker } from './startup-tracker'

interface StartupInvokeEvent {
  sender: unknown
  senderFrame: unknown
}

interface StartupWindow {
  isDestroyed(): boolean
  webContents: {
    send(channel: string, value: unknown): void
  }
}

/** Register the read-only startup status IPC surface for the Shell renderer. */
export function registerStartupIpc(input: {
  ipcMain: IpcMain
  tracker: StartupTracker
  assertTrusted(event: StartupInvokeEvent): void
  shellWindow(): StartupWindow | undefined
}): () => void {
  input.ipcMain.removeHandler('startup:current')
  input.ipcMain.handle('startup:current', (event) => {
    input.assertTrusted(event)
    return input.tracker.current()
  })

  const unsubscribe = input.tracker.subscribe((view) => {
    const window = input.shellWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send('startup:changed', view)
  })

  return () => {
    unsubscribe()
    input.ipcMain.removeHandler('startup:current')
  }
}
