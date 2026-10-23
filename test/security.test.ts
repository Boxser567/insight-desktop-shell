import type { Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { secureWebContents } from '../src/main/security'
import { canGrantWindowPermission, isTrustedAppUrl } from '../src/main/security-policy'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

const harnessUrl = 'http://127.0.0.1:43127/session'
const canvasUrl = 'http://127.0.0.1:43127/desktop-canvas/view?id=video'

function permissions(allowHarnessPermissions = true, topLevelUrl = harnessUrl) {
  const session = {
    setPermissionCheckHandler: vi.fn<Session['setPermissionCheckHandler']>(),
    setPermissionRequestHandler: vi.fn<Session['setPermissionRequestHandler']>()
  }
  const contents = {
    session,
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    isDestroyed: vi.fn(() => false),
    getURL: vi.fn(() => topLevelUrl)
  }
  const webContents = contents as unknown as WebContents
  const getHarnessUrl = vi.fn<() => string | undefined>(() => harnessUrl)
  secureWebContents(webContents, isTrustedAppUrl, allowHarnessPermissions, getHarnessUrl)
  const check = session.setPermissionCheckHandler.mock.calls[0]![0]!
  const request = session.setPermissionRequestHandler.mock.calls[0]![0]!
  return { contents, webContents, getHarnessUrl, check, request }
}

describe('Harness fullscreen permissions', () => {
  it.each([
    [harnessUrl, true, true],
    [canvasUrl, false, true],
    ['http://127.0.0.1:43128/desktop-canvas/view', false, false],
    ['http://localhost:43127/desktop-canvas/view', false, false],
    ['https://127.0.0.1:43127/desktop-canvas/view', false, false],
    ['https://example.com/video', false, false],
    ['file:///tmp/video.html', false, false],
    ['about:blank', false, false],
    ['', false, false],
    ['invalid URL', false, false]
  ])('checks and requests fullscreen for %s (main frame: %s)', (requestingUrl, isMainFrame, allowed) => {
    const { webContents, check, request } = permissions()
    expect(check(webContents, 'fullscreen', new URL(harnessUrl).origin, {
      requestingUrl, isMainFrame
    })).toBe(allowed)
    const callback = vi.fn()
    request(webContents, 'fullscreen', callback, { requestingUrl, isMainFrame })
    expect(callback).toHaveBeenCalledExactlyOnceWith(allowed)
  })

  it('uses the requesting origin when a permission check has no frame URL', () => {
    const { webContents, check } = permissions()
    expect(check(webContents, 'fullscreen', 'http://127.0.0.1:43127', {
      isMainFrame: false
    })).toBe(true)
    expect(check(webContents, 'fullscreen', 'http://127.0.0.1:43128', {
      isMainFrame: false
    })).toBe(false)
    expect(check(webContents, 'fullscreen', '', { isMainFrame: false })).toBe(false)
  })

  it.each(['', 'invalid URL', 'file:///app/index.html', 'dsh-recovery://app', 'https://example.com'])(
    'rejects fullscreen from an untrusted top-level page: %s', (topLevelUrl) => {
      const { webContents, check, request } = permissions(true, topLevelUrl)
      const details = { requestingUrl: canvasUrl, isMainFrame: false }
      expect(check(webContents, 'fullscreen', 'http://127.0.0.1:43127', details)).toBe(false)
      const callback = vi.fn()
      request(webContents, 'fullscreen', callback, details)
      expect(callback).toHaveBeenCalledExactlyOnceWith(false)
    }
  )

  it('rejects fullscreen when either URL is missing', () => {
    expect(canGrantWindowPermission('fullscreen', undefined, false, harnessUrl, harnessUrl)).toBe(false)
    expect(canGrantWindowPermission('fullscreen', canvasUrl, false, undefined, harnessUrl)).toBe(false)
    expect(canGrantWindowPermission('fullscreen', canvasUrl, false, harnessUrl)).toBe(false)
  })

  it('checks the current top-level URL after navigation', () => {
    const { contents, webContents, check, request } = permissions()
    contents.getURL.mockReturnValue('http://127.0.0.1:43128/session')
    const details = { requestingUrl: canvasUrl, isMainFrame: false }
    expect(check(webContents, 'fullscreen', 'http://127.0.0.1:43127', details)).toBe(false)
    const callback = vi.fn()
    request(webContents, 'fullscreen', callback, details)
    expect(callback).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('rejects another loopback service even when its top-level page and iframe are same-origin', () => {
    const { webContents, check, request } = permissions(true, 'http://127.0.0.1:43128/session')
    const details = { requestingUrl: 'http://127.0.0.1:43128/video', isMainFrame: false }
    expect(check(webContents, 'fullscreen', 'http://127.0.0.1:43128', details)).toBe(false)
    const callback = vi.fn()
    request(webContents, 'fullscreen', callback, details)
    expect(callback).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('uses the current Runtime origin after a restart', () => {
    const { contents, webContents, getHarnessUrl, check, request } = permissions()
    contents.getURL.mockReturnValue('http://127.0.0.1:43128/session')
    getHarnessUrl.mockReturnValue('http://127.0.0.1:43128')
    const details = { requestingUrl: 'http://127.0.0.1:43128/video', isMainFrame: false }
    expect(check(webContents, 'fullscreen', 'http://127.0.0.1:43128', details)).toBe(true)
    const callback = vi.fn()
    request(webContents, 'fullscreen', callback, details)
    expect(callback).toHaveBeenCalledExactlyOnceWith(true)
    getHarnessUrl.mockReturnValue(undefined)
    expect(check(webContents, 'fullscreen', 'http://127.0.0.1:43128', details)).toBe(false)
    callback.mockClear()
    request(webContents, 'fullscreen', callback, details)
    expect(callback).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does not grant permissions to another WebContents sharing the session', () => {
    const { webContents, check, request } = permissions()
    const other = { ...webContents } as WebContents
    const details = { requestingUrl: canvasUrl, isMainFrame: false }
    expect(check(other, 'fullscreen', 'http://127.0.0.1:43127', details)).toBe(false)
    expect(check(null, 'fullscreen', 'http://127.0.0.1:43127', details)).toBe(false)
    const callback = vi.fn()
    request(other, 'fullscreen', callback, details)
    expect(callback).toHaveBeenCalledExactlyOnceWith(false)
  })

  it.each(['disabled', 'destroyed'] as const)('rejects fullscreen when the view is %s', (state) => {
    const { contents, webContents, check, request } = permissions(state !== 'disabled')
    if (state === 'destroyed') contents.isDestroyed.mockReturnValue(true)
    const details = { requestingUrl: canvasUrl, isMainFrame: false }
    expect(check(webContents, 'fullscreen', 'http://127.0.0.1:43127', details)).toBe(false)
    const callback = vi.fn()
    request(webContents, 'fullscreen', callback, details)
    expect(callback).toHaveBeenCalledExactlyOnceWith(false)
    expect(contents.getURL).not.toHaveBeenCalled()
  })

  it('supports a localhost Harness origin', () => {
    const { webContents, getHarnessUrl, check, request } = permissions(true, 'http://localhost:43127/session')
    getHarnessUrl.mockReturnValue('http://localhost:43127')
    const details = { requestingUrl: 'http://localhost:43127/desktop-canvas/view', isMainFrame: false }
    expect(check(webContents, 'fullscreen', 'http://localhost:43127', details)).toBe(true)
    const callback = vi.fn()
    request(webContents, 'fullscreen', callback, details)
    expect(callback).toHaveBeenCalledExactlyOnceWith(true)
  })

  it.each([
    ['clipboard-sanitized-write', true, true],
    ['clipboard-sanitized-write', false, false],
    ['clipboard-read', true, false],
    ['media', true, false],
    ['pointerLock', true, false]
  ] as const)('preserves %s permissions (main frame: %s)', (permission, isMainFrame, allowed) => {
    const { webContents, check, request } = permissions()
    const details = { requestingUrl: harnessUrl, isMainFrame }
    expect(check(webContents, permission, 'http://127.0.0.1:43127', details)).toBe(allowed)
    const callback = vi.fn()
    request(webContents, permission, callback, details)
    expect(callback).toHaveBeenCalledExactlyOnceWith(allowed)
  })
})
