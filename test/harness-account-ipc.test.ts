import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionManager } from '../src/main/auth/auth-session-manager'
import { registerHarnessAccountIpc } from '../src/main/workspace/harness-account-ipc'

describe('Harness account IPC', () => {
  it('serves only the active Harness frame and exposes no account identity secrets', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    }
    const account = { displayName: 'Alice', avatarUrl: 'https://example.test/a.png', maskedPhone: '138****8000' }
    const manager = {
      current: vi.fn(() => ({ kind: 'authenticated', account })),
      signOut: vi.fn(),
      subscribe: vi.fn(() => vi.fn())
    } as unknown as AuthSessionManager
    const trustedEvent = { sender: {}, senderFrame: {} }
    const assertTrusted = vi.fn((event: unknown) => {
      if (event !== trustedEvent) throw new Error('untrusted Harness frame')
    })

    registerHarnessAccountIpc({
      ipcMain: ipcMain as never,
      manager,
      assertTrusted,
      harnessWebContents: () => undefined,
      info: () => ({ version: '0.1.1', environment: 'test', platform: 'darwin' })
    })

    const current = handlers.get('harness-account:current')
    expect(current).toBeDefined()
    expect(await current?.(trustedEvent)).toEqual(account)
    expect(JSON.stringify(await current?.(trustedEvent))).not.toMatch(/token|cookie|accountId|dshHome/u)
    expect(() => current?.({ sender: {}, senderFrame: {} })).toThrow('untrusted Harness frame')
  })

  it('notifies the active Harness view and disposes all handlers', () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    }
    let listener: (() => void) | undefined
    const unsubscribe = vi.fn()
    const manager = {
      current: vi.fn(() => ({
        kind: 'authenticated',
        account: { displayName: 'Alice', maskedPhone: '138****8000' }
      })),
      signOut: vi.fn(),
      subscribe: vi.fn((next: () => void) => {
        listener = next
        return unsubscribe
      })
    } as unknown as AuthSessionManager
    const send = vi.fn()

    const dispose = registerHarnessAccountIpc({
      ipcMain: ipcMain as never,
      manager,
      assertTrusted: vi.fn(),
      harnessWebContents: () => ({ send }),
      info: () => ({ version: '0.1.1', environment: 'test', platform: 'darwin' })
    })

    listener?.()
    expect(send).toHaveBeenCalledWith('harness-account:changed', {
      displayName: 'Alice',
      maskedPhone: '138****8000'
    })
    dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(handlers.size).toBe(0)
  })
})
