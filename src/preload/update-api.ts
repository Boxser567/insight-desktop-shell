import { ipcRenderer } from 'electron'
import type { DesktopUpdateApi } from '../shared/update-api'
import type { UpdateStatus } from '../shared/update-contracts'

export function createDesktopUpdateApi(): DesktopUpdateApi {
  return Object.freeze({
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke('updates:status'),
    subscribe: (listener: (status: UpdateStatus) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => {
        listener(status)
      }
      ipcRenderer.on('updates:status-changed', handler)
      return () => ipcRenderer.removeListener('updates:status-changed', handler)
    },
    open: (): Promise<void> => ipcRenderer.invoke('updates:open'),
    check: (): Promise<void> => ipcRenderer.invoke('updates:check'),
    download: (): Promise<void> => ipcRenderer.invoke('updates:download'),
    install: (): Promise<void> => ipcRenderer.invoke('updates:install'),
    skip: (version: string): Promise<void> => ipcRenderer.invoke('updates:skip', version)
  })
}
