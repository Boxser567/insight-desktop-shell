import { contextBridge, ipcRenderer } from 'electron'
import type { AboutUpdateApi, UpdatePreferences } from '../shared/about-update-api'

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

const updates: AboutUpdateApi = Object.freeze({
  preference: (): Promise<UpdatePreferences> =>
    ipcRenderer.invoke('about-updates:preference'),
  setCandidateOptIn: (value: boolean): Promise<UpdatePreferences> =>
    ipcRenderer.invoke('about-updates:set-candidate-opt-in', value),
  openCandidateCheck: (): Promise<void> =>
    ipcRenderer.invoke('about-updates:open-candidate-check')
})

contextBridge.exposeInMainWorld('insightAboutUpdates', updates)
