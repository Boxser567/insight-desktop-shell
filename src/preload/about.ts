import { contextBridge, ipcRenderer } from 'electron'
import type { AboutUpdateApi, UpdatePreferences } from '../shared/about-update-api'
import './secondary-theme'

const updates: AboutUpdateApi = Object.freeze({
  preference: (): Promise<UpdatePreferences> =>
    ipcRenderer.invoke('about-updates:preference'),
  setCandidateOptIn: (value: boolean): Promise<UpdatePreferences> =>
    ipcRenderer.invoke('about-updates:set-candidate-opt-in', value),
  openCandidateCheck: (): Promise<void> =>
    ipcRenderer.invoke('about-updates:open-candidate-check')
})

contextBridge.exposeInMainWorld('insightAboutUpdates', updates)
