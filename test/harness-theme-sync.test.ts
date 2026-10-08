import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountHarnessThemeSync } from '../src/preload/windows-titlebar'

afterEach(() => vi.unstubAllGlobals())

function setup() {
  let source: string | null = 'light'
  let dark = false
  let notify!: () => void
  let mediaChanged!: () => void
  const observe = vi.fn()
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { notify = callback }
    observe = observe
  })
  vi.stubGlobal('window', {
    matchMedia: () => ({ addEventListener: (_event: string, callback: () => void) => { mediaChanged = callback } })
  })
  const document = {
    documentElement: { getAttribute: () => source },
    body: { hasAttribute: () => dark },
    defaultView: { getComputedStyle: () => ({ backgroundColor: dark ? 'rgb(21, 21, 23)' : 'rgb(255, 255, 255)' }) }
  } as unknown as Document
  const invoke = vi.fn().mockResolvedValue({ ok: true })
  mountHarnessThemeSync({ document, ipcRenderer: { invoke } })
  return { invoke, observe, notify: () => notify(), mediaChanged: () => mediaChanged(), setTheme: (value: string | null, isDark = false) => { source = value; dark = isDark } }
}

describe('Harness native theme synchronization', () => {
  it('forwards the Core theme source and suppresses unchanged DOM and media events', () => {
    const { invoke, notify, mediaChanged } = setup()
    expect(invoke).toHaveBeenLastCalledWith('desktop-titlebar:set-theme', false, 'light')
    for (let i = 0; i < 100; i++) { notify(); mediaChanged() }
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('observes the source and forwards preference changes even when the palette stays light', () => {
    const { invoke, observe, notify, setTheme } = setup()
    expect(observe).toHaveBeenCalledWith(expect.anything(), { attributes: true, attributeFilter: ['data-ds-theme-source'] })
    setTheme('system')
    notify()
    expect(invoke).toHaveBeenLastCalledWith('desktop-titlebar:set-theme', false, 'system')
    setTheme('system', true)
    notify()
    expect(invoke).toHaveBeenLastCalledWith('desktop-titlebar:set-theme', true, 'system')
    setTheme('dark', true)
    notify()
    expect(invoke).toHaveBeenLastCalledWith('desktop-titlebar:set-theme', true, 'dark')
    expect(invoke).toHaveBeenCalledTimes(4)
  })

  it('leaves the native source to the persisted preference for older Core pages', () => {
    const { invoke, notify, setTheme } = setup()
    setTheme(null, true)
    notify()
    expect(invoke).toHaveBeenLastCalledWith('desktop-titlebar:set-theme', true, undefined)
  })
})
