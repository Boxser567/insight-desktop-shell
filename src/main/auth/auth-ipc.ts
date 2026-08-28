import type { IpcMain } from 'electron'
import type { PasswordLoginInput, SmsLoginInput } from '../../shared/auth-contracts'
import type { AuthSessionManager } from './auth-session-manager'

interface TrustedShellWindow {
  isDestroyed(): boolean
  webContents: {
    mainFrame: unknown
    send?(channel: string, value: unknown): void
  }
}

interface ShellInvokeEvent {
  sender: unknown
  senderFrame: unknown
}

const AUTH_CHANNELS = [
  'auth:current',
  'auth:retry',
  'auth:send-sms',
  'auth:captcha',
  'auth:login-sms',
  'auth:login-password',
  'auth:sign-out'
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function validPhone(phone: unknown): phone is string {
  return typeof phone === 'string' && /^1[3-9]\d{9}$/u.test(phone)
}

/** Reject IPC that did not originate from the Shell window's main frame. */
export function assertTrustedShellEvent(
  event: ShellInvokeEvent,
  window: TrustedShellWindow | undefined
): void {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error('Authentication commands are only available from the Shell main frame.')
  }
}

/** Validate the complete runtime input for SMS login. */
export function validateSmsLoginInput(value: unknown): SmsLoginInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['code', 'phone']) ||
    !validPhone(value.phone) ||
    typeof value.code !== 'string' ||
    value.code.length === 0
  ) {
    throw new Error('Invalid SMS login input.')
  }
  return { phone: value.phone, code: value.code }
}

/** Validate the complete runtime input for password login. */
export function validatePasswordLoginInput(value: unknown): PasswordLoginInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['imageCode', 'password', 'phone', 'uuid']) ||
    !validPhone(value.phone) ||
    typeof value.password !== 'string' ||
    value.password.length === 0 ||
    typeof value.uuid !== 'string' ||
    value.uuid.length === 0 ||
    typeof value.imageCode !== 'string' ||
    value.imageCode.length === 0
  ) {
    throw new Error('Invalid password login input.')
  }
  return {
    phone: value.phone,
    password: value.password,
    uuid: value.uuid,
    imageCode: value.imageCode
  }
}

/** Register the narrow authentication IPC surface for the Shell renderer. */
export function registerAuthIpc(input: {
  ipcMain: IpcMain
  manager: AuthSessionManager
  shellWindow(): TrustedShellWindow | undefined
}): () => void {
  const trusted = (event: ShellInvokeEvent): void =>
    assertTrustedShellEvent(event, input.shellWindow())
  for (const channel of AUTH_CHANNELS) input.ipcMain.removeHandler(channel)

  input.ipcMain.handle('auth:current', (event) => {
    trusted(event)
    return input.manager.current()
  })
  input.ipcMain.handle('auth:retry', async (event) => {
    trusted(event)
    await input.manager.retry()
  })
  input.ipcMain.handle('auth:send-sms', async (event, phone: unknown) => {
    trusted(event)
    if (!validPhone(phone)) {
      return { ok: false, reason: 'invalid-input', message: '请输入正确的手机号。' }
    }
    return input.manager.sendSmsCode(phone)
  })
  input.ipcMain.handle('auth:captcha', (event) => {
    trusted(event)
    return input.manager.loadCaptcha()
  })
  input.ipcMain.handle('auth:login-sms', (event, value: unknown) => {
    trusted(event)
    try {
      return input.manager.loginSms(validateSmsLoginInput(value))
    } catch {
      return { ok: false, reason: 'invalid-input', message: '登录信息不完整。' }
    }
  })
  input.ipcMain.handle('auth:login-password', (event, value: unknown) => {
    trusted(event)
    try {
      return input.manager.loginPassword(validatePasswordLoginInput(value))
    } catch {
      return { ok: false, reason: 'invalid-input', message: '登录信息不完整。' }
    }
  })
  input.ipcMain.handle('auth:sign-out', async (event) => {
    trusted(event)
    await input.manager.signOut()
  })

  const unsubscribe = input.manager.subscribe((view) => {
    const window = input.shellWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send?.('auth:changed', view)
  })

  return () => {
    unsubscribe()
    for (const channel of AUTH_CHANNELS) input.ipcMain.removeHandler(channel)
  }
}
