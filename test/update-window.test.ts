import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  UpdateWindowController,
  updateWindowOptions
} from '../src/main/update/update-window'
import { updateViewModel } from '../src/renderer/src/update-view-model'
import { shouldShowUpdateEntry } from '../src/shared/update-visibility'

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
      width: 480,
      height: 280,
      minWidth: 480,
      minHeight: 280,
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

  it('projects every update phase without paths, URLs or credentials', () => {
    expect(updateViewModel({ phase: 'idle', currentVersion: '1.0.0' }).primary).toBe('check')
    expect(updateViewModel({
      phase: 'available', currentVersion: '1.0.0', availableVersion: '1.1.0', required: false, manual: true
    })).toMatchObject({
      primary: 'download',
      secondary: 'skip',
      recovery: 'download-full-installer'
    })
    expect(updateViewModel({
      phase: 'downloading', currentVersion: '1.0.0', availableVersion: '1.1.0', required: false, percent: 42, manual: true
    }).detail).toContain('42%')
    expect(updateViewModel({
      phase: 'downloaded', currentVersion: '1.0.0', availableVersion: '1.1.0', required: false, manual: true
    }).primary).toBe('install')
    expect(updateViewModel({
      phase: 'error', currentVersion: '1.0.0', availableVersion: '1.1.0', required: true, message: 'offline', manual: true, retryable: true, manualInstallerAvailable: true
    })).toMatchObject({ primary: 'retry', secondary: 'quit', recovery: 'download-full-installer' })
    expect(updateViewModel({
      phase: 'unsupported', currentVersion: '1.0.0', reason: 'development build', manual: true
    }).detail).toContain('development build')
  })

  it('renders checking as indeterminate progress without a fake cancel action', async () => {
    const source = await readFile('src/renderer/src/UpdateApp.tsx', 'utf8')
    const checking = updateViewModel({
      phase: 'checking',
      currentVersion: '1.0.0',
      manual: true
    })

    expect(checking.title).toBe('正在检查更新…')
    expect(source).toContain('className="update-summary"')
    expect(source).toContain('className="update-logo"')
    expect(source).toContain('className="update-content"')
    expect(source).toContain('className="update-recovery"')
    expect(source).toContain("download: '下载更新'")
    expect(source).toContain("install: '安装并重启'")
    expect(source).toContain("status.phase === 'checking'")
    expect(source).toContain('className="update-progress update-progress--checking"')
    expect(source).toContain('aria-label="正在检查更新"')
    expect(source).not.toMatch(/取消检查|>取消</u)
  })

  it('shows update entries only after a real release has been verified', () => {
    expect(shouldShowUpdateEntry(undefined)).toBe(false)
    expect(shouldShowUpdateEntry({ phase: 'idle', currentVersion: '1.0.0' })).toBe(false)
    expect(shouldShowUpdateEntry({
      phase: 'checking', currentVersion: '1.0.0', manual: false
    })).toBe(false)
    expect(shouldShowUpdateEntry({
      phase: 'error', currentVersion: '1.0.0', required: false, message: 'bad signature', manual: false, retryable: true, manualInstallerAvailable: false
    })).toBe(false)
    expect(shouldShowUpdateEntry({
      phase: 'available', currentVersion: '1.0.0', availableVersion: '1.1.0', required: false, manual: false
    })).toBe(true)
    expect(shouldShowUpdateEntry({
      phase: 'error', currentVersion: '1.0.0', availableVersion: '1.1.0', required: false, message: 'download failed', manual: false, retryable: true, manualInstallerAvailable: true
    })).toBe(true)
  })
})
