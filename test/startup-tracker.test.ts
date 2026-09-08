import { describe, expect, it, vi } from 'vitest'
import { StartupTracker } from '../src/main/startup/startup-tracker'

describe('StartupTracker', () => {
  it('records ordered phases with monotonic elapsed time', () => {
    let now = 100
    const log = vi.fn()
    const tracker = new StartupTracker({ now: () => now, log })

    expect(tracker.current()).toEqual({
      phase: 'restoring-session',
      detail: '正在安全恢复登录状态…',
      elapsedMs: 0
    })

    now = 145.4
    tracker.transition('preparing-profile', '正在准备本地运行环境…')
    now = 210.9
    tracker.transition('repairing-profile', '正在检查插件与依赖…')

    expect(tracker.current()).toEqual({
      phase: 'repairing-profile',
      detail: '正在检查插件与依赖…',
      elapsedMs: 111
    })
    expect(log).toHaveBeenLastCalledWith(
      '[desktop] startup phase repairing-profile at 111ms: 正在检查插件与依赖…'
    )
  })

  it('publishes updates and releases subscriptions', () => {
    let now = 0
    const tracker = new StartupTracker({ now: () => now })
    const listener = vi.fn()
    const unsubscribe = tracker.subscribe(listener)

    now = 10
    tracker.transition('preparing-profile', '正在准备本地运行环境…')
    unsubscribe()
    now = 20
    tracker.transition('repairing-profile', '正在检查插件与依赖…')

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'preparing-profile',
      elapsedMs: 10
    }))
  })

  it('rejects a phase regression within one launch', () => {
    const tracker = new StartupTracker({ now: () => 0 })
    tracker.transition('preparing-profile', '正在准备本地运行环境…')
    tracker.transition('repairing-profile', '正在检查插件与依赖…')

    expect(() => {
      tracker.transition('preparing-profile', '不允许倒退')
    }).toThrow('cannot move backward')
  })

  it('starts a fresh ordered launch after a restart', () => {
    let now = 0
    const tracker = new StartupTracker({ now: () => now })
    tracker.transition('ready', 'Harness 界面已显示')

    now = 500
    tracker.reset('正在重新启动…')
    now = 525
    tracker.transition('preparing-profile', '正在准备本地运行环境…')

    expect(tracker.current()).toEqual({
      phase: 'preparing-profile',
      detail: '正在准备本地运行环境…',
      elapsedMs: 25
    })
  })
})
