import type { IpcMain } from 'electron'
import type { UpdateStatus } from '../../shared/update-contracts'

interface TrustedWebContents {
  mainFrame: unknown
  send(channel: string, value: unknown): void
}

interface TrustedWindow {
  isDestroyed(): boolean
  webContents: TrustedWebContents
}

interface InvokeEvent {
  sender: unknown
  senderFrame: unknown
}

interface UpdateManagerApi {
  status(): UpdateStatus
  subscribe(listener: (status: UpdateStatus) => void): () => void
  check(manual: boolean): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  skip(version: string): Promise<void>
}

const UPDATE_CHANNELS = [
  'updates:status',
  'updates:open',
  'updates:check',
  'updates:download',
  'updates:install',
  'updates:skip',
  'updates:quit'
] as const

export function registerUpdateIpc(input: {
  ipcMain: IpcMain
  manager: UpdateManagerApi
  shellWindow(): TrustedWindow | undefined
  harnessWebContents(): TrustedWebContents | undefined
  updateWindow(): TrustedWindow | undefined
  open(): Promise<void>
  quit(): void
}): () => void {
  for (const channel of UPDATE_CHANNELS) input.ipcMain.removeHandler(channel)

  input.ipcMain.handle('updates:status', async (event) => {
    assertBaseSender(event, input)
    return input.manager.status()
  })
  input.ipcMain.handle('updates:open', async (event) => {
    assertBaseSender(event, input)
    await input.open()
  })
  input.ipcMain.handle('updates:check', async (event) => {
    assertBaseSender(event, input)
    await input.manager.check(true)
  })
  input.ipcMain.handle('updates:download', async (event) => {
    assertBaseSender(event, input)
    await input.manager.download()
  })
  input.ipcMain.handle('updates:install', async (event) => {
    assertBaseSender(event, input)
    await input.manager.install()
  })
  input.ipcMain.handle('updates:skip', async (event, version: unknown) => {
    assertBaseSender(event, input)
    if (typeof version !== 'string' || version.trim() === '') {
      throw new Error('更新版本必须是非空字符串。')
    }
    await input.manager.skip(version)
  })
  input.ipcMain.handle('updates:quit', async (event) => {
    assertUpdateWindowSender(event, input.updateWindow())
    input.quit()
  })

  const unsubscribe = input.manager.subscribe((status) => broadcastStatus(input, status))
  return () => {
    unsubscribe()
    for (const channel of UPDATE_CHANNELS) input.ipcMain.removeHandler(channel)
  }
}

function assertBaseSender(
  event: InvokeEvent,
  input: {
    shellWindow(): TrustedWindow | undefined
    harnessWebContents(): TrustedWebContents | undefined
    updateWindow(): TrustedWindow | undefined
  }
): void {
  const shell = input.shellWindow()
  const harness = input.harnessWebContents()
  const update = input.updateWindow()
  if (
    isExactFrame(event, shell?.webContents) ||
    isExactFrame(event, harness) ||
    isExactFrame(event, update?.webContents)
  ) return
  throw new Error('更新命令只允许来自可信窗口的 main frame。')
}

function assertUpdateWindowSender(
  event: InvokeEvent,
  window: TrustedWindow | undefined
): void {
  if (window && !window.isDestroyed() && isExactFrame(event, window.webContents)) return
  throw new Error('退出命令只允许来自 update window。')
}

function isExactFrame(event: InvokeEvent, contents: TrustedWebContents | undefined): boolean {
  return contents !== undefined &&
    event.sender === contents &&
    event.senderFrame === contents.mainFrame
}

function broadcastStatus(
  input: {
    shellWindow(): TrustedWindow | undefined
    harnessWebContents(): TrustedWebContents | undefined
    updateWindow(): TrustedWindow | undefined
  },
  status: UpdateStatus
): void {
  const shell = input.shellWindow()
  if (shell && !shell.isDestroyed()) shell.webContents.send('updates:status-changed', status)
  input.harnessWebContents()?.send('updates:status-changed', status)
  const update = input.updateWindow()
  if (update && !update.isDestroyed()) update.webContents.send('updates:status-changed', status)
}
