import { describe, expect, it, vi } from 'vitest'
import {
  HarnessWorkspaceView,
  type HarnessViewHost,
  type HarnessViewInstance
} from '../src/main/workspace/harness-workspace-view'

function harnessView(order: string[] = []): HarnessViewInstance {
  const mainFrame = {}
  return {
    webContents: {
      mainFrame,
      loadURL: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      close: vi.fn(() => order.push('close'))
    },
    setBounds: vi.fn(),
    setVisible: vi.fn((visible: boolean) => order.push(`visible:${visible}`))
  }
}

function host(view: HarnessViewInstance, order: string[] = []): HarnessViewHost {
  return {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
    contentView: {
      addChildView: vi.fn(() => order.push('add')),
      removeChildView: vi.fn(() => order.push('remove'))
    },
    createHarnessView: vi.fn(() => view)
  }
}

describe('Harness workspace view', () => {
  it('loads only a loopback Harness URL', async () => {
    const view = harnessView()
    const workspace = new HarnessWorkspaceView(() => host(view))

    await expect(workspace.open('https://example.com')).rejects.toThrow('loopback')
    workspace.setScope('a'.repeat(32))
    await workspace.open('http://127.0.0.1:43127')

    expect(view.webContents.loadURL).toHaveBeenCalledWith('http://127.0.0.1:43127')
  })

  it('clips renderer bounds to the host content area', async () => {
    const view = harnessView()
    const workspace = new HarnessWorkspaceView(() => host(view))
    workspace.setBounds({ x: 190, y: -20, width: 1200, height: 900 })
    workspace.setScope('a'.repeat(32))

    await workspace.open('http://localhost:43127')

    expect(view.setBounds).toHaveBeenCalledWith({ x: 190, y: 0, width: 810, height: 700 })
  })

  it('rejects invalid renderer dimensions', () => {
    const workspace = new HarnessWorkspaceView(() => host(harnessView()))

    expect(() => workspace.setBounds({ x: 0, y: 0, width: -1, height: 20 })).toThrow(
      'cannot be negative'
    )
    expect(() => workspace.setBounds({ x: 0, y: 0, width: Number.NaN, height: 20 })).toThrow(
      'finite'
    )
  })

  it('hides and removes the view before closing its contents', async () => {
    const order: string[] = []
    const view = harnessView(order)
    const desktop = host(view, order)
    const workspace = new HarnessWorkspaceView(() => desktop)
    workspace.setScope('a'.repeat(32))
    await workspace.open('http://127.0.0.1:43127')

    order.length = 0
    await workspace.close()

    expect(order).toEqual(['visible:false', 'remove', 'close'])
  })

  it('recognizes only its current main frame as a trusted sender', async () => {
    const view = harnessView()
    const workspace = new HarnessWorkspaceView(() => host(view))
    workspace.setScope('a'.repeat(32))
    await workspace.open('http://127.0.0.1:43127')

    expect(workspace.isTrustedSender(view.webContents, view.webContents.mainFrame)).toBe(true)
    expect(workspace.isTrustedSender(view.webContents, {})).toBe(false)
    expect(workspace.isTrustedSender({}, view.webContents.mainFrame)).toBe(false)
  })

  it('requires a validated account scope for the view partition', async () => {
    const view = harnessView()
    const desktop = host(view)
    const workspace = new HarnessWorkspaceView(() => desktop)

    expect(() => workspace.setScope('user-42')).toThrow('scope')
    await expect(workspace.open('http://127.0.0.1:43127')).rejects.toThrow('account scope')
    workspace.setScope('b'.repeat(32))
    await workspace.open('http://127.0.0.1:43127')

    expect(desktop.createHarnessView).toHaveBeenCalledWith('b'.repeat(32))
  })
})
