import { describe, expect, it } from 'vitest'
import {
  initialUpdateStatus,
  reduceUpdateState
} from '../src/main/update/update-state'
import type { UpdateStateEvent } from '../src/main/update/update-state'

describe('desktop update state', () => {
  it('runs the complete download and install transition sequence', () => {
    let state = initialUpdateStatus('1.0.0')
    state = reduceUpdateState(state, { type: 'check', manual: false })
    state = reduceUpdateState(state, {
      type: 'available',
      version: '1.1.0',
      required: false,
      manual: false
    })
    state = reduceUpdateState(state, {
      type: 'progress',
      version: '1.1.0',
      required: false,
      percent: -5,
      manual: false
    })
    expect(state).toMatchObject({ phase: 'downloading', percent: 0 })
    state = reduceUpdateState(state, {
      type: 'progress',
      version: '1.1.0',
      required: false,
      percent: 105,
      manual: false
    })
    expect(state).toMatchObject({ phase: 'downloading', percent: 100 })
    state = reduceUpdateState(state, {
      type: 'downloaded',
      version: '1.1.0',
      required: false,
      manual: false
    })
    state = reduceUpdateState(state, {
      type: 'installing',
      version: '1.1.0',
      required: false,
      manual: false
    })

    expect(state).toEqual({
      phase: 'installing',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      required: false,
      manual: false
    })
  })

  it('only exposes up-to-date state for a manual check', () => {
    const idle = initialUpdateStatus('1.0.0')
    const manual = reduceUpdateState(
      reduceUpdateState(idle, { type: 'check', manual: true }),
      { type: 'up-to-date' }
    )
    const automatic = reduceUpdateState(
      reduceUpdateState(idle, { type: 'check', manual: false }),
      { type: 'up-to-date' }
    )

    expect(manual).toEqual({ phase: 'up-to-date', currentVersion: '1.0.0', manual: true })
    expect(automatic).toEqual({ phase: 'idle', currentVersion: '1.0.0' })
  })

  it('preserves required update context when an operation fails', () => {
    const checking = reduceUpdateState(initialUpdateStatus('1.0.0'), {
      type: 'check',
      manual: false
    })
    const failed = reduceUpdateState(checking, {
      type: 'error',
      version: '2.0.0',
      required: true,
      message: 'offline',
      retryable: true,
      manual: false
    })

    expect(failed).toEqual({
      phase: 'error',
      currentVersion: '1.0.0',
      availableVersion: '2.0.0',
      required: true,
      message: 'offline',
      retryable: true,
      manual: false
    })
  })

  it('supports unsupported and reset transitions', () => {
    const unsupported = reduceUpdateState(
      reduceUpdateState(initialUpdateStatus('1.0.0'), { type: 'check', manual: true }),
      { type: 'unsupported', reason: 'development build', manual: true }
    )

    expect(unsupported).toMatchObject({ phase: 'unsupported', manual: true })
    expect(reduceUpdateState(unsupported, { type: 'reset' })).toEqual({
      phase: 'idle',
      currentVersion: '1.0.0'
    })
  })

  it('rejects missing versions and invalid transitions', () => {
    const checking = reduceUpdateState(initialUpdateStatus('1.0.0'), {
      type: 'check',
      manual: false
    })
    const missingVersion = {
      type: 'available',
      required: false,
      manual: false
    } as unknown as UpdateStateEvent

    expect(() => reduceUpdateState(checking, missingVersion)).toThrow('版本')
    expect(() => reduceUpdateState(initialUpdateStatus('1.0.0'), {
      type: 'downloaded',
      version: '1.1.0',
      required: false,
      manual: false
    })).toThrow('状态转换')
  })

  it('rejects stale events for another update', () => {
    const available = reduceUpdateState(
      reduceUpdateState(initialUpdateStatus('1.0.0'), { type: 'check', manual: false }),
      { type: 'available', version: '1.1.0', required: false, manual: false }
    )

    expect(() => reduceUpdateState(available, {
      type: 'progress',
      version: '1.2.0',
      required: false,
      percent: 20,
      manual: false
    })).toThrow('上下文')
  })

  it('rejects errors from another check or without the active update version', () => {
    const checking = reduceUpdateState(initialUpdateStatus('1.0.0'), {
      type: 'check',
      manual: true
    })
    expect(() => reduceUpdateState(checking, {
      type: 'error',
      required: false,
      message: 'offline',
      retryable: true,
      manual: false
    })).toThrow('上下文')

    const available = reduceUpdateState(checking, {
      type: 'available',
      version: '1.1.0',
      required: false,
      manual: true
    })
    expect(() => reduceUpdateState(available, {
      type: 'error',
      required: false,
      message: 'offline',
      retryable: true,
      manual: true
    })).toThrow('版本')
  })
})
