import { describe, expect, it, vi } from 'vitest'
import { AuthApiError, type AuthenticatedAccount } from '../src/main/auth/auth-api-client'
import {
  AuthSessionManager,
  type AuthSessionApi,
  type CredentialPersistence
} from '../src/main/auth/auth-session-manager'

const account: AuthenticatedAccount = {
  id: '42',
  summary: {
    displayName: 'Alice',
    avatarUrl: 'https://assets.example/a.png',
    maskedPhone: '138****8000'
  }
}

function api(overrides: Partial<AuthSessionApi> = {}): AuthSessionApi {
  return {
    sendSmsCode: vi.fn().mockResolvedValue(undefined),
    captcha: vi.fn().mockResolvedValue({ uuid: 'u', image: 'data:image/png;base64,a' }),
    loginSms: vi.fn().mockResolvedValue({ accessToken: 'sms-token' }),
    loginPassword: vi.fn().mockResolvedValue({ accessToken: 'password-token' }),
    refresh: vi.fn().mockResolvedValue({ accessToken: 'fresh-token' }),
    currentUser: vi.fn().mockResolvedValue(account),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

function persistence(token: string | undefined = 'stored-token'): CredentialPersistence {
  return {
    load: vi.fn().mockResolvedValue(token),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined)
  }
}

describe('desktop auth session manager', () => {
  it('refreshes once before accepting an expired stored token', async () => {
    const service = api({
      currentUser: vi
        .fn()
        .mockRejectedValueOnce(new AuthApiError('expired', 'expired'))
        .mockResolvedValueOnce(account)
    })
    const store = persistence()
    const tokens: Array<string | undefined> = []
    const manager = new AuthSessionManager(service, store, (token) => tokens.push(token))

    await manager.restore()

    expect(service.refresh).toHaveBeenCalledTimes(1)
    expect(service.currentUser).toHaveBeenCalledTimes(2)
    expect(store.save).toHaveBeenCalledWith('fresh-token')
    expect(tokens).toEqual(['stored-token', 'fresh-token'])
    expect(manager.current()).toEqual({ kind: 'authenticated', account: account.summary })
    expect(manager.activeAccount()).toEqual(account)
  })

  it('keeps credentials and reports offline without exposing an account', async () => {
    const service = api({
      currentUser: vi.fn().mockRejectedValue(new AuthApiError('offline', 'offline'))
    })
    const store = persistence()
    const manager = new AuthSessionManager(service, store, () => {})

    await manager.restore()

    expect(store.clear).not.toHaveBeenCalled()
    expect(manager.current()).toEqual({ kind: 'offline' })
    expect(manager.activeAccount()).toBeUndefined()
  })

  it('shares one in-flight restore operation', async () => {
    let resolveUser: ((value: AuthenticatedAccount) => void) | undefined
    const pendingUser = new Promise<AuthenticatedAccount>((resolve) => {
      resolveUser = resolve
    })
    const service = api({ currentUser: vi.fn().mockReturnValue(pendingUser) })
    const manager = new AuthSessionManager(service, persistence(), () => {})

    const first = manager.restore()
    const second = manager.restore()
    resolveUser?.(account)
    await Promise.all([first, second])

    expect(service.currentUser).toHaveBeenCalledTimes(1)
  })

  it('publishes the safe login sequence and never includes internal identity', async () => {
    const store = persistence(undefined)
    const manager = new AuthSessionManager(api(), store, () => {})
    const events = [manager.current()]
    manager.subscribe((view) => events.push(view))

    await manager.loginSms({ phone: '13800138000', code: '123456' })

    expect(events).toEqual([
      { kind: 'unauthenticated' },
      { kind: 'authenticating', method: 'sms' },
      { kind: 'authenticated', account: account.summary }
    ])
    expect(JSON.stringify(manager.current())).not.toContain(account.id)
    expect(JSON.stringify(manager.current())).not.toContain('sms-token')
  })

  it('revokes local state even when remote logout fails', async () => {
    const service = api({
      logout: vi.fn().mockRejectedValue(new AuthApiError('offline', 'offline'))
    })
    const store = persistence()
    const manager = new AuthSessionManager(service, store, () => {})
    await manager.restore()

    await manager.signOut()

    expect(store.clear).toHaveBeenCalledOnce()
    expect(manager.current()).toEqual({ kind: 'unauthenticated' })
    expect(manager.activeAccount()).toBeUndefined()
  })

  it('clears a newly issued token when secure persistence fails', async () => {
    const store = persistence(undefined)
    vi.mocked(store.save).mockRejectedValue(new Error('secure storage unavailable'))
    const tokens: Array<string | undefined> = []
    const manager = new AuthSessionManager(api(), store, (token) => tokens.push(token))

    await expect(
      manager.loginSms({ phone: '13800138000', code: '123456' })
    ).resolves.toMatchObject({ ok: false, reason: 'service-error' })

    expect(tokens).toEqual(['sms-token', undefined])
    expect(store.clear).toHaveBeenCalledOnce()
    expect(manager.current()).toEqual({ kind: 'unauthenticated' })
  })
})
