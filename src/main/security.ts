import { shell, type BrowserWindow, type WebContents } from 'electron'
import { canGrantWindowPermission, isTrustedAppUrl } from './security-policy'

/** Apply navigation, popup, webview, and permission rules to one renderer. */
export function secureWebContents(
  contents: WebContents,
  isTrustedUrl: (url: string) => boolean,
  allowHarnessPermissions = false,
  getHarnessUrl?: () => string | undefined
): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) return { action: 'allow' }
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isTrustedUrl(url)) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
  })

  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      allowHarnessPermissions &&
      webContents === contents &&
      !contents.isDestroyed() &&
      canGrantWindowPermission(
        permission,
        details.requestingUrl ?? requestingOrigin,
        details.isMainFrame,
        contents.getURL(),
        getHarnessUrl?.()
      )
  )
  contents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        allowHarnessPermissions &&
        webContents === contents &&
        !contents.isDestroyed() &&
        canGrantWindowPermission(
          permission,
          details.requestingUrl,
          details.isMainFrame,
          contents.getURL(),
          getHarnessUrl?.()
        )
      )
    }
  )
}

/** Preserve the legacy recovery-window policy. */
export function secureWindow(window: BrowserWindow): void {
  secureWebContents(window.webContents, isTrustedAppUrl, true)
}
