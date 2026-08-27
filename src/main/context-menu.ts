import { clipboard, Menu, shell, type BrowserWindow, type WebContents } from 'electron'
import { buildContextMenuTemplate } from './context-menu-template'

export function installContextMenu(
  window: BrowserWindow,
  locale: () => 'en' | 'zh'
): void {
  installWebContentsContextMenu(window.webContents, window, locale)
}

/** Install the application context menu for a window-owned renderer. */
export function installWebContentsContextMenu(
  contents: WebContents,
  window: BrowserWindow,
  locale: () => 'en' | 'zh'
): void {
  contents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, locale(), {
      openLink: (url) => {
        void shell.openExternal(url)
      },
      copyLink: (url) => clipboard.writeText(url),
      copyImage: () => {
        if (window.isDestroyed()) return
        contents.copyImageAt(params.x, params.y)
      }
    })

    if (template.length === 0 || window.isDestroyed()) return
    Menu.buildFromTemplate(template).popup({ window })
  })
}
