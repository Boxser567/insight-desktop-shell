import { ModelCredentialError } from './model-credential-client'

/** Authenticated backend transport. Never replay a possibly charged operation. */
export class SkillProxyError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}

export type SkillProxyRequest = (path: string, init: RequestInit) => Promise<Response>

/** Consume only a bounded, non-streaming error envelope; never echo upstream text. */
export async function proxyErrorCode(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader()
  if (!reader) return undefined
  try {
    let size = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 16384) return undefined
      chunks.push(next.value)
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const code = value?.code ?? value?.error?.code ?? value?.detail?.code
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(code) ? code : undefined
  } catch { return undefined }
  finally { await reader.cancel().catch(() => undefined) }
}

export function createSkillProxyRequest(
  baseUrl: string,
  resolveToken: () => Promise<string>,
  fetchRequest: typeof fetch = fetch
): SkillProxyRequest {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('Invalid skill proxy service URL')
  }
  return async (path, init) => {
    if (!/^\/api\/skill-proxy\/[a-z][a-z0-9-]{0,63}$/.test(path) || init.method !== 'POST') {
      throw new SkillProxyError(400, 'INVALID_PROXY_REQUEST')
    }
    let token: string
    try { token = await resolveToken() }
    catch (error) {
      const expired = error instanceof ModelCredentialError
        ? error.code === 'AUTH'
        : error instanceof Error && 'code' in error && (error.code === 'LOGIN_REQUIRED' || error.code === 'AUTH')
      throw new SkillProxyError(expired ? 401 : 503, expired ? 'LOGIN_REQUIRED' : 'SKILL_PROXY_AUTH_UNAVAILABLE')
    }
    if (!token) throw new SkillProxyError(401, 'LOGIN_REQUIRED')
    const response = await fetchRequest(baseUrl.replace(/\/$/, '') + path, {
      method: 'POST', body: init.body, signal: init.signal, redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson',
        token, authorization: `Bearer ${token}` }
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
      const code = await proxyErrorCode(response)
      if (response.status === 401 || code === 'USER_NOT_LOGIN' || code === 'LOGIN_REQUIRED') {
        throw new SkillProxyError(401, 'LOGIN_REQUIRED')
      }
      const safe = code && /^(SKILL_|INVALID_|CLIENT_|MEDIA_|MESSAGES_|SIGNED_)[A-Z0-9_]{1,70}$/.test(code)
      throw new SkillProxyError(response.ok ? 502 : response.status,
        safe ? code : response.ok ? 'SKILL_PROXY_PROTOCOL_MISMATCH' : 'SKILL_PROXY_FAILED')
    }
    return response
  }
}
