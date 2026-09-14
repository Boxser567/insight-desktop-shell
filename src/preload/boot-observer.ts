import { BOOT_FAILURE_ROOT_SELECTOR } from './boot-failure'

/** Stop scanning once boot is replaced by the client; coalesce boot mutations. */
export function observeHarnessBoot(document: Document, checkFailure: () => void): () => void {
  let stopped = false
  let sawBoot = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    stopped = true
    observer.disconnect()
    if (timer !== undefined) clearTimeout(timer)
  }
  const scan = () => {
    timer = undefined
    if (stopped) return
    const boot = document.querySelector(BOOT_FAILURE_ROOT_SELECTOR)
    if (boot) sawBoot = true
    checkFailure()
    if (!boot && (sawBoot || document.querySelector('[data-dsh-sidebar-root]'))) stop()
  }
  const observer = new MutationObserver(() => {
    if (!stopped && timer === undefined) timer = setTimeout(scan, 100)
  })
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true })
  scan()
  return stop
}
