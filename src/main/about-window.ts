import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

export interface AboutMetadata {
  readonly version: string
  readonly releaseDate: string
}

interface ManagedAboutWindow {
  isDestroyed(): boolean
  show(): void
  focus(): void
  close(): void
  once(event: 'ready-to-show' | 'closed', listener: () => void): void
}

export function aboutWindowOptions(input: {
  parent?: BrowserWindow
  icon: string
}): BrowserWindowConstructorOptions {
  return {
    width: 380,
    height: 312,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    parent: input.parent,
    modal: false,
    title: '关于因赛AI',
    icon: input.icon,
    backgroundColor: '#202024',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: 'insight-about'
    }
  }
}

export function isTrustedAboutUrl(
  rawUrl: string,
  developmentUrl = process.env.ELECTRON_RENDERER_URL
): boolean {
  try {
    const url = new URL(rawUrl)
    if (developmentUrl) {
      return url.origin === new URL(developmentUrl).origin && url.pathname.endsWith('/about.html')
    }
    return url.protocol === 'file:' && url.pathname.endsWith('/renderer/about.html')
  } catch {
    return false
  }
}

/** Own one read-only About window and focus it on repeated requests. */
export class AboutWindowController<Window extends ManagedAboutWindow> {
  private current?: Window

  constructor(private readonly options: {
    create(): Window
    load(window: Window, metadata: AboutMetadata): Promise<void>
  }) {}

  async open(metadata: AboutMetadata): Promise<void> {
    if (this.current && !this.current.isDestroyed()) {
      this.current.show()
      this.current.focus()
      return
    }
    const window = this.options.create()
    this.current = window
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
    window.once('closed', () => {
      if (this.current === window) this.current = undefined
    })
    try {
      await this.options.load(window, metadata)
    } catch (error) {
      if (!window.isDestroyed()) window.close()
      throw error
    }
  }

  close(): void {
    if (this.current && !this.current.isDestroyed()) this.current.close()
  }
}
