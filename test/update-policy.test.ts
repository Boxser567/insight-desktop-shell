import { describe, expect, it } from 'vitest'
import {
  AUTO_INSTALL_ON_APP_QUIT,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_STARTUP_DELAY_MS,
  UPDATE_STARTUP_JITTER_MS,
  isUpdateCheckDue,
  resolveUpdateSupport,
  startupCheckDelay,
  shouldSuppressSkippedUpdate
} from '../src/main/update/update-policy'

describe('desktop update policy', () => {
  it('uses the agreed scheduling and installation constants', () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1_000)
    expect(UPDATE_STARTUP_DELAY_MS).toBe(15_000)
    expect(UPDATE_STARTUP_JITTER_MS).toBe(15_000)
    expect(AUTO_INSTALL_ON_APP_QUIT).toBe(false)
  })

  it('checks at the exact six-hour boundary', () => {
    const lastCheckedAt = 1_000

    expect(isUpdateCheckDue(lastCheckedAt, lastCheckedAt + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false)
    expect(isUpdateCheckDue(lastCheckedAt, lastCheckedAt + UPDATE_CHECK_INTERVAL_MS)).toBe(true)
    expect(isUpdateCheckDue(undefined, lastCheckedAt)).toBe(true)
  })

  it('keeps startup checks inside the 15-to-30-second window', () => {
    expect(startupCheckDelay(() => 0)).toBe(15_000)
    expect(startupCheckDelay(() => 0.999_999)).toBe(29_999)
    expect(() => startupCheckDelay(() => 1)).toThrow('随机数')
  })

  it.each([
    [{ packaged: true, channel: 'stable', platform: 'darwin', arch: 'arm64' }, true],
    [{ packaged: true, channel: 'candidate', platform: 'darwin', arch: 'x64' }, true],
    [{ packaged: true, channel: 'stable', platform: 'win32', arch: 'x64' }, true],
    [{ packaged: false, channel: 'stable', platform: 'darwin', arch: 'arm64' }, false],
    [{ packaged: true, channel: 'development', platform: 'darwin', arch: 'arm64' }, false],
    [{ packaged: true, channel: 'stable', platform: 'linux', arch: 'x64' }, false],
    [{ packaged: true, channel: 'stable', platform: 'win32', arch: 'arm64' }, false]
  ] as const)('resolves supported packaged targets for %o', (input, supported) => {
    expect(resolveUpdateSupport(input).supported).toBe(supported)
  })

  it('only suppresses a matching optional version during automatic checks', () => {
    const input = { availableVersion: '1.2.3', skippedVersion: '1.2.3' }

    expect(shouldSuppressSkippedUpdate({ ...input, manual: false, required: false })).toBe(true)
    expect(shouldSuppressSkippedUpdate({ ...input, manual: true, required: false })).toBe(false)
    expect(shouldSuppressSkippedUpdate({ ...input, manual: false, required: true })).toBe(false)
    expect(shouldSuppressSkippedUpdate({ ...input, skippedVersion: '1.2.2', manual: false, required: false })).toBe(false)
  })
})
