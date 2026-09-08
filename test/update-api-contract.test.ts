import { describe, expect, it, vi } from 'vitest'
import { registerUpdateIpc } from '../src/main/update/update-ipc'
import type { UpdateStatus } from '../src/shared/update-contracts'

function windowStub() {
  const mainFrame = {}
  return {
    isDestroyed: () => false,
    close: vi.fn(),
    webContents: { mainFrame, send: vi.fn() }
  }
}

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
  let status: UpdateStatus = { phase: 'idle', currentVersion: '1.0.0' }
  let listener: ((value: UpdateStatus) => void) | undefined
  const manager = {
    status: vi.fn(() => status),
    subscribe: vi.fn((next: (value: UpdateStatus) => void) => {
      listener = next
      return () => { listener = undefined }
    }),
    check: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    skip: vi.fn().mockResolvedValue(undefined)
  }
  const shell = windowStub()
  const harness = windowStub()
  const update = windowStub()
  const open = vi.fn().mockResolvedValue(undefined)
  const quit = vi.fn()
  const dispose = registerUpdateIpc({
    ipcMain: ipcMain as never,
    manager,
    shellWindow: () => shell,
    harnessWebContents: () => harness.webContents,
    updateWindow: () => update,
    open,
    quit
  })
  return {
    handlers,
    manager,
    shell,
    harness,
    update,
    open,
    quit,
    dispose,
    publish(value: UpdateStatus) {
      status = value
      listener?.(value)
    }
  }
}

function event(window: ReturnType<typeof windowStub>) {
  return { sender: window.webContents, senderFrame: window.webContents.mainFrame }
}

describe('desktop update IPC', () => {
  it('registers the fixed update channels and delegates base commands from trusted main frames', async () => {
    const fixture = setup()

    await expect(fixture.handlers.get('updates:status')?.(event(fixture.shell))).resolves.toEqual({
      phase: 'idle',
      currentVersion: '1.0.0'
    })
    await fixture.handlers.get('updates:open')?.(event(fixture.harness))
    await fixture.handlers.get('updates:check')?.(event(fixture.update))
    await fixture.handlers.get('updates:download')?.(event(fixture.shell))
    await fixture.handlers.get('updates:install')?.(event(fixture.harness))
    await fixture.handlers.get('updates:skip')?.(event(fixture.update), '1.1.0')

    expect(fixture.open).toHaveBeenCalledOnce()
    expect(fixture.manager.check).toHaveBeenCalledWith(true)
    expect(fixture.manager.download).toHaveBeenCalledOnce()
    expect(fixture.manager.install).toHaveBeenCalledOnce()
    expect(fixture.manager.skip).toHaveBeenCalledWith('1.1.0')
    expect(fixture.update.close).toHaveBeenCalledOnce()
  })

  it('rejects untrusted senders and non-main frames for every mutation', async () => {
    const fixture = setup()
    const attacker = { sender: {}, senderFrame: {} }
    const childFrame = { sender: fixture.shell.webContents, senderFrame: {} }

    for (const channel of [
      'updates:open',
      'updates:check',
      'updates:download',
      'updates:install',
      'updates:skip'
    ]) {
      await expect(Promise.resolve().then(() => fixture.handlers.get(channel)?.(attacker, '1.1.0')))
        .rejects.toThrow('main frame')
      await expect(Promise.resolve().then(() => fixture.handlers.get(channel)?.(childFrame, '1.1.0')))
        .rejects.toThrow('main frame')
    }
  })

  it('allows ordinary quit only from the update window main frame', async () => {
    const fixture = setup()

    await expect(Promise.resolve().then(() =>
      fixture.handlers.get('updates:quit')?.(event(fixture.shell))
    )).rejects.toThrow('update window')
    await expect(Promise.resolve().then(() =>
      fixture.handlers.get('updates:quit')?.(event(fixture.harness))
    )).rejects.toThrow('update window')
    await fixture.handlers.get('updates:quit')?.(event(fixture.update))

    expect(fixture.quit).toHaveBeenCalledOnce()
  })

  it('broadcasts only the renderer-safe status and removes handlers on dispose', () => {
    const fixture = setup()
    const changed: UpdateStatus = {
      phase: 'available',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      required: false,
      manual: false
    }

    fixture.publish(changed)

    expect(fixture.shell.webContents.send).toHaveBeenCalledWith('updates:status-changed', changed)
    expect(fixture.harness.webContents.send).toHaveBeenCalledWith('updates:status-changed', changed)
    expect(fixture.update.webContents.send).toHaveBeenCalledWith('updates:status-changed', changed)
    fixture.dispose()
    expect(fixture.handlers).toHaveLength(0)
  })
})
