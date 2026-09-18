import { describe, expect, it, vi } from 'vitest'
import { createSkillProxyRequest, SkillProxyError } from '../packages/insight-desktop-integration/src/skill-proxy-http'

const base = 'https://gapi-test.insight-aigc.com/insight-harness-service'
const path = '/api/skill-proxy/media-generator'
const success = () => new Response('{"type":"result","status":200,"body":{}}\n', { headers: { 'content-type': 'application/x-ndjson' } })

describe('skill proxy authenticated transport', () => {
  it('obtains current credentials, replaces caller headers and never caches or retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => success())
    const tokens = vi.fn().mockResolvedValueOnce('first-token').mockResolvedValueOnce('second-token')
    const call = createSkillProxyRequest(base, tokens, fetcher)
    const controller = new AbortController()
    const options = { method: 'POST', body: '{}', signal: controller.signal,
      headers: { authorization: 'local-capability', cookie: 'must-not-forward' } }
    await call(path, options)
    await call(path, options)
    expect(tokens).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
    const [url, init] = fetcher.mock.calls[1]!
    expect(url).toBe(base + path)
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBe(controller.signal)
    expect(init?.body).toBe('{}')
    const headers = new Headers(init?.headers)
    expect(headers.get('token')).toBe('second-token')
    expect(headers.get('authorization')).toBe('Bearer second-token')
    expect(headers.has('cookie')).toBe(false)
    expect(JSON.stringify(init)).not.toContain('local-capability')
  })

  it.each([
    [401, '{"message":"private details"}', 401, 'LOGIN_REQUIRED'],
    [200, '{"code":"USER_NOT_LOGIN"}', 401, 'LOGIN_REQUIRED'],
    [503, '{"detail":{"code":"SKILL_PROXY_CREDENTIAL_MISSING"}}', 503, 'SKILL_PROXY_CREDENTIAL_MISSING'],
    [200, '<html>private details</html>', 502, 'SKILL_PROXY_PROTOCOL_MISMATCH'],
    [502, 'x'.repeat(20000), 502, 'SKILL_PROXY_FAILED'],
  ])('handles HTTP %s safely', async (status, body, expected, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }))
    const call = createSkillProxyRequest(base, async () => 'test-token', fetcher)
    await expect(call(path, { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: expected, code })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each(['LOGIN_REQUIRED', 'SERVICE_UNAVAILABLE'])('fails closed before sending when auth is %s', async code => {
    const fetcher = vi.fn<typeof fetch>()
    const call = createSkillProxyRequest(base, async () => { throw Object.assign(new Error('secret'), { code }) }, fetcher)
    await expect(call(path, { method: 'POST' })).rejects.toMatchObject({ status: code === 'LOGIN_REQUIRED' ? 401 : 503 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects arbitrary service URLs and paths', async () => {
    expect(() => createSkillProxyRequest('http://insecure.test', async () => 'token')).toThrow()
    const fetcher = vi.fn<typeof fetch>()
    const call = createSkillProxyRequest(base, async () => 'token', fetcher)
    for (const route of ['https://evil.test', '/api/skill-proxy/../admin', '/api/skill-proxy/tikhub?url=evil']) {
      await expect(call(route, { method: 'POST' })).rejects.toBeInstanceOf(SkillProxyError)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
})
