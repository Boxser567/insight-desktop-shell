import { describe, expect, it, vi } from 'vitest'
import { registerStartupIpc } from '../src/main/startup/startup-ipc'
import { StartupTracker } from '../src/main/startup/startup-tracker'

describe('Startup IPC', () => {
  it('serves only the trusted Shell frame', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    }
    const trustedEvent = { sender: {}, senderFrame: {} }
    const tracker = new StartupTracker({ now: () => 0 })

    registerStartupIpc({
      ipcMain: ipcMain as never,
      tracker,
      assertTrusted: (event) => {
        if (event !== trustedEvent) throw new Error('untrusted Shell frame')
      },
      shellWindow: () => undefined
    })

    const current = handlers.get('startup:current')
    expect(await current?.(trustedEvent)).toEqual(tracker.current())
    expect(() => current?.({ sender: {}, senderFrame: {} })).toThrow('untrusted Shell frame')
  })

  it('notifies the Shell window and disposes the handler', () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    }
    const tracker = new StartupTracker({ now: () => 0 })
    const send = vi.fn()

    const dispose = registerStartupIpc({
      ipcMain: ipcMain as never,
      tracker,
      assertTrusted: vi.fn(),
      shellWindow: () => ({ isDestroyed: () => false, webContents: { send } })
    })
    tracker.transition('preparing-profile', '正在准备本地运行环境…')

    expect(send).toHaveBeenCalledWith('startup:changed', tracker.current())
    dispose()
    tracker.transition('repairing-profile', '正在检查插件与依赖…')
    expect(send).toHaveBeenCalledOnce()
    expect(handlers.size).toBe(0)
  })
})
