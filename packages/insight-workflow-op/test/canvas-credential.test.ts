import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createCanvasCredentialClient, parentCanvasCredentialTransport } from '../src/canvas-credential'

function replaceProcessProperty(name: string, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(process, name)
  Object.defineProperty(process, name, { configurable: true, value })
  return () => {
    if (original) Object.defineProperty(process, name, original)
    else Reflect.deleteProperty(process, name)
  }
}

describe('canvas credential channel', () => {
  it('shares one pending token request and rejects it on disposal', async () => {
    const events = new EventEmitter()
    const posted: Record<string, unknown>[] = []
    const client = createCanvasCredentialClient({
      postMessage: message => { posted.push(message) },
      on: (_event, listener) => events.on('message', listener),
      off: (_event, listener) => events.off('message', listener)
    })
    const first = client.getToken()
    const second = client.getToken()
    expect(second).toBe(first)
    expect(posted).toHaveLength(1)
    client.dispose()
    await expect(first).rejects.toMatchObject({ code: 'AUTH' })
    expect(events.listenerCount('message')).toBe(0)
  })

  it('times out a token request that receives no parent response', async () => {
    vi.useFakeTimers()
    const events = new EventEmitter()
    const client = createCanvasCredentialClient({
      postMessage: () => {},
      on: (_event, listener) => events.on('message', listener),
      off: (_event, listener) => events.off('message', listener)
    })
    try {
      const pending = expect(client.getToken()).rejects.toMatchObject({ code: 'TIMEOUT' })
      await vi.advanceTimersByTimeAsync(35_000)
      await pending
    } finally {
      client.dispose()
      vi.useRealTimers()
    }
  })

  it('unwraps Electron parentPort message data', () => {
    const port = new EventEmitter() as EventEmitter & { postMessage: ReturnType<typeof vi.fn> }
    port.postMessage = vi.fn()
    const restore = replaceProcessProperty('parentPort', port)
    try {
      const transport = parentCanvasCredentialTransport()
      const listener = vi.fn()
      transport.on('message', listener)
      transport.postMessage({ type: 'request' })
      port.emit('message', { data: { type: 'response' } })
      expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'request' })
      expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'response' })
      transport.off('message', listener)
      expect(port.listenerCount('message')).toBe(0)
    } finally { restore() }
  })

  it('uses the bundled Node parent IPC surface', () => {
    const restorePort = replaceProcessProperty('parentPort', undefined)
    const restoreConnected = replaceProcessProperty('connected', true)
    const send = vi.fn()
    const restoreSend = replaceProcessProperty('send', send)
    try {
      const transport = parentCanvasCredentialTransport()
      const listener = vi.fn()
      transport.on('message', listener)
      transport.postMessage({ type: 'request' })
      const parentEvents = process as unknown as EventEmitter
      parentEvents.emit('message', { type: 'response' })
      expect(send).toHaveBeenCalledOnce()
      expect(send.mock.calls[0]?.[0]).toEqual({ type: 'request' })
      expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'response' })
      transport.off('message', listener)
    } finally {
      restoreSend()
      restoreConnected()
      restorePort()
    }
  })
})
