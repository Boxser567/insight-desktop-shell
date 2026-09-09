import type { EventEmitter } from 'node:events'
import { AuthApiError } from '../auth/auth-api-client'

interface ModelCredentialPeer extends EventEmitter {
  postMessage?(message: Record<string, unknown>): void
  send?(message: Record<string, unknown>, callback: (error: Error | null) => void): boolean
}

/** Only the private parent/child channel can request credentials; no HTTP or renderer route. */
export function bindModelCredentialBridge(
  peer: ModelCredentialPeer,
  resolveToken: () => Promise<string>,
  isCurrent: () => boolean
): () => void {
  const pending = new Set<string>()
  let disposed = false
  const send = (message: Record<string, unknown>): void => {
    if (disposed || !isCurrent()) return
    try {
      if (peer.postMessage) peer.postMessage(message)
      else peer.send?.(message, () => {})
    } catch { /* the child may exit while credentials are being checked */ }
  }
  const onMessage = (value: unknown): void => {
    if (disposed || !isCurrent() || !value || typeof value !== 'object') return
    const { type, id } = value as Record<string, unknown>
    if (type !== 'insight:model-token:request' || typeof id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(id) || pending.has(id) || pending.size >= 16) return
    pending.add(id)
    void (async () => {
      try {
        const token = await resolveToken()
        send({ type: 'insight:model-token:response', id, token })
      } catch (error) {
        send({ type: 'insight:model-token:response', id, error:
          error instanceof AuthApiError && error.kind === 'expired' ? 'LOGIN_REQUIRED' : 'SERVICE_UNAVAILABLE' })
      } finally { pending.delete(id) }
    })()
  }
  peer.on('message', onMessage)
  return () => { disposed = true; peer.off('message', onMessage) }
}
