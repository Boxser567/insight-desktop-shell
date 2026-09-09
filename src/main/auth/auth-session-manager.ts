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
  private accessToken?: string
  private sessionRevision = 0
  private modelCredentialOperation?: Promise<string>
  private credentialWrites: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<SessionListener>()

  constructor(
    private readonly api: AuthSessionApi,
    private readonly credentials: CredentialPersistence,
    private readonly onAccessTokenChanged: (token: string | undefined) => void
  ) {}

  current(): SessionView {
    return this.view
  }

  activeAccount(): AuthenticatedAccount | undefined {
    return this.account
  }

  /** Main/Host only. Validate the user-center session before each model request. */
  getModelAccessToken(accountId: string): Promise<string> {
    if (this.view.kind !== 'authenticated' || this.account?.id !== accountId) {
      return Promise.reject(new AuthApiError('expired', '请重新登录后继续会话。'))
    }
    if (this.modelCredentialOperation) return this.modelCredentialOperation
    const revision = this.sessionRevision
    const operation = this.validateModelCredential(accountId, revision)
    this.modelCredentialOperation = operation
    void operation.finally(() => {
      if (this.modelCredentialOperation === operation) this.modelCredentialOperation = undefined
    }).catch(() => undefined)
    return operation
  }

  private async validateModelCredential(accountId: string, revision: number): Promise<string> {
    try {
      const account = await this.currentUserWithOneRefresh(revision)
      this.assertSessionRevision(revision)
      if (account.id !== accountId || !this.accessToken || this.view.kind !== 'authenticated') {
        throw new AuthApiError('expired', '登录账号已变化，请重新登录。')
      }
      return this.accessToken
    } catch (error) {
      if (revision === this.sessionRevision && error instanceof AuthApiError && error.kind === 'expired') {
        ++this.sessionRevision
        this.account = undefined
        this.setAccessToken(undefined)
        this.transition({ kind: 'expired' })
        await this.clearCredentials().catch(() => undefined)
      }
      throw error
    }
  }

  private assertSessionRevision(revision: number): void {
    if (revision !== this.sessionRevision) throw new AuthApiError('expired', '登录已变化，请重试。')
  }

  private setAccessToken(token: string | undefined): void {
    this.accessToken = token
    this.onAccessTokenChanged(token)
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
    ++this.sessionRevision
    this.modelCredentialOperation = undefined
    const remoteLogout = this.api.logout().catch(() => undefined)
    this.account = undefined
    this.setAccessToken(undefined)
    this.transition({ kind: 'unauthenticated' })
    await Promise.all([this.clearCredentials(), remoteLogout])
  }

  private async performRestore(): Promise<void> {
    ++this.sessionRevision
    this.modelCredentialOperation = undefined
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
        await this.clearCredentials()
        this.transition({ kind: 'expired' })
        return
      }
      this.transition({ kind: 'offline' })
    }
  }

  private async currentUserWithOneRefresh(revision = this.sessionRevision): Promise<AuthenticatedAccount> {
    try {
      return await this.api.currentUser()
    } catch (error) {
      if (!(error instanceof AuthApiError) || error.kind !== 'expired') throw error
      this.assertSessionRevision(revision)
      const refreshed = await this.api.refresh()
      this.assertSessionRevision(revision)
      this.setAccessToken(refreshed.accessToken)
      await this.persistAccessToken(refreshed.accessToken, revision)
      this.assertSessionRevision(revision)
      return this.api.currentUser()
    }
  }

  private enqueueCredentialWrite(write: () => Promise<void>): Promise<void> {
    const operation = this.credentialWrites.then(write)
    this.credentialWrites = operation.catch(() => undefined)
    return operation
  }

  private clearCredentials(): Promise<void> {
    return this.enqueueCredentialWrite(() => this.credentials.clear())
  }

  private async persistAccessToken(token: string, revision = this.sessionRevision): Promise<void> {
    try {
      await this.enqueueCredentialWrite(async () => {
        if (revision === this.sessionRevision) await this.credentials.save(token)
      })
    } catch {
      // Secure persistence may be denied while the active in-memory session remains valid.
    }
  }

  private async login(
    method: 'sms' | 'password',
    authenticate: () => Promise<AccessTokenResult>
  ): Promise<AuthCommandResult> {
    ++this.sessionRevision
    this.modelCredentialOperation = undefined
    this.transition({ kind: 'authenticating', method })
    try {
      const result = await authenticate()
      this.setAccessToken(result.accessToken)
      this.account = await this.api.currentUser()
      await this.persistAccessToken(result.accessToken)
      this.transition({ kind: 'authenticated', account: this.account.summary })
      return { ok: true }
    } catch (error) {
      this.account = undefined
      if (error instanceof AuthApiError && error.kind === 'expired') {
        this.setAccessToken(undefined)
        await this.clearCredentials()
        this.transition({ kind: 'expired' })
      } else if (error instanceof AuthApiError && error.kind === 'offline') {
        this.transition({ kind: 'offline' })
      } else {
        this.setAccessToken(undefined)
        await this.clearCredentials().catch(() => undefined)
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
