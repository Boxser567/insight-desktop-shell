import { contextBridge, ipcRenderer } from 'electron'
import type {
  PasswordLoginInput,
  SessionView,
  SmsLoginInput
} from '../shared/auth-contracts'
import type {
  ShellAuthApi
} from '../shared/shell-api'
import { createDesktopUpdateApi } from './update-api'

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

contextBridge.exposeInMainWorld('insightAuth', auth)
contextBridge.exposeInMainWorld('insightDesktopUpdates', createDesktopUpdateApi())
