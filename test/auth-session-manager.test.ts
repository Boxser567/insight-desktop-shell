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
  it('clears a refresh persistence write that was already running when logout started', async () => {
    const service = api()
    const store = persistence()
    const manager = new AuthSessionManager(service, store, () => {})
    await manager.restore()
    let finishSave!: () => void
    vi.mocked(store.save).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve }))
    vi.mocked(service.currentUser).mockRejectedValueOnce(new AuthApiError('expired', 'expired'))
    const rejected = expect(manager.getModelAccessToken('42')).rejects.toMatchObject({ kind: 'expired' })
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'))
    const logout = manager.signOut()
    expect(store.clear).not.toHaveBeenCalled()
    finishSave()
    await Promise.all([logout, rejected])
    expect(store.clear).toHaveBeenCalledOnce()
    expect(manager.current().kind).toBe('unauthenticated')
  })

  it('supplies a refreshed model token without exposing it in session views', async () => {
    const service = api()
    const manager = new AuthSessionManager(service, persistence(), () => {})
    await manager.restore()
    vi.mocked(service.currentUser).mockRejectedValueOnce(new AuthApiError('expired', 'expired'))
    expect(await manager.getModelAccessToken('42')).toBe('fresh-token')
    expect(service.refresh).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(manager.current())).not.toContain('fresh-token')
    await expect(manager.getModelAccessToken('another-account')).rejects.toMatchObject({ kind: 'expired' })
  })

  it('shares model credential validation and preserves the login on network failure', async () => {
    const service = api()
    const manager = new AuthSessionManager(service, persistence(), () => {})
    await manager.restore()
    vi.mocked(service.currentUser).mockRejectedValueOnce(new AuthApiError('offline', 'offline'))
    const results = await Promise.allSettled([manager.getModelAccessToken('42'), manager.getModelAccessToken('42')])
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(service.currentUser).toHaveBeenCalledTimes(2)
    expect(manager.current().kind).toBe('authenticated')
    expect(await manager.getModelAccessToken('42')).toBe('stored-token')
  })

  it('expires the Shell session if model credential refresh is rejected', async () => {
    const service = api()
    const store = persistence()
    const manager = new AuthSessionManager(service, store, () => {})
    await manager.restore()
    vi.mocked(service.currentUser).mockRejectedValueOnce(new AuthApiError('expired', 'expired'))
    vi.mocked(service.refresh).mockRejectedValueOnce(new AuthApiError('expired', 'expired'))
    await expect(manager.getModelAccessToken('42')).rejects.toMatchObject({ kind: 'expired' })
    expect(manager.current().kind).toBe('expired')
    expect(store.clear).toHaveBeenCalledOnce()
  })

  it('does not revive an old model request after logout and a new login', async () => {
    const service = api()
    const store = persistence()
    const tokens: Array<string | undefined> = []
    const manager = new AuthSessionManager(service, store, token => tokens.push(token))
    await manager.restore()
    let finish!: (value: { accessToken: string }) => void
    vi.mocked(service.currentUser).mockRejectedValueOnce(new AuthApiError('expired', 'expired'))
    vi.mocked(service.refresh).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = manager.getModelAccessToken('42')
    const rejection = expect(pending).rejects.toMatchObject({ kind: 'expired' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await manager.signOut()
    await manager.loginSms({ phone: '13800008000', code: '123456' })
    finish({ accessToken: 'obsolete-token' })
    await rejection
    expect(tokens).not.toContain('obsolete-token')
    expect(store.save).not.toHaveBeenCalledWith('obsolete-token')
    expect(await manager.getModelAccessToken('42')).toBe('sms-token')
  })

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

  it('restores a refreshed session when secure persistence is denied', async () => {
    const service = api({
      currentUser: vi
        .fn()
        .mockRejectedValueOnce(new AuthApiError('expired', 'expired'))
        .mockResolvedValueOnce(account)
    })
    const store = persistence()
    vi.mocked(store.save).mockRejectedValue(new Error('secure storage unavailable'))
    const tokens: Array<string | undefined> = []
    const manager = new AuthSessionManager(service, store, (token) => tokens.push(token))

    await manager.restore()

    expect(tokens).toEqual(['stored-token', 'fresh-token'])
    expect(store.clear).not.toHaveBeenCalled()
    expect(manager.current()).toEqual({ kind: 'authenticated', account: account.summary })
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

  it('keeps the active login when secure persistence is denied', async () => {
    const store = persistence(undefined)
    vi.mocked(store.save).mockRejectedValue(new Error('secure storage unavailable'))
    const tokens: Array<string | undefined> = []
    const manager = new AuthSessionManager(api(), store, (token) => tokens.push(token))

    await expect(
      manager.loginSms({ phone: '13800138000', code: '123456' })
    ).resolves.toEqual({ ok: true })

    expect(tokens).toEqual(['sms-token'])
    expect(store.clear).not.toHaveBeenCalled()
    expect(manager.current()).toEqual({ kind: 'authenticated', account: account.summary })
  })
})
