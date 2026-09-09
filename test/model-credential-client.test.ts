import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createModelCredentialClient } from '../packages/insight-desktop-integration/src/model-credential-client'

function transport() { return Object.assign(new EventEmitter(), { postMessage: vi.fn() }) }

describe('Host model credential client', () => {
  it('correlates replies, shares pending requests and does not cache tokens', async () => {
    const peer = transport()
    const client = createModelCredentialClient(peer)
    const first = client.getToken()
    const second = client.getToken()
    const request = peer.postMessage.mock.calls[0]![0]
    expect(peer.postMessage).toHaveBeenCalledOnce()
    peer.emit('message', { type: 'wrong', id: request.id, token: 'bad' })
    peer.emit('message', { type: 'insight:model-token:response', id: request.id, token: 'access-token' })
    expect(await first).toBe('access-token')
    expect(await second).toBe('access-token')
    const third = client.getToken()
    const rejected = expect(third).rejects.toThrow('登录')
    client.dispose()
    await rejected
    expect(peer.postMessage).toHaveBeenCalledTimes(2)
    expect(peer.listenerCount('message')).toBe(0)
  })

  it('reports timeout without leaking raw response or secret data', async () => {
    vi.useFakeTimers()
    try {
      const peer = transport()
      const client = createModelCredentialClient(peer)
      const pending = client.getToken()
      const failed = expect(pending).rejects.toThrow('超时')
      await vi.advanceTimersByTimeAsync(35_000)
      await failed
      client.dispose()
    } finally { vi.useRealTimers() }
  })
})
