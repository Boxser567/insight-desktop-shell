import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  AboutWindowController,
  aboutWindowOptions,
  isTrustedAboutUrl
} from '../src/main/about-window'
import { registerAboutUpdateIpc } from '../src/main/about-update-ipc'
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
  it('keeps the sandboxed About preload self-contained while synchronizing theme', async () => {
    const preload = await readFile('src/preload/about.ts', 'utf8')

    expect(preload).not.toContain("import './secondary-theme'")
    expect(preload).toContain("ipcRenderer.invoke('desktop-secondary-theme:get')")
    expect(preload).toContain("ipcRenderer.on('desktop-secondary-theme:changed'")
    expect(preload).toContain("dataset.insightTheme = isDark ? 'dark' : 'light'")
  })

  it('formats approved product metadata without hard-coded release output', () => {
    expect(createAboutViewModel({
      version: '1.0.0-rc.2',
      releaseDate: '2026-09-10'
    })).toEqual({
      productName: '因赛AI',
      poweredBy: 'Powered by InClaw',
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
    expect(aboutWindowOptions({
      parent,
      icon: '/app/icon.png',
      preload: '/app/secondary-theme.cjs',
      platform: 'win32'
    })).toMatchObject({
      width: 440,
      height: 430,
      resizable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      parent,
      modal: false,
      title: '关于因赛AI',
      icon: '/app/icon.png',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        preload: '/app/secondary-theme.cjs',
        partition: 'insight-about'
      }
    })
    expect(aboutWindowOptions({
      parent,
      icon: '/app/icon.png',
      preload: '/app/secondary-theme.cjs',
      platform: 'darwin'
    })).not.toHaveProperty('autoHideMenuBar')
  })

  it('keeps Candidate preference and checks behind the trusted About main frame', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      })
    }
    const trusted = { sender: {}, senderFrame: {} }
    let candidateOptIn = false
    const preferences = {
      read: vi.fn(async () => ({ candidateOptIn })),
      setCandidateOptIn: vi.fn(async (value: boolean) => { candidateOptIn = value })
    }
    const confirmCandidateOptIn = vi.fn().mockResolvedValue(false)
    const openCandidateCheck = vi.fn().mockResolvedValue(undefined)
    registerAboutUpdateIpc({
      ipcMain: ipcMain as never,
      preferences,
      assertTrusted: (event) => {
        if (event !== trusted) throw new Error('untrusted About sender')
      },
      confirmCandidateOptIn,
      openCandidateCheck
    })

    await expect(handlers.get('about-updates:preference')?.(trusted)).resolves.toEqual({
      candidateOptIn: false
    })
    await expect(handlers.get('about-updates:set-candidate-opt-in')?.(trusted, true))
      .resolves.toEqual({ candidateOptIn: false })
    expect(preferences.setCandidateOptIn).not.toHaveBeenCalled()

    confirmCandidateOptIn.mockResolvedValue(true)
    await expect(handlers.get('about-updates:set-candidate-opt-in')?.(trusted, true))
      .resolves.toEqual({ candidateOptIn: true })
    expect(preferences.setCandidateOptIn).toHaveBeenCalledWith(true)
    await handlers.get('about-updates:open-candidate-check')?.(trusted)
    expect(openCandidateCheck).toHaveBeenCalledOnce()

    await expect(Promise.resolve().then(() =>
      handlers.get('about-updates:set-candidate-opt-in')?.({ sender: {}, senderFrame: {} }, false)
    )).rejects.toThrow('untrusted')
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
    const [main, vite, aboutHtml, aboutApp, aboutStyles, packageJson] = await Promise.all([
      readFile('src/main/index.ts', 'utf8'),
      readFile('electron.vite.config.ts', 'utf8'),
      readFile('src/renderer/about.html', 'utf8'),
      readFile('src/renderer/src/AboutApp.tsx', 'utf8'),
      readFile('src/renderer/src/about.css', 'utf8'),
      readFile('package.json', 'utf8')
    ])
    const creation = main.slice(
      main.indexOf('function createAboutWindowController'),
      main.indexOf('function openAboutWindow')
    )

    expect(main).toContain('secureWebContents(window.webContents, isTrustedAboutUrl)')
    expect(creation).toContain('suppressWindowsSecondaryMenu(window)')
    expect(main).toContain('version: app.getVersion()')
    expect(main).toContain('releaseDate: packageJson.insightReleaseDate')
    expect(main).toContain("window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))")
    expect(vite).toContain("about: resolve('src/renderer/about.html')")
    expect(vite).toContain("about: resolve('src/preload/about.ts')")
    expect(creation).toContain("preload: join(import.meta.dirname, '../preload/about.cjs')")
    expect(aboutApp).toContain('接收内测更新')
    expect(aboutApp).toContain('检查内测更新')
    expect(aboutStyles).toContain(':root[data-insight-theme="light"]')
    expect(aboutStyles).toContain(':root[data-insight-theme="dark"]')
    expect(aboutStyles).toContain('--warning-surface')
    expect(aboutHtml).toContain("connect-src 'none'")
    expect(JSON.parse(packageJson).insightReleaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
  })
})
