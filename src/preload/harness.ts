import { contextBridge, ipcRenderer } from 'electron'
import { findBootFailureText } from './boot-failure'
import { isPluginLoadError } from './plugin-error-view'
import type { AccountSummary } from '../shared/auth-contracts'
import type { DesktopClientInfo, HarnessAccountApi } from '../shared/harness-account-api'
import { createDesktopUpdateApi } from './update-api'

let bootFailureTriggered = false
let bootFailureTimer: number | undefined
const pendingBootFailureMessages: string[] = []
const BOOT_FAILURE_SETTLE_MS = 400

function currentBootFailureText(): string | undefined {
  return findBootFailureText(document)
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

contextBridge.exposeInMainWorld(
  'dshSafeMode',
  Object.freeze({
    action: (action: string, plugins: string[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('safe-mode:action', action, plugins)
  })
)

const harnessAccountApi: HarnessAccountApi = Object.freeze({
  current: (): Promise<AccountSummary | undefined> => ipcRenderer.invoke('harness-account:current'),
  subscribe: (listener: (account: AccountSummary | undefined) => void): (() => void) => {
    const handleChanged = (_event: Electron.IpcRendererEvent, account: AccountSummary | undefined): void => {
      listener(account)
    }
    ipcRenderer.on('harness-account:changed', handleChanged)
    return () => ipcRenderer.removeListener('harness-account:changed', handleChanged)
  },
  signOut: (): Promise<void> => ipcRenderer.invoke('harness-account:sign-out'),
  info: (): Promise<DesktopClientInfo> => ipcRenderer.invoke('harness-account:info')
})

contextBridge.exposeInMainWorld('insightDesktopAccount', harnessAccountApi)
contextBridge.exposeInMainWorld('insightDesktopUpdates', createDesktopUpdateApi())

async function mountSafeModeBanner(): Promise<void> {
  if (location.protocol === 'file:' || document.getElementById('dsh-desktop-safe-mode-banner')) return
  const status = (await ipcRenderer.invoke('safe-mode:status')) as { active?: boolean; locale?: 'en' | 'zh' }
  if (status.active !== true) return
  const safeModeLocale = status.locale === 'zh' ? 'zh' : 'en'
  const banner = document.createElement('div')
  banner.id = 'dsh-desktop-safe-mode-banner'
  banner.style.cssText = 'position:fixed;top:8px;left:50%;z-index:2147483645;transform:translateX(-50%);display:flex;gap:8px;padding:8px;border-radius:10px;background:#27272a;color:#fff'
  const title = document.createElement('span')
  title.textContent = safeModeLocale === 'zh' ? '安全模式' : 'Safe Mode'
  const manage = document.createElement('button')
  manage.textContent = safeModeLocale === 'zh' ? '卸载插件' : 'Remove plugins'
  manage.addEventListener('click', () => void ipcRenderer.invoke('safe-mode:manage'))
  const exit = document.createElement('button')
  exit.textContent = safeModeLocale === 'zh' ? '退出安全模式' : 'Exit Safe Mode'
  exit.addEventListener('click', () => void ipcRenderer.invoke('safe-mode:exit'))
  banner.append(title, manage, exit)
  document.documentElement.appendChild(banner)
}

function initializeUi(): void {
  checkBootFailureInDom()
  new MutationObserver(checkBootFailureInDom).observe(document.documentElement, {
    childList: true,
    subtree: true
  })
  void mountSafeModeBanner().catch((error: unknown) => console.warn('[safe-mode] unable to mount banner', error))
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
