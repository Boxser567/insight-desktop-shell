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
  partition: 'persist:insight-auth-test'
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('desktop auth API client', () => {
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
      JSON.stringify({ client_type: 'PC' })
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
