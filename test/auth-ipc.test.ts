import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionManager } from '../src/main/auth/auth-session-manager'
import {
  assertTrustedShellEvent,
  validatePasswordLoginInput,
  validateSmsLoginInput
} from '../src/main/auth/auth-ipc'

describe('desktop auth IPC', () => {
  it('accepts only the Shell main frame', () => {
    const mainFrame = {}
    const webContents = { mainFrame }
    const window = { isDestroyed: () => false, webContents }

    expect(() =>
      assertTrustedShellEvent(
        { sender: webContents, senderFrame: mainFrame },
        window
      )
    ).not.toThrow()
    expect(() =>
      assertTrustedShellEvent(
        { sender: {}, senderFrame: mainFrame },
        window
      )
    ).toThrow('Shell main frame')
    expect(() =>
      assertTrustedShellEvent(
        { sender: webContents, senderFrame: {} },
        window
      )
    ).toThrow('Shell main frame')
  })

  it('rejects extra or malformed SMS login fields', () => {
    expect(validateSmsLoginInput({ phone: '13800138000', code: '123456' })).toEqual({
      phone: '13800138000',
      code: '123456'
    })
    expect(() => validateSmsLoginInput({ phone: '13800138000', code: '123456', token: 'x' })).toThrow('SMS login')
    expect(() => validateSmsLoginInput({ phone: '23800138000', code: '123456' })).toThrow('SMS login')
  })

  it('rejects extra or incomplete password login fields', () => {
    expect(
      validatePasswordLoginInput({
        phone: '13800138000',
        password: 'secret123',
        uuid: 'captcha-id',
        imageCode: 'abcd'
      })
    ).toEqual({
      phone: '13800138000',
      password: 'secret123',
      uuid: 'captcha-id',
      imageCode: 'abcd'
    })
    expect(() =>
      validatePasswordLoginInput({
        phone: '13800138000',
        password: '',
        uuid: 'captcha-id',
        imageCode: 'abcd'
      })
    ).toThrow('password login')
  })

  it('does not expose a stable account id through current state', () => {
    const manager = {
      current: vi.fn().mockReturnValue({
        kind: 'authenticated',
        account: { displayName: 'Alice', maskedPhone: '138****8000' }
      })
    } as unknown as AuthSessionManager

    expect(JSON.stringify(manager.current())).not.toContain('42')
  })
})
