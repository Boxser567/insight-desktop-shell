import { randomUUID } from 'node:crypto'

export interface CanvasCredentialTransport {
  postMessage(message: Record<string, unknown>): void
  on(event: 'message', listener: (value: unknown) => void): unknown
  off(event: 'message', listener: (value: unknown) => void): unknown
}

class CanvasCredentialError extends Error {
  constructor(readonly code: 'AUTH' | 'TRANSPORT' | 'TIMEOUT') {
    super(code)
  }
}

/** The Host requests a fresh token over Main's private Harness process channel. */
export function createCanvasCredentialClient(transport: CanvasCredentialTransport) {
  let disposed = false
  let pending: {
    id: string
    promise: Promise<string>
    resolve(token: string): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  } | undefined

  function finish(error?: Error, token?: string): void {
    const request = pending
    if (!request) return
    pending = undefined
    clearTimeout(request.timer)
    if (error) request.reject(error)
    else request.resolve(token!)
  }

  const onMessage = (value: unknown): void => {
    if (!value || typeof value !== 'object' || !pending) return
    const response = value as Record<string, unknown>
    if (response.type !== 'insight:model-token:response' || response.id !== pending.id) return
    if (typeof response.token === 'string' && response.token.length > 0) finish(undefined, response.token)
    else finish(new CanvasCredentialError(response.error === 'LOGIN_REQUIRED' ? 'AUTH' : 'TRANSPORT'))
  }

  transport.on('message', onMessage)
  return {
    getToken(): Promise<string> {
      if (disposed) return Promise.reject(new CanvasCredentialError('AUTH'))
      if (pending) return pending.promise
      let resolve!: (token: string) => void
      let reject!: (error: Error) => void
      const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
      const id = randomUUID()
      const timer = setTimeout(() => finish(new CanvasCredentialError('TIMEOUT')), 35_000)
      pending = { id, promise, resolve, reject, timer }
      try { transport.postMessage({ type: 'insight:model-token:request', id }) }
      catch { finish(new CanvasCredentialError('TRANSPORT')) }
      return promise
    },
    dispose(): void {
      disposed = true
      transport.off('message', onMessage)
      finish(new CanvasCredentialError('AUTH'))
    }
  }
}

/** Electron utilityProcess and bundled Node expose different parent IPC surfaces. */
export function parentCanvasCredentialTransport(): CanvasCredentialTransport {
  const parentPort = (process as NodeJS.Process & { parentPort?: CanvasCredentialTransport }).parentPort
  if (parentPort) {
    const listeners = new Map<(value: unknown) => void, (event: unknown) => void>()
    return {
      postMessage: message => parentPort.postMessage(message),
      on: (_event, listener) => {
        const wrapped = (event: unknown) => listener((event as { data: unknown }).data)
        listeners.set(listener, wrapped)
        parentPort.on('message', wrapped)
      },
      off: (_event, listener) => {
        const wrapped = listeners.get(listener)
        if (wrapped) parentPort.off('message', wrapped)
        listeners.delete(listener)
      }
    }
  }
  return {
    postMessage: message => {
      if (!process.connected || !process.send) throw new Error('Parent IPC unavailable')
      process.send(message, undefined, undefined, () => {})
    },
    on: (_event, listener) => process.on('message', listener),
    off: (_event, listener) => process.off('message', listener)
  }
}
