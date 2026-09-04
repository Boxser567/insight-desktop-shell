import { autoUpdater } from 'electron-updater'
import type {
  AppUpdater,
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo
} from 'electron-updater'
import type { ReleaseUpdateChannel } from '../../shared/update-contracts'

export interface ExecutorUpdate {
  version: string
}

export type ExecutorEvent =
  | { type: 'available'; version: string }
  | { type: 'not-available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string; downloadedFile: string }
  | { type: 'error'; message: string }

export interface UpdateExecutor {
  configure(options: {
    channel: ReleaseUpdateChannel
    autoInstallOnQuit: false
  }): void
  check(): Promise<ExecutorUpdate | undefined>
  download(): Promise<void>
  quitAndInstall(): void
  on(listener: (event: ExecutorEvent) => void): () => void
}

/** Adapt electron-updater without exposing its events outside Main. */
export class ElectronUpdateExecutor implements UpdateExecutor {
  private readonly listeners = new Set<(event: ExecutorEvent) => void>()

  constructor(private readonly updater: AppUpdater = autoUpdater) {
    updater.on('update-available', (info: UpdateInfo) => {
      this.emit({ type: 'available', version: info.version })
    })
    updater.on('update-not-available', (info: UpdateInfo) => {
      this.emit({ type: 'not-available', version: info.version })
    })
    updater.on('download-progress', (info: ProgressInfo) => {
      this.emit({ type: 'progress', percent: info.percent })
    })
    updater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
      this.emit({
        type: 'downloaded',
        version: info.version,
        downloadedFile: info.downloadedFile
      })
    })
    updater.on('error', (error: Error) => {
      this.emit({ type: 'error', message: error.message })
    })
  }

  configure(options: {
    channel: ReleaseUpdateChannel
    autoInstallOnQuit: false
  }): void {
    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = options.autoInstallOnQuit
    this.updater.allowPrerelease = options.channel === 'candidate'
    this.updater.allowDowngrade = false
  }

  async check(): Promise<ExecutorUpdate | undefined> {
    const result = await this.updater.checkForUpdates()
    return result?.isUpdateAvailable
      ? { version: result.updateInfo.version }
      : undefined
  }

  async download(): Promise<void> {
    await this.updater.downloadUpdate()
  }

  quitAndInstall(): void {
    this.updater.quitAndInstall()
  }

  on(listener: (event: ExecutorEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: ExecutorEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
