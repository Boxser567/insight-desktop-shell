import { contextBridge, ipcRenderer } from 'electron'
import { isPluginLoadError } from './plugin-error-view'
import { mountWindowsTitlebar } from './windows-titlebar'

let bootFailureTriggered = false
let bootFailureTimer: number | undefined
const pendingBootFailureMessages: string[] = []
const BOOT_FAILURE_SETTLE_MS = 400

function currentBootFailureText(): string | undefined {
  const root = document.body || document.documentElement
  if (!root) return undefined
  const text = document.body?.innerText || root.textContent
  if (!text?.includes('Failed to load plugins')) return undefined
  return text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n')
}

function addBootFailureMessage(message: string | undefined): void {
  const normalized = message?.trim()
  if (!normalized || pendingBootFailureMessages.includes(normalized)) return
  pendingBootFailureMessages.push(normalized)
}

function queueBootFailure(message?: string): void {
  if (bootFailureTriggered) return
  addBootFailureMessage(message)
  addBootFailureMessage(currentBootFailureText())
  if (pendingBootFailureMessages.length === 0) return
  if (bootFailureTimer !== undefined) window.clearTimeout(bootFailureTimer)
  bootFailureTimer = window.setTimeout(() => {
    bootFailureTimer = undefined
    if (bootFailureTriggered) return
    addBootFailureMessage(currentBootFailureText())
    const errorText = pendingBootFailureMessages.join('\n')
    if (!errorText) return
    bootFailureTriggered = true
    void ipcRenderer.invoke('harness:open-recovery', errorText)
  }, BOOT_FAILURE_SETTLE_MS)
}

function checkBootFailureInDom(): void {
  const errorText = currentBootFailureText()
  if (errorText) queueBootFailure(errorText)
}

contextBridge.exposeInMainWorld('dshDesktopDirectoryPicker', {
  pick: (): Promise<string | null> => ipcRenderer.invoke('directory-picker:open')
})

contextBridge.exposeInMainWorld(
  'dshDesktop',
  Object.freeze({
    restartHarness: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('harness:restart')
  })
)

contextBridge.exposeInMainWorld(
  'dshRecovery',
  Object.freeze({
    action: (action: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('recovery:action', action)
  })
)

function initializeUi(): void {
  if (process.platform === 'win32') {
    mountWindowsTitlebar({
      document,
      ipcRenderer,
      locale: navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    })
  }
  checkBootFailureInDom()
  new MutationObserver(checkBootFailureInDom).observe(document.documentElement, {
    childList: true,
    subtree: true
  })
}

window.addEventListener('error', (event) => {
  const error = event.error ?? event.message
  if (isPluginLoadError(error)) {
    queueBootFailure(typeof error === 'string' ? error : error instanceof Error ? error.message : String(error))
  }
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  if (isPluginLoadError(reason)) {
    queueBootFailure(typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : String(reason))
  }
})

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initializeUi, { once: true })
} else {
  initializeUi()
}
