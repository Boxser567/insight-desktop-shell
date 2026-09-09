import { randomUUID } from 'node:crypto'

export interface ModelCredentialTransport {
  postMessage(message: Record<string, unknown>): void
  on(event: 'message', listener: (value: unknown) => void): unknown
  off(event: 'message', listener: (value: unknown) => void): unknown
}

/** Access tokens are requested for a model operation and never persisted by the Host. */
export function createModelCredentialClient(transport: ModelCredentialTransport) {
  let disposed = false
  let pending: { id: string; promise: Promise<string>; resolve(token: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | undefined
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
    else finish(new Error(response.error === 'LOGIN_REQUIRED'
      ? '登录已失效，请重新登录后继续会话。'
      : '暂时无法验证登录，请检查网络后重试。'))
  }
  transport.on('message', onMessage)
  return {
    getToken(): Promise<string> {
      if (disposed) return Promise.reject(new Error('登录通道已关闭，请重新打开客户端。'))
      if (pending) return pending.promise
      let resolve!: (token: string) => void
      let reject!: (error: Error) => void
      const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
      const id = randomUUID()
      const timer = setTimeout(() => finish(new Error('登录校验超时，请检查网络后重试。')), 35_000)
      pending = { id, promise, resolve, reject, timer }
      try { transport.postMessage({ type: 'insight:model-token:request', id }) }
      catch { finish(new Error('登录通道不可用，请重新打开客户端。')) }
      return promise
    },
    dispose(): void {
      disposed = true
      transport.off('message', onMessage)
      finish(new Error('登录通道已关闭，请重新打开客户端。'))
    }
  }
}

/** Electron utilityProcess and bundled Node expose different native IPC surfaces. */
export function parentCredentialTransport(): ModelCredentialTransport {
  const parentPort = (process as NodeJS.Process & { parentPort?: ModelCredentialTransport }).parentPort
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
