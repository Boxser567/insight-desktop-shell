import { describe, expect, it, vi } from 'vitest'
import {
  AuthApiClient,
  AuthApiError,
  maskPhone
} from '../src/main/auth/auth-api-client'
import type { AuthEnvironmentConfig } from '../src/main/auth/auth-environment'

const environment: AuthEnvironmentConfig = {
  name: 'test',
  baseUrl: 'https://gapi-test.insight-aigc.com',
  partition: 'insight-auth-test'
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('desktop auth API client', () => {
  it.each([
    { name: 'SMS code', path: '/mobile/getSmsCode', method: 'POST',
      request: (client: AuthApiClient) => client.sendSmsCode('13800138000'), data: {} },
    { name: 'captcha', path: '/captcha/captchaImage', method: 'GET',
      request: (client: AuthApiClient) => client.captcha(), data: { uuid: 'captcha-uuid', img: 'image' } },
    { name: 'SMS login', path: '/loginV3', method: 'POST',
      request: (client: AuthApiClient) => client.loginSms({ phone: '13800138000', code: '123456' }),
      data: { accessToken: 'sms-token' } },
    { name: 'password login', path: '/loginV3', method: 'POST',
      request: (client: AuthApiClient) => client.loginPassword({
        phone: '13800138000', password: 'secret123', uuid: 'captcha-uuid', imageCode: 'abcd'
      }), data: { accessToken: 'password-token' } },
    { name: 'refresh', path: '/refresh', method: 'GET',
      request: (client: AuthApiClient) => client.refresh(), data: { accessToken: 'fresh-token' } },
    { name: 'current user', path: '/getUserDetail', method: 'GET',
      request: (client: AuthApiClient) => client.currentUser(), data: { id: 42 } },
    { name: 'logout', path: '/logout', method: 'GET',
      request: (client: AuthApiClient) => client.logout(), data: {} }
  ])('identifies $name requests as Desktop', async ({ path, method, request, data }) => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ code: 'SUCCESS', data }))
    const client = new AuthApiClient(fetch, environment, () => 'stored-token')

    await request(client)

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe(`${environment.baseUrl}/user-server${path}`)
    const init = fetch.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe(method)
    expect(init.credentials).toBe('include')
    const headers = new Headers(init.headers)
    expect(headers.get('extInfo')).toBe(JSON.stringify({ client_type: 'Desktop' }))
    expect(headers.get('token')).toBe('stored-token')
    expect(headers.get('accept-language')).toBe('zh_CN')
  })

  it('sends the existing SMS request body and accepts an empty success payload', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ code: 'SUCCESS', msg: '', data: {} }))
    const client = new AuthApiClient(fetch, environment, () => undefined)

    await expect(client.sendSmsCode('13800138000')).resolves.toBeUndefined()

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      scene: 'LOGIN', phoneNumber: '13800138000'
    })
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers)
    expect(headers.get('extInfo')).toBe(JSON.stringify({ client_type: 'Desktop' }))
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.has('token')).toBe(false)
  })

  it.each([
    { name: 'SMS code', request: (client: AuthApiClient) => client.sendSmsCode('13800138000') },
    { name: 'SMS login', request: (client: AuthApiClient) => client.loginSms({ phone: '13800138000', code: '123456' }) }
  ])('preserves the whitelist rejection for $name even with HTTP 200', async ({ request }) => {
    const message = '您暂无权限使用此产品，请联系平台管理员方正东'
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      code: 'NOT_IN_WHITELIST', msg: message, data: null
    }))
    const client = new AuthApiClient(fetch, environment, () => undefined)

    await expect(request(client)).rejects.toMatchObject({
      name: 'AuthApiError', kind: 'rejected', code: 'NOT_IN_WHITELIST', message
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('logs a transport code without leaking error text or credentials', async () => {
    const diagnostic = vi.fn()
    const failure = new Error('net::ERR_CONNECTION_RESET https://host/?token=secret password=private')
    const client = new AuthApiClient(vi.fn().mockRejectedValue(failure), environment, () => 'stored-secret', diagnostic)
    await expect(client.currentUser()).rejects.toBeInstanceOf(AuthApiError)
    const message = diagnostic.mock.calls[0]?.[0] as string
    expect(message).toContain('ERR_CONNECTION_RESET')
    expect(message).toContain('gapi-test.insight-aigc.com')
    expect(message).not.toMatch(/secret|private|password|token=/u)
  })
  it('bounds authentication requests and treats a timeout as offline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      const fetch = vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError'))
      const client = new AuthApiClient(fetch, environment, () => 'stored-token')
      await expect(client.currentUser()).rejects.toMatchObject({ kind: 'offline' })
      expect(timeout).toHaveBeenCalledWith(10_000)
      expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    } finally { timeout.mockRestore() }
  })

  it('builds the existing SMS and password login payloads', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'SUCCESS', data: { accessToken: 'sms-token' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 'SUCCESS', body: { accessToken: 'password-token' } }))
    const client = new AuthApiClient(fetch, environment, () => undefined)

    await expect(
      client.loginSms({ phone: '13800138000', code: '123456' })
    ).resolves.toEqual({ accessToken: 'sms-token' })
    await expect(
      client.loginPassword({
        phone: '13800138000',
        password: 'secret123',
        uuid: 'captcha-uuid',
        imageCode: 'abcd'
      })
    ).resolves.toEqual({ accessToken: 'password-token' })

    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://gapi-test.insight-aigc.com/user-server/loginV3'
    )
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      type: 'PHONE_NUM',
      info: { phoneNo: '13800138000', code: '123456' }
    })
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      type: 'PHONE_PASS',
      info: {
        phoneNo: '13800138000',
        password: 'secret123',
        uuid: 'captcha-uuid',
        imgCode: 'abcd'
      }
    })
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('extinfo')).toBe(
      JSON.stringify({ client_type: 'Desktop' })
    )
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe('include')
  })

  it('projects user data without exposing the stable id or token', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 'SUCCESS',
        data: {
          id: 42,
          userName: 'Alice',
          avatarUrl: 'https://assets.example/a.png',
          phoneNo: '13800138000',
          accessToken: 'must-not-leak'
        }
      })
    )
    const client = new AuthApiClient(fetch, environment, () => 'stored-token')

    const account = await client.currentUser()

    expect(account).toEqual({
      id: '42',
      summary: {
        displayName: 'Alice',
        avatarUrl: 'https://assets.example/a.png',
        maskedPhone: '138****8000'
      }
    })
    expect(JSON.stringify(account.summary)).not.toContain('42')
    expect(JSON.stringify(account.summary)).not.toContain('must-not-leak')
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('token')).toBe(
      'stored-token'
    )
  })

  it('distinguishes an expired session from a network failure', async () => {
    const expired = new AuthApiClient(
      vi.fn().mockResolvedValue(
        jsonResponse({ code: 'USER_SESSION_EXPIRED', msg: 'expired' })
      ),
      environment,
      () => 'stored-token'
    )
    const offline = new AuthApiClient(
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
      environment,
      () => 'stored-token'
    )

    await expect(expired.currentUser()).rejects.toMatchObject({
      kind: 'expired'
    } satisfies Partial<AuthApiError>)
    await expect(offline.currentUser()).rejects.toMatchObject({
      kind: 'offline'
    } satisfies Partial<AuthApiError>)
  })

  it('masks phone numbers without exposing unsupported input', () => {
    expect(maskPhone('13800138000')).toBe('138****8000')
    expect(maskPhone('')).toBe('')
    expect(maskPhone('1234')).toBe('****')
  })
})
