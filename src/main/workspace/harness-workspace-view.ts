interface ContentBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Minimum WebContents surface used by the Harness view container. */
export interface HarnessViewWebContents {
  readonly mainFrame: unknown
  loadURL(url: string): Promise<void>
  send(channel: string, value: unknown): void
  isDestroyed(): boolean
  close(): void
}

/** Minimum WebContentsView surface used by the container. */
export interface HarnessViewInstance {
  readonly webContents: HarnessViewWebContents
  setBounds(bounds: ContentBounds): void
  setVisible(visible: boolean): void
}

/** BrowserWindow operations required to attach one Harness view. */
export interface HarnessViewHost {
  isDestroyed(): boolean
  getContentBounds(): ContentBounds
  watchContentBounds(listener: () => void): () => void
  contentView: {
    addChildView(view: HarnessViewInstance): void
    removeChildView(view: HarnessViewInstance): void
  }
  createHarnessView(scope: string): HarnessViewInstance
}

const ACCOUNT_SCOPE_PATTERN = /^[a-f0-9]{32}$/u

function isLoopbackHarnessUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

/** Own the isolated Harness WebContentsView attached to the Shell window. */
export class HarnessWorkspaceView {
  private view?: HarnessViewInstance
  private stopWatchingBounds?: () => void
  private scope?: string
  private url?: string

  constructor(private readonly getHost: () => HarnessViewHost | undefined) {}

  setScope(scope: string): void {
    if (!ACCOUNT_SCOPE_PATTERN.test(scope)) throw new Error('The workspace scope is invalid.')
    if (this.view && this.scope !== scope) {
      throw new Error('Close the current Harness view before changing accounts.')
    }
    this.scope = scope
  }

  async open(url: string): Promise<void> {
    if (!isLoopbackHarnessUrl(url)) {
      throw new Error('Harness workspace URLs must use a loopback HTTP origin.')
    }
    const host = this.getHost()
    if (!host || host.isDestroyed()) throw new Error('The Shell window is unavailable.')
    if (!this.scope) throw new Error('An account scope is required before opening Harness.')

    if (!this.view || this.view.webContents.isDestroyed()) {
      this.view = host.createHarnessView(this.scope)
      host.contentView.addChildView(this.view)
      this.stopWatchingBounds = host.watchContentBounds(() => this.applyBounds())
      this.url = undefined
    }
    this.applyBounds()
    if (this.url !== url) {
      await this.view.webContents.loadURL(url)
      this.url = url
    }
    this.view.setVisible(true)
  }

  async close(): Promise<void> {
    const view = this.view
    this.view = undefined
    const stopWatchingBounds = this.stopWatchingBounds
    this.stopWatchingBounds = undefined
    this.url = undefined
    this.scope = undefined
    if (!view) return

    stopWatchingBounds?.()
    view.setVisible(false)
    const host = this.getHost()
    if (host && !host.isDestroyed()) host.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  isTrustedSender(sender: unknown, senderFrame: unknown): boolean {
    const contents = this.view?.webContents
    return (
      contents !== undefined &&
      !contents.isDestroyed() &&
      sender === contents &&
      senderFrame === contents.mainFrame
    )
  }

  webContents(): HarnessViewWebContents | undefined {
    const contents = this.view?.webContents
    return contents && !contents.isDestroyed() ? contents : undefined
  }

  private applyBounds(): void {
    const view = this.view
    const host = this.getHost()
    if (!view || !host || host.isDestroyed()) return

    const content = host.getContentBounds()
    view.setBounds({ x: 0, y: 0, width: content.width, height: content.height })
  }
}
