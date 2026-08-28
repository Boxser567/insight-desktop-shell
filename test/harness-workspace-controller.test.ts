import { describe, expect, it, vi } from 'vitest'
import { HarnessWorkspaceController } from '../src/main/workspace/harness-workspace-controller'

const account = {
  scope: 'a'.repeat(32),
  dshHome: '/data/accounts/alice/harness'
}

function fixture(order: string[] = []) {
  const runtime = {
    configureDshHome: vi.fn((dshHome: string) => order.push(`home:${dshHome}`)),
    stop: vi.fn(async () => {
      order.push('stop-runtime')
    })
  }
  const view = {
    setScope: vi.fn(),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(async () => {
      order.push('close-view')
    }),
    isTrustedSender: vi.fn().mockReturnValue(false)
  }
  const launch = vi.fn(async (selected: typeof account) => {
    order.push(`launch:${selected.scope}`)
  })
  return { runtime, view, launch, controller: new HarnessWorkspaceController(runtime, view, launch) }
}

describe('Harness workspace controller', () => {
  it('configures the account directory before launching Harness', async () => {
    const order: string[] = []
    const { controller } = fixture(order)

    await controller.start(account)

    expect(order).toEqual([
      `home:${account.dshHome}`,
      `launch:${account.scope}`
    ])
  })

  it('destroys the Harness view before stopping the runtime', async () => {
    const order: string[] = []
    const { controller } = fixture(order)
    await controller.start(account)
    order.length = 0

    await controller.stop()

    expect(order).toEqual(['close-view', 'stop-runtime'])
    expect(controller.currentDshHome()).toBeUndefined()
  })

  it('refuses to expose a Harness URL before authentication', async () => {
    const { controller } = fixture()

    await expect(controller.open('http://127.0.0.1:43127')).rejects.toThrow(
      'authenticated workspace'
    )
  })
})
