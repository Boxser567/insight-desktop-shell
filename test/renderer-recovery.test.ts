import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installRendererRecovery } from '../src/main/renderer-recovery'

afterEach(() => vi.useRealTimers())
function setup() {
  vi.useFakeTimers()
  const emitter = Object.assign(new EventEmitter(), { isDestroyed: () => false, reload: vi.fn() })
  const options = { isActive: vi.fn(() => true), onNativeCrash: vi.fn(() => false), note: vi.fn(), gpuStatus: vi.fn(() => ({ gpu_compositing: 'enabled' })) }
  installRendererRecovery(emitter as unknown as WebContents, options)
  const crash = () => emitter.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  return { emitter, options, crash }
}
describe('renderer recovery wiring', () => {
  it('records hangs and recovery without reloading or recording page content', () => {
    const { emitter, options } = setup()
    emitter.emit('unresponsive')
    emitter.emit('responsive')
    expect(options.note).toHaveBeenCalledWith(expect.stringContaining('"event":"unresponsive"'))
    expect(options.note).toHaveBeenCalledWith(expect.stringContaining('"event":"responsive"'))
    expect(options.note).toHaveBeenCalledWith(expect.stringContaining('"gpu_compositing":"enabled"'))
    vi.runAllTimers()
    expect(emitter.reload).not.toHaveBeenCalled()
  })
  it('records killed processes without restarting them', () => {
    const { emitter, options } = setup()
    emitter.emit('render-process-gone', {}, { reason: 'killed', exitCode: 9 })
    expect(options.note).toHaveBeenCalledWith(expect.stringContaining('"exitCode":9'))
    vi.runAllTimers()
    expect(emitter.reload).not.toHaveBeenCalled()
  })
  it('keeps recovery working if GPU diagnostics fail and ignores inactive accounts', () => {
    const { emitter, options, crash } = setup()
    options.gpuStatus.mockImplementation(() => { throw new Error('sensitive details') })
    crash()
    expect(options.note).toHaveBeenCalledWith(expect.stringContaining('"gpu":"unavailable"'))
    expect(JSON.stringify(options.note.mock.calls)).not.toContain('sensitive details')
    vi.runAllTimers()
    expect(emitter.reload).toHaveBeenCalledTimes(1)
    options.isActive.mockReturnValue(false)
    options.note.mockClear()
    emitter.emit('unresponsive')
    expect(options.note).not.toHaveBeenCalled()
  })
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
