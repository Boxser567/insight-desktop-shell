import { afterEach, expect, it, vi } from 'vitest'
import { observeHarnessBoot } from '../src/preload/boot-observer'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('coalesces boot changes and stops scanning after hydration', () => {
  vi.useFakeTimers()
  let notify!: () => void
  const disconnect = vi.fn()
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { notify = callback }
    observe() {}
    disconnect = disconnect
  })
  let boot: unknown = {}
  const document = { documentElement: {}, querySelector: () => boot } as unknown as Document
  const scan = vi.fn()
  observeHarnessBoot(document, scan)
  expect(scan).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 100; i++) notify()
  vi.advanceTimersByTime(100)
  expect(scan).toHaveBeenCalledTimes(2)
  boot = null
  notify(); vi.advanceTimersByTime(100)
  expect(disconnect).toHaveBeenCalledTimes(1)
  notify(); vi.advanceTimersByTime(100)
  expect(scan).toHaveBeenCalledTimes(3)
})
