import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { bindModelCredentialBridge } from '../src/main/runtime/model-credential-bridge'

function child() { return Object.assign(new EventEmitter(), { postMessage: vi.fn() }) }
const request = { type: 'insight:model-token:request', id: 'test-1' }

describe('Main model credential channel', () => {
  it('responds only to a valid request from the active process', async () => {
    const peer = child()
    const resolveToken = vi.fn().mockResolvedValue('private-token')
    const dispose = bindModelCredentialBridge(peer, resolveToken, () => true)
    peer.emit('message', { ...request, id: null })
    peer.emit('message', { ...request, type: 'arbitrary' })
    expect(resolveToken).not.toHaveBeenCalled()
    peer.emit('message', request)
    await vi.waitFor(() => expect(peer.postMessage).toHaveBeenCalledWith({
      type: 'insight:model-token:response', id: 'test-1', token: 'private-token'
    }))
    dispose()
    expect(peer.listenerCount('message')).toBe(0)
  })

  it('does not return credentials to a replaced process', async () => {
    const peer = child()
    let current = true
    let finish!: (value: string) => void
    bindModelCredentialBridge(peer, () => new Promise(resolve => { finish = resolve }), () => current)
    peer.emit('message', request)
    current = false
    finish('obsolete-token')
    await new Promise(resolve => setImmediate(resolve))
    expect(peer.postMessage).not.toHaveBeenCalled()
  })

  it('redacts failure details and tolerates a disconnected channel', async () => {
    const peer = child()
    bindModelCredentialBridge(peer, async () => { throw new Error('private-secret') }, () => true)
    peer.emit('message', request)
    await vi.waitFor(() => expect(peer.postMessage).toHaveBeenCalledWith({
      type: 'insight:model-token:response', id: 'test-1', error: 'SERVICE_UNAVAILABLE'
    }))
    peer.postMessage.mockImplementation(() => { throw new Error('closed') })
    peer.emit('message', request)
    await new Promise(resolve => setImmediate(resolve))
  })
})
