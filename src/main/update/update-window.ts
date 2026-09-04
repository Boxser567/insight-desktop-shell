import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

interface ManagedUpdateWindow {
  isDestroyed(): boolean
  show(): void
  focus(): void
  close(): void
  once(event: 'ready-to-show' | 'closed', listener: () => void): void
}

export function updateWindowOptions(input: {
  parent?: BrowserWindow
  preload: string
  icon: string
}): BrowserWindowConstructorOptions {
  return {
    width: 560,
    height: 360,
    minWidth: 520,
    minHeight: 340,
    show: false,
    parent: input.parent,
    modal: false,
    title: '因赛AI 更新',
    icon: input.icon,
    backgroundColor: '#202024',
    webPreferences: {
      preload: input.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: 'persist:insight-update'
    }
  }
}

/** Own a single update window and focus it on repeated open requests. */
export class UpdateWindowController<Window extends ManagedUpdateWindow> {
  private current?: Window

  constructor(private readonly options: {
    create(): Window
    load(window: Window): Promise<void>
  }) {}

  async open(): Promise<void> {
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
      await this.options.load(window)
    } catch (error) {
      if (!window.isDestroyed()) window.close()
      throw error
    }
  }

  window(): Window | undefined {
    return this.current && !this.current.isDestroyed() ? this.current : undefined
  }

  close(): void {
    const window = this.window()
    if (window) window.close()
  }
}
