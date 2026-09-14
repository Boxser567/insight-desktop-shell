import type { WebContents } from 'electron'
import { MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS, shouldReloadAfterMainWindowRendererLoss } from './main-window-recovery'

/** Recover only the live account's main frame, with bounded, spaced retries. */
export function installRendererRecovery(contents: WebContents, options: {
  isActive: () => boolean
  onNativeCrash: (reason: string, exitCode: number) => boolean
  note: (line: string) => void
}): void {
  let reloadCount = 0
  let lastReloadAt = 0
  let pending: ReturnType<typeof setTimeout> | undefined
  const active = () => !contents.isDestroyed() && options.isActive()
  const requestReload = () => {
    if (!active() || pending) return
    const now = Date.now()
    if (reloadCount >= 3) {
      options.note('[desktop] renderer recovery stopped after 3 reload attempts')
      return
    }
    const delay = lastReloadAt === 0 ? 0 : Math.max(0, MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS - (now - lastReloadAt))
    pending = setTimeout(() => {
      pending = undefined
      if (!active() || !shouldReloadAfterMainWindowRendererLoss({ now: Date.now(), lastReloadAt, reloadCount })) return
      reloadCount += 1
      lastReloadAt = Date.now()
      options.note(`[desktop] recovering renderer, attempt ${reloadCount}`)
      contents.reload()
    }, delay)
  }
  contents.on('render-process-gone', (_event, details) => {
    if (!active() || details.reason === 'clean-exit' || details.reason === 'killed') return
    options.note(`[desktop] renderer lost: ${details.reason}, exit ${details.exitCode}`)
    if (!options.onNativeCrash(details.reason, details.exitCode)) requestReload()
  })
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) requestReload()
  })
  contents.once('destroyed', () => {
    if (pending) clearTimeout(pending)
  })
}
