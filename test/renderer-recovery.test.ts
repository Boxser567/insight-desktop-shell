import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installRendererRecovery } from '../src/main/renderer-recovery'

afterEach(() => vi.useRealTimers())
function setup() {
  vi.useFakeTimers()
  const emitter = Object.assign(new EventEmitter(), { isDestroyed: () => false, reload: vi.fn() })
  const options = { isActive: vi.fn(() => true), onNativeCrash: vi.fn(() => false), note: vi.fn() }
  installRendererRecovery(emitter as unknown as WebContents, options)
  const crash = () => emitter.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  return { emitter, options, crash }
}
describe('renderer recovery wiring', () => {
  it('spaces reloads and stops after three crashes', () => {
    const { emitter, crash } = setup()
    crash(); vi.advanceTimersByTime(0)
    expect(emitter.reload).toHaveBeenCalledTimes(1)
    crash(); crash(); vi.advanceTimersByTime(4999)
    expect(emitter.reload).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(emitter.reload).toHaveBeenCalledTimes(2)
    crash(); vi.advanceTimersByTime(5000)
    crash(); vi.advanceTimersByTime(5000)
    expect(emitter.reload).toHaveBeenCalledTimes(3)
  })
  it('does not revive an account closed while a retry was pending', () => {
    const { emitter, options, crash } = setup()
    crash()
    options.isActive.mockReturnValue(false)
    vi.runAllTimers()
    expect(emitter.reload).not.toHaveBeenCalled()
  })
  it('ignores cancelled navigation, subframes and normal process exits', () => {
    const { emitter } = setup()
    emitter.emit('did-fail-load', {}, -3, '', '', true)
    emitter.emit('did-fail-load', {}, -2, '', '', false)
    emitter.emit('render-process-gone', {}, { reason: 'killed', exitCode: 0 })
    vi.runAllTimers()
    expect(emitter.reload).not.toHaveBeenCalled()
    emitter.emit('did-fail-load', {}, -2, '', '', true)
    vi.runAllTimers()
    expect(emitter.reload).toHaveBeenCalledTimes(1)
  })
  it('cancels reload on destruction or when GPU recovery is relaunching', () => {
    const { emitter, crash, options } = setup()
    options.onNativeCrash.mockReturnValue(true)
    crash(); vi.runAllTimers()
    expect(emitter.reload).not.toHaveBeenCalled()
    options.onNativeCrash.mockReturnValue(false)
    crash(); emitter.emit('destroyed'); vi.runAllTimers()
    expect(emitter.reload).not.toHaveBeenCalled()
  })
})
