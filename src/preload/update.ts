import { contextBridge, ipcRenderer } from 'electron'
import { createDesktopUpdateApi } from './update-api'
import type { DesktopUpdateWindowApi } from '../shared/update-api'

const updates: DesktopUpdateWindowApi = Object.freeze({
  ...createDesktopUpdateApi(),
  quit: (): Promise<void> => ipcRenderer.invoke('updates:quit')
})

contextBridge.exposeInMainWorld('insightDesktopUpdates', updates)
