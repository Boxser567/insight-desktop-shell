import { describe, expect, it, vi } from 'vitest'
import {
  isInternalXprotectFailure,
  verifyMacosDistribution
} from '../scripts/verify-macos-distribution.mjs'

const internalXprotectOutput = `
Passed codesign --verify -R="notarized" --check-notarization
Passed Gatekeeper scan
Internal Xprotect Error
Severity: Fatal
`

describe('macOS distribution check', () => {
  it('recognizes only the fully qualified internal XProtect failure', () => {
    expect(isInternalXprotectFailure(70, internalXprotectOutput)).toBe(true)
    expect(isInternalXprotectFailure(1, internalXprotectOutput)).toBe(false)
    expect(isInternalXprotectFailure(70, 'Internal Xprotect Error')).toBe(false)
    expect(isInternalXprotectFailure(70, `${internalXprotectOutput}\nSeverity: Fatal`)).toBe(false)
  })

  it('retries an internal XProtect failure and then succeeds', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ status: 70, stdout: internalXprotectOutput, stderr: '' })
      .mockResolvedValueOnce({ status: 0, stdout: 'ready', stderr: '' })
    const delay = vi.fn()

    await expect(verifyMacosDistribution('/tmp/App.app', {
      run,
      delay,
      writeOutput: vi.fn(),
      writeWarning: vi.fn()
    })).resolves.toEqual({ degraded: false, attempts: 2 })
    expect(run).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledTimes(1)
  })

  it('continues with an explicit degraded result after repeated internal errors', async () => {
    const run = vi.fn().mockResolvedValue({
      status: 70,
      stdout: internalXprotectOutput,
      stderr: ''
    })
    const writeWarning = vi.fn()

    await expect(verifyMacosDistribution('/tmp/App.app', {
      run,
      delay: vi.fn(),
      writeOutput: vi.fn(),
      writeWarning
    })).resolves.toEqual({ degraded: true, attempts: 3 })
    expect(run).toHaveBeenCalledTimes(3)
    expect(writeWarning).toHaveBeenCalledTimes(3)
  })

  it('fails immediately for a real distribution error', async () => {
    const run = vi.fn().mockResolvedValue({
      status: 1,
      stdout: 'Codesign Error',
      stderr: ''
    })

    await expect(verifyMacosDistribution('/tmp/App.app', {
      run,
      delay: vi.fn(),
      writeOutput: vi.fn(),
      writeWarning: vi.fn()
    })).rejects.toThrow('syspolicy_check failed with exit code 1.')
    expect(run).toHaveBeenCalledTimes(1)
  })
})
