import { describe, expect, it, vi } from 'vitest'
import type { SessionView } from '../src/shared/auth-contracts'
import {
  WorkspaceLifecycle,
  type WorkspaceAccount,
  type WorkspaceDriver
} from '../src/main/workspace/workspace-lifecycle'

const alice: WorkspaceAccount = {
  scope: 'a'.repeat(32),
  dshHome: '/data/accounts/alice/harness'
}
const bob: WorkspaceAccount = {
  scope: 'b'.repeat(32),
  dshHome: '/data/accounts/bob/harness'
}
const authenticated: SessionView = {
  kind: 'authenticated',
  account: { displayName: 'Alice', maskedPhone: '138****8000' }
}

function driver(): WorkspaceDriver {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined)
  }
}

describe('authenticated workspace lifecycle', () => {
  it('never starts for restoring, offline or expired states', async () => {
    const runtime = driver()
    const lifecycle = new WorkspaceLifecycle(runtime)

    await lifecycle.apply({ kind: 'restoring' })
    await lifecycle.apply({ kind: 'offline' })
    await lifecycle.apply({ kind: 'expired' })

    expect(runtime.start).not.toHaveBeenCalled()
    expect(runtime.stop).not.toHaveBeenCalled()
  })

  it('starts once for repeated authenticated events from the same account', async () => {
    const runtime = driver()
    const lifecycle = new WorkspaceLifecycle(runtime)

    await lifecycle.apply(authenticated, alice)
    await lifecycle.apply(authenticated, alice)

    expect(runtime.start).toHaveBeenCalledOnce()
    expect(runtime.start).toHaveBeenCalledWith(alice)
  })

  it('stops the active account before starting another account', async () => {
    const order: string[] = []
    const runtime: WorkspaceDriver = {
      start: vi.fn(async (account) => {
        order.push(`start:${account.scope}`)
      }),
      stop: vi.fn(async () => {
        order.push('stop')
      })
    }
    const lifecycle = new WorkspaceLifecycle(runtime)

    await lifecycle.apply(authenticated, alice)
    await lifecycle.apply(authenticated, bob)

    expect(order).toEqual([`start:${alice.scope}`, 'stop', `start:${bob.scope}`])
  })

  it('stops a start that became stale while it was in flight', async () => {
    let finishStart: (() => void) | undefined
    const runtime: WorkspaceDriver = {
      start: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishStart = resolve
          })
      ),
      stop: vi.fn().mockResolvedValue(undefined)
    }
    const lifecycle = new WorkspaceLifecycle(runtime)

    const start = lifecycle.apply(authenticated, alice)
    await Promise.resolve()
    const revoke = lifecycle.apply({ kind: 'unauthenticated' })
    expect(finishStart).toBeTypeOf('function')
    finishStart?.()
    await Promise.all([start, revoke])

    expect(runtime.stop).toHaveBeenCalled()
    expect(lifecycle.activeScope()).toBeUndefined()
  })

  it('queues an explicit stop behind an in-flight start and stops only once', async () => {
    let finishStart: (() => void) | undefined
    const order: string[] = []
    const runtime: WorkspaceDriver = {
      start: vi.fn(() => new Promise<void>((resolve) => {
        order.push('start')
        finishStart = resolve
      })),
      stop: vi.fn(async () => {
        order.push('stop')
      })
    }
    const lifecycle = new WorkspaceLifecycle(runtime)

    const start = lifecycle.apply(authenticated, alice)
    await Promise.resolve()
    const stop = lifecycle.stop()
    finishStart?.()
    await Promise.all([start, stop])

    expect(order).toEqual(['start', 'stop'])
    expect(lifecycle.activeScope()).toBeUndefined()
  })

  it('prevents a queued account switch from starting after an explicit stop', async () => {
    const runtime = driver()
    const lifecycle = new WorkspaceLifecycle(runtime)
    await lifecycle.apply(authenticated, alice)

    const switchAccount = lifecycle.apply(authenticated, bob)
    const stop = lifecycle.stop()
    await Promise.all([switchAccount, stop])

    expect(runtime.start).toHaveBeenCalledTimes(1)
    expect(runtime.stop).toHaveBeenCalledOnce()
    expect(lifecycle.activeScope()).toBeUndefined()
  })

  it('clears the active scope even when the driver cannot stop cleanly', async () => {
    const runtime = driver()
    vi.mocked(runtime.stop).mockRejectedValueOnce(new Error('stop failed'))
    const lifecycle = new WorkspaceLifecycle(runtime)
    await lifecycle.apply(authenticated, alice)

    await expect(lifecycle.stop()).rejects.toThrow('stop failed')

    expect(runtime.stop).toHaveBeenCalledOnce()
    expect(lifecycle.activeScope()).toBeUndefined()
  })

  it('rejects an authenticated view without a Main-owned account scope', async () => {
    const lifecycle = new WorkspaceLifecycle(driver())

    await expect(lifecycle.apply(authenticated)).rejects.toThrow('workspace account')
  })
})
