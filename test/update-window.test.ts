import { describe, expect, it, vi } from 'vitest'
import {
  UpdateWindowController,
  updateWindowOptions
} from '../src/main/update/update-window'
import { createUpdateFixture, resolveUpdateFixture } from '../src/main/update/update-fixture'
import { updateViewModel } from '../src/renderer/src/update-view-model'

function fakeWindow() {
  const handlers = new Map<string, () => void>()
  return {
    isDestroyed: vi.fn(() => false),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    once: vi.fn((name: string, handler: () => void) => {
      handlers.set(name, handler)
    }),
    handlers
  }
}

describe('desktop update window', () => {
  it('uses isolated sandboxed web preferences and remains hidden until ready', () => {
    const parent = {} as never
    const options = updateWindowOptions({ parent, preload: '/app/update.cjs', icon: '/app/icon.png' })

    expect(options).toMatchObject({
      width: 560,
      height: 360,
      show: false,
      parent,
      modal: false,
      webPreferences: {
        preload: '/app/update.cjs',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
  })

  it('focuses one existing window and clears it only after close', async () => {
    const window = fakeWindow()
    const create = vi.fn(() => window)
    const load = vi.fn().mockResolvedValue(undefined)
    const controller = new UpdateWindowController({ create: create as never, load: load as never })

    await controller.open()
    expect(window.show).not.toHaveBeenCalled()
    window.handlers.get('ready-to-show')?.()
    expect(window.show).toHaveBeenCalledOnce()
    await controller.open()
    expect(create).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    window.handlers.get('closed')?.()
    await controller.open()
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('keeps fixture injection unavailable to packaged clients', () => {
    expect(resolveUpdateFixture({ packaged: true, name: 'available' })).toBeUndefined()
    expect(resolveUpdateFixture({ packaged: false, name: 'available' })).toBe('available')
    expect(resolveUpdateFixture({ packaged: false, name: 'required' })).toBe('required')
    expect(resolveUpdateFixture({ packaged: false, name: 'required-error' })).toBe('required-error')
    expect(resolveUpdateFixture({ packaged: false, name: 'unknown' })).toBeUndefined()
  })

  it('provides an offline required-update failure rehearsal', async () => {
    const fixture = createUpdateFixture({
      name: 'required-error',
      currentVersion: '1.0.0',
      userData: '/unused'
    })
    const events: unknown[] = []
    fixture.executor.on((event) => events.push(event))

    const release = await fixture.source.resolve('stable', {
      channel: 'stable',
      platform: 'darwin',
      arch: 'arm64'
    })
    await fixture.executor.download()

    expect(release.manifest.policy.mode).toBe('required')
    expect(events).toEqual([
      { type: 'error', message: 'Fixture：模拟强制更新下载失败。' }
    ])
  })

  it('projects every update phase without paths, URLs or credentials', () => {
    expect(updateViewModel({ phase: 'idle', currentVersion: '1.0.0' }).primary).toBe('check')
    expect(updateViewModel({
      phase: 'available', currentVersion: '1.0.0', availableVersion: '1.1.0', required: false, manual: true
    })).toMatchObject({ primary: 'download', secondary: 'skip' })
    expect(updateViewModel({
      phase: 'downloading', currentVersion: '1.0.0', availableVersion: '1.1.0', required: false, percent: 42, manual: true
    }).detail).toContain('42%')
    expect(updateViewModel({
      phase: 'downloaded', currentVersion: '1.0.0', availableVersion: '1.1.0', required: false, manual: true
    }).primary).toBe('install')
    expect(updateViewModel({
      phase: 'error', currentVersion: '1.0.0', availableVersion: '1.1.0', required: true, message: 'offline', manual: true, retryable: true
    })).toMatchObject({ primary: 'retry', secondary: 'quit' })
    expect(updateViewModel({
      phase: 'unsupported', currentVersion: '1.0.0', reason: 'development build', manual: true
    }).detail).toContain('development build')
  })
})
