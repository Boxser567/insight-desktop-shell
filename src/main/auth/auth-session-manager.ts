import type {
  AuthCommandResult,
  CaptchaCommandResult,
  CaptchaView,
  PasswordLoginInput,
  SessionView,
  SmsLoginInput
} from '../../shared/auth-contracts'
import {
  AuthApiError,
  type AuthenticatedAccount
} from './auth-api-client'

interface AccessTokenResult {
  accessToken: string
}

/** Account API methods consumed by the session state machine. */
export interface AuthSessionApi {
  sendSmsCode(phone: string): Promise<void>
  captcha(): Promise<CaptchaView>
  loginSms(input: SmsLoginInput): Promise<AccessTokenResult>
  loginPassword(input: PasswordLoginInput): Promise<AccessTokenResult>
  refresh(): Promise<AccessTokenResult>
  currentUser(): Promise<AuthenticatedAccount>
  logout(): Promise<void>
}

/** Encrypted credential persistence consumed by the state machine. */
export interface CredentialPersistence {
  load(): Promise<string | undefined>
  save(token: string): Promise<void>
  clear(): Promise<void>
}

type SessionListener = (view: SessionView) => void

function commandFailure(error: unknown): Exclude<AuthCommandResult, { ok: true }> {
  if (error instanceof AuthApiError) {
    return {
      ok: false,
      reason:
        error.kind === 'offline'
          ? 'offline'
          : error.kind === 'rejected' || error.kind === 'expired'
            ? 'rejected'
            : 'service-error',
      message: error.message
    }
  }
  return { ok: false, reason: 'service-error', message: '认证服务暂时不可用。' }
}

/** Owns the desktop authentication state and its Main-only account identity. */
export class AuthSessionManager {
  private view: SessionView = { kind: 'unauthenticated' }
  private account?: AuthenticatedAccount
  private restoreOperation?: Promise<void>
  private readonly listeners = new Set<SessionListener>()

  constructor(
    private readonly api: AuthSessionApi,
    private readonly credentials: CredentialPersistence,
    private readonly setAccessToken: (token: string | undefined) => void
  ) {}

  current(): SessionView {
    return this.view
  }

  activeAccount(): AuthenticatedAccount | undefined {
    return this.account
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  restore(): Promise<void> {
    if (this.restoreOperation) return this.restoreOperation
    this.restoreOperation = this.performRestore().finally(() => {
      this.restoreOperation = undefined
    })
    return this.restoreOperation
  }

  retry(): Promise<void> {
    return this.restore()
  }

  async sendSmsCode(phone: string): Promise<AuthCommandResult> {
    try {
      await this.api.sendSmsCode(phone)
      return { ok: true }
    } catch (error) {
      return commandFailure(error)
    }
  }

  async loadCaptcha(): Promise<CaptchaCommandResult> {
    try {
      return { ok: true, captcha: await this.api.captcha() }
    } catch (error) {
      const failure = commandFailure(error)
      return {
        ok: false,
        reason: failure.reason === 'offline' ? 'offline' : 'service-error',
        message: failure.message
      }
    }
  }

  async loginSms(input: SmsLoginInput): Promise<AuthCommandResult> {
    return this.login('sms', () => this.api.loginSms(input))
  }

  async loginPassword(input: PasswordLoginInput): Promise<AuthCommandResult> {
    return this.login('password', () => this.api.loginPassword(input))
  }

  async signOut(): Promise<void> {
    const remoteLogout = this.api.logout().catch(() => undefined)
    this.account = undefined
    this.setAccessToken(undefined)
    this.transition({ kind: 'unauthenticated' })
    await Promise.all([this.credentials.clear(), remoteLogout])
  }

  private async performRestore(): Promise<void> {
    this.transition({ kind: 'restoring' })
    const token = await this.credentials.load()
    if (!token) {
      this.account = undefined
      this.setAccessToken(undefined)
      this.transition({ kind: 'unauthenticated' })
      return
    }
    this.setAccessToken(token)

    try {
      this.account = await this.currentUserWithOneRefresh()
      this.transition({ kind: 'authenticated', account: this.account.summary })
    } catch (error) {
      this.account = undefined
      if (error instanceof AuthApiError && error.kind === 'expired') {
        this.setAccessToken(undefined)
        await this.credentials.clear()
        this.transition({ kind: 'expired' })
        return
      }
      this.transition({ kind: 'offline' })
    }
  }

  private async currentUserWithOneRefresh(): Promise<AuthenticatedAccount> {
    try {
      return await this.api.currentUser()
    } catch (error) {
      if (!(error instanceof AuthApiError) || error.kind !== 'expired') throw error
      const refreshed = await this.api.refresh()
      this.setAccessToken(refreshed.accessToken)
      await this.credentials.save(refreshed.accessToken)
      return this.api.currentUser()
    }
  }

  private async login(
    method: 'sms' | 'password',
    authenticate: () => Promise<AccessTokenResult>
  ): Promise<AuthCommandResult> {
    this.transition({ kind: 'authenticating', method })
    try {
      const result = await authenticate()
      this.setAccessToken(result.accessToken)
      await this.credentials.save(result.accessToken)
      this.account = await this.api.currentUser()
      this.transition({ kind: 'authenticated', account: this.account.summary })
      return { ok: true }
    } catch (error) {
      this.account = undefined
      if (error instanceof AuthApiError && error.kind === 'expired') {
        this.setAccessToken(undefined)
        await this.credentials.clear()
        this.transition({ kind: 'expired' })
      } else if (error instanceof AuthApiError && error.kind === 'offline') {
        this.transition({ kind: 'offline' })
      } else {
        this.setAccessToken(undefined)
        await this.credentials.clear().catch(() => undefined)
        this.transition({ kind: 'unauthenticated' })
      }
      return commandFailure(error)
    }
  }

  private transition(view: SessionView): void {
    this.view = view
    for (const listener of this.listeners) listener(view)
  }
}
