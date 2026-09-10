import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  AboutWindowController,
  aboutWindowOptions,
  isTrustedAboutUrl
} from '../src/main/about-window'
import { createAboutViewModel } from '../src/renderer/src/about-view-model'

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

describe('desktop About window', () => {
  it('formats approved product metadata without hard-coded release output', () => {
    expect(createAboutViewModel({
      version: '1.0.0-rc.2',
      releaseDate: '2026-09-10'
    })).toEqual({
      productName: '因赛AI',
      poweredBy: 'Powered by InClaw & OWL',
      versionText: '版本 1.0.0-rc.2',
      releaseText: '发布于 2026年9月10日',
      copyright: '© 因赛AI'
    })
    expect(() => createAboutViewModel({ version: 'v1', releaseDate: '2026-09-10' })).toThrow(
      'Invalid desktop version metadata.'
    )
    expect(() => createAboutViewModel({ version: '1.0.0', releaseDate: '2026-02-31' })).toThrow(
      'Invalid desktop release date metadata.'
    )
  })

  it('uses a fixed sandboxed local window', () => {
    const parent = {} as never
    expect(aboutWindowOptions({ parent, icon: '/app/icon.png' })).toMatchObject({
      width: 380,
      height: 312,
      resizable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      parent,
      modal: false,
      title: '关于因赛AI',
      icon: '/app/icon.png',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: 'insight-about'
      }
    })
  })

  it('accepts only the packaged or configured development About page', () => {
    const packagedUrl = 'file:///app/out/renderer/about.html'
    expect(isTrustedAboutUrl(
      'file:///app/out/renderer/about.html?version=1.0.0',
      undefined,
      packagedUrl
    )).toBe(true)
    expect(isTrustedAboutUrl(
      'file:///tmp/renderer/about.html?version=1.0.0',
      undefined,
      packagedUrl
    )).toBe(false)
    expect(isTrustedAboutUrl('file:///app/out/renderer/update.html', undefined, packagedUrl)).toBe(false)
    expect(isTrustedAboutUrl('https://example.com/about.html', undefined, packagedUrl)).toBe(false)
    expect(isTrustedAboutUrl(
      'http://127.0.0.1:5173/about.html?version=1.0.0',
      'http://127.0.0.1:5173'
    )).toBe(true)
    expect(isTrustedAboutUrl(
      'http://evil.invalid/about.html',
      'http://127.0.0.1:5173'
    )).toBe(false)
  })

  it('focuses one existing instance and closes a window that fails to load', async () => {
    const window = fakeWindow()
    const create = vi.fn(() => window)
    const load = vi.fn().mockResolvedValue(undefined)
    const controller = new AboutWindowController({ create: create as never, load: load as never })
    const metadata = { version: '1.0.0', releaseDate: '2026-09-10' }

    await controller.open(metadata)
    expect(load).toHaveBeenCalledWith(window, metadata)
    expect(window.show).not.toHaveBeenCalled()
    window.handlers.get('ready-to-show')?.()
    expect(window.show).toHaveBeenCalledOnce()
    await controller.open(metadata)
    expect(create).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    window.handlers.get('closed')?.()
    await controller.open(metadata)
    expect(create).toHaveBeenCalledTimes(2)

    const broken = fakeWindow()
    const failed = new AboutWindowController({
      create: () => broken as never,
      load: async () => { throw new Error('load failed') }
    })
    await expect(failed.open(metadata)).rejects.toThrow('load failed')
    expect(broken.close).toHaveBeenCalledOnce()
  })

  it('wires controlled metadata and security from Main', async () => {
    const [main, vite, aboutHtml, packageJson] = await Promise.all([
      readFile('src/main/index.ts', 'utf8'),
      readFile('electron.vite.config.ts', 'utf8'),
      readFile('src/renderer/about.html', 'utf8'),
      readFile('package.json', 'utf8')
    ])

    expect(main).toContain('secureWebContents(window.webContents, isTrustedAboutUrl)')
    expect(main).toContain('version: app.getVersion()')
    expect(main).toContain('releaseDate: packageJson.insightReleaseDate')
    expect(main).toContain("window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))")
    expect(vite).toContain("about: resolve('src/renderer/about.html')")
    expect(aboutHtml).toContain("connect-src 'none'")
    expect(JSON.parse(packageJson).insightReleaseDate).toBe('2026-09-10')
  })
})
