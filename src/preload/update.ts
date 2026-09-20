import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopUpdateWindowApi } from '../shared/update-api'
import type { UpdateStatus } from '../shared/update-contracts'

function applyTheme(isDark: boolean): void {
  document.documentElement.dataset.insightTheme = isDark ? 'dark' : 'light'
}

function mountTheme(): void {
  const sync = (): void => {
    void ipcRenderer.invoke('desktop-secondary-theme:get')
      .then((value: unknown) => {
        if (
          typeof value === 'object' &&
          value !== null &&
          'isDark' in value &&
          typeof value.isDark === 'boolean'
        ) {
          applyTheme(value.isDark)
        }
      })
      .catch((error: unknown) => {
        console.warn('[desktop-theme] unable to read the current theme', error)
      })
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync, { once: true })
  } else {
    sync()
  }
  ipcRenderer.on('desktop-secondary-theme:changed', (_event, isDark: unknown) => {
    if (typeof isDark === 'boolean') applyTheme(isDark)
  })
}

mountTheme()

const updates: DesktopUpdateWindowApi = Object.freeze({
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
  downloadFullInstaller: (): Promise<void> => ipcRenderer.invoke('updates:download-full-installer'),
  install: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  skip: (version: string): Promise<void> => ipcRenderer.invoke('updates:skip', version),
  quit: (): Promise<void> => ipcRenderer.invoke('updates:quit')
})

contextBridge.exposeInMainWorld('insightDesktopUpdates', updates)
