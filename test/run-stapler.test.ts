import { describe, expect, it, vi } from 'vitest'
import { runStapler } from '../scripts/run-stapler.mjs'

const connectionLost = {
  status: 68,
  stderr: 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost." ' +
    'NSErrorFailingURLStringKey=https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup'
}
const quiet = { writeOutput: vi.fn(), writeWarning: vi.fn() }

describe('Apple ticket service retry', () => {
  it.each(['staple', 'validate'])('retries %s on a CloudKit transport error and requires success', async action => {
    const run = vi.fn().mockResolvedValueOnce(connectionLost).mockResolvedValueOnce({ status: 0 })
    const delay = vi.fn()
    await runStapler(action, '/tmp/因赛 AI.app', { ...quiet, run, delay })
    expect(run.mock.calls).toEqual([[action, '/tmp/因赛 AI.app'], [action, '/tmp/因赛 AI.app']])
    expect(delay).toHaveBeenCalledExactlyOnceWith(15_000)
  })

  it('fails after five transport errors without accepting the artifact', async () => {
    const run = vi.fn().mockResolvedValue(connectionLost)
    const delay = vi.fn()
    await expect(runStapler('staple', '/tmp/App.dmg', { ...quiet, run, delay })).rejects.toThrow('exit code 68')
    expect(run).toHaveBeenCalledTimes(5)
    expect(delay).toHaveBeenCalledTimes(4)
  })

  it.each([
    { status: 65, stderr: 'The staple and validate action failed! Error 65.' },
    { status: 68, stderr: 'CloudKit record not found.' },
    { status: 68, stderr: 'NSURLErrorDomain Code=-1005 https://example.com/' },
    { status: 68, stderr: 'NSURLErrorDomain Code=-1202 https://api.apple-cloudkit.com/' },
    { ...connectionLost, status: 1 }
  ])('fails immediately for a non-retryable failure: $status $stderr', async result => {
    const run = vi.fn().mockResolvedValue(result)
    const delay = vi.fn()
    await expect(runStapler('validate', '/tmp/App.app', { ...quiet, run, delay })).rejects.toThrow('stapler validate failed')
    expect(run).toHaveBeenCalledOnce()
    expect(delay).not.toHaveBeenCalled()
  })
})
