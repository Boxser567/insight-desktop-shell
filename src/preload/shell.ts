import { contextBridge, ipcRenderer } from 'electron'
import type {
  PasswordLoginInput,
  SessionView,
  SmsLoginInput
} from '../shared/auth-contracts'
import type {
  ShellAuthApi
} from '../shared/shell-api'
import type { DesktopUpdateApi } from '../shared/update-api'
import type { UpdateStatus } from '../shared/update-contracts'

const auth: ShellAuthApi = Object.freeze({
  current: () => ipcRenderer.invoke('auth:current'),
  subscribe: (listener: (view: SessionView) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, view: SessionView): void => {
      listener(view)
    }
    ipcRenderer.on('auth:changed', handler)
    return () => ipcRenderer.removeListener('auth:changed', handler)
  },
  retry: () => ipcRenderer.invoke('auth:retry'),
  sendSmsCode: (phone: string) => ipcRenderer.invoke('auth:send-sms', phone),
  loadCaptcha: () => ipcRenderer.invoke('auth:captcha'),
  loginSms: (input: SmsLoginInput) => ipcRenderer.invoke('auth:login-sms', input),
  loginPassword: (input: PasswordLoginInput) =>
    ipcRenderer.invoke('auth:login-password', input),
  signOut: () => ipcRenderer.invoke('auth:sign-out')
})

const updates: DesktopUpdateApi = Object.freeze({
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

contextBridge.exposeInMainWorld('insightAuth', auth)
contextBridge.exposeInMainWorld('insightDesktopUpdates', updates)
