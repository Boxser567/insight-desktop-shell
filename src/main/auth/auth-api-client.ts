import type {
  AccountSummary,
  CaptchaView,
  PasswordLoginInput,
  SmsLoginInput
} from '../../shared/auth-contracts'
import type { AuthEnvironmentConfig } from './auth-environment'

/** Fetch implementation supplied by an isolated Electron Session. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

interface ApiEnvelope {
  code?: string | number
  msg?: string
  message?: string
  data?: unknown
  body?: unknown
}

interface LoginPayload {
  accessToken: string
  accessTokenExpiredSeconds?: number
}

interface UserPayload {
  id?: string | number
  userId?: string | number
  userName?: string
  avatarUrl?: string
  phoneNo?: string
}

/** Main-only account identity paired with its renderer-safe projection. */
export interface AuthenticatedAccount {
  id: string
  summary: AccountSummary
}

/** Authentication API failure classified without parsing localized messages. */
export class AuthApiError extends Error {
  constructor(
    readonly kind: 'expired' | 'offline' | 'rejected' | 'service-error',
    message: string,
    readonly code?: string | number
  ) {
    super(message)
    this.name = 'AuthApiError'
  }
}

/** Hide the middle digits of a phone number shown by the Shell. */
export function maskPhone(phone: string): string {
  if (!phone) return ''
  if (phone.length < 7) return '****'
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function isSuccessCode(code: string | number | undefined): boolean {
  return code === 'SUCCESS' || code === 200 || code === 0 || code === '0'
}

function isExpiredCode(code: string | number | undefined): boolean {
  return code === 'USER_SESSION_EXPIRED' || code === 'USER_NOT_LOGIN' || code === -1
}

function responsePayload(envelope: ApiEnvelope): unknown {
  return envelope.data ?? envelope.body
}

function messageFrom(envelope: ApiEnvelope, fallback: string): string {
  return envelope.msg || envelope.message || fallback
}

function loginPayload(value: unknown): LoginPayload {
  if (typeof value !== 'object' || value === null) {
    throw new AuthApiError('service-error', '登录服务返回了无效结果。')
  }
  const candidate = value as Partial<LoginPayload>
  if (typeof candidate.accessToken !== 'string' || candidate.accessToken.length === 0) {
    throw new AuthApiError('service-error', '登录服务未返回访问令牌。')
  }
  return {
    accessToken: candidate.accessToken,
    ...(typeof candidate.accessTokenExpiredSeconds === 'number'
      ? { accessTokenExpiredSeconds: candidate.accessTokenExpiredSeconds }
      : {})
  }
}

/** Narrow client for the existing account endpoints used by the desktop Shell. */
export class AuthApiClient {
  constructor(
    private readonly fetch: FetchLike,
    private readonly environment: AuthEnvironmentConfig,
    private readonly getAccessToken: () => string | undefined
  ) {}

  async sendSmsCode(phone: string): Promise<void> {
    await this.request('/user-server/mobile/getSmsCode', {
      method: 'POST',
      body: { scene: 'LOGIN', phoneNumber: phone },
      loginRequest: true
    })
  }

  async captcha(): Promise<CaptchaView> {
    const value = await this.request('/user-server/captcha/captchaImage', {
      method: 'GET',
      loginRequest: true
    })
    if (typeof value !== 'object' || value === null) {
      throw new AuthApiError('service-error', '图形验证码服务返回了无效结果。')
    }
    const candidate = value as { uuid?: unknown; img?: unknown; src?: unknown }
    const rawImage = typeof candidate.src === 'string'
      ? candidate.src
      : typeof candidate.img === 'string'
        ? candidate.img
        : ''
    if (typeof candidate.uuid !== 'string' || candidate.uuid.length === 0 || !rawImage) {
      throw new AuthApiError('service-error', '图形验证码服务返回了无效结果。')
    }
    return {
      uuid: candidate.uuid,
      image:
        rawImage.startsWith('http') || rawImage.startsWith('data:image')
          ? rawImage
          : `data:image/png;base64,${rawImage}`
    }
  }

  async loginSms(input: SmsLoginInput): Promise<LoginPayload> {
    const value = await this.request('/user-server/loginV3', {
      method: 'POST',
      body: {
        type: 'PHONE_NUM',
        info: { phoneNo: input.phone, code: input.code }
      },
      loginRequest: true
    })
    return loginPayload(value)
  }

  async loginPassword(input: PasswordLoginInput): Promise<LoginPayload> {
    const value = await this.request('/user-server/loginV3', {
      method: 'POST',
      body: {
        type: 'PHONE_PASS',
        info: {
          phoneNo: input.phone,
          password: input.password,
          uuid: input.uuid,
          imgCode: input.imageCode
        }
      },
      loginRequest: true
    })
    return loginPayload(value)
  }

  async refresh(): Promise<LoginPayload> {
    return loginPayload(
      await this.request('/user-server/refresh', {
        method: 'GET',
        loginRequest: true
      })
    )
  }

  async currentUser(): Promise<AuthenticatedAccount> {
    const value = await this.request('/user-server/getUserDetail', { method: 'GET' })
    if (typeof value !== 'object' || value === null) {
      throw new AuthApiError('service-error', '用户服务返回了无效结果。')
    }
    const candidate = value as UserPayload
    const id = candidate.id ?? candidate.userId
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id).length === 0) {
      throw new AuthApiError('service-error', '用户服务未返回稳定账号标识。')
    }
    const phone = typeof candidate.phoneNo === 'string' ? candidate.phoneNo : ''
    const displayName =
      typeof candidate.userName === 'string' && candidate.userName.trim().length > 0
        ? candidate.userName.trim()
        : maskPhone(phone)
    return {
      id: String(id),
      summary: {
        displayName,
        ...(typeof candidate.avatarUrl === 'string' && candidate.avatarUrl.length > 0
          ? { avatarUrl: candidate.avatarUrl }
          : {}),
        maskedPhone: maskPhone(phone)
      }
    }
  }

  async logout(): Promise<void> {
    await this.request('/user-server/logout', {
      method: 'GET',
      loginRequest: true
    })
  }

  private async request(
    path: string,
    options: {
      method: 'GET' | 'POST'
      body?: unknown
      loginRequest?: boolean
    }
  ): Promise<unknown> {
    const headers = new Headers({
      'accept-language': 'zh_CN'
    })
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    if (options.loginRequest) {
      headers.set('extinfo', JSON.stringify({ client_type: 'PC' }))
    }
    const token = this.getAccessToken()
    if (token) headers.set('token', token)

    let response: Response
    try {
      response = await this.fetch(`${this.environment.baseUrl}${path}`, {
        method: options.method,
        headers,
        credentials: 'include',
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
      })
    } catch (error) {
      if (
        error instanceof TypeError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new AuthApiError('offline', '网络不可用，请检查网络连接。')
      }
      throw new AuthApiError('service-error', '认证服务请求失败。')
    }

    let envelope: ApiEnvelope
    try {
      envelope = await response.json() as ApiEnvelope
    } catch {
      throw new AuthApiError(
        response.status === 401 ? 'expired' : 'service-error',
        '认证服务返回了无效响应。',
        response.status
      )
    }

    if (isSuccessCode(envelope.code)) return responsePayload(envelope)
    if (response.status === 401 || isExpiredCode(envelope.code)) {
      throw new AuthApiError(
        'expired',
        messageFrom(envelope, '登录已失效，请重新登录。'),
        envelope.code ?? response.status
      )
    }
    throw new AuthApiError(
      response.ok ? 'rejected' : 'service-error',
      messageFrom(envelope, '认证服务暂时不可用。'),
      envelope.code ?? response.status
    )
  }
}
