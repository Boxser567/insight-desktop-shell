/** Authentication environment selected by the desktop build channel. */
export type AuthEnvironment = 'test' | 'production'

/** User fields the Shell renderer may display. */
export interface AccountSummary {
  displayName: string
  avatarUrl?: string
  maskedPhone: string
}

/** Authentication state exposed to the Shell renderer. */
export type SessionView =
  | { kind: 'restoring' }
  | { kind: 'unauthenticated' }
  | { kind: 'authenticating'; method: 'sms' | 'password' }
  | { kind: 'authenticated'; account: AccountSummary }
  | { kind: 'offline' }
  | { kind: 'expired' }

/** SMS login fields accepted from the Shell renderer. */
export interface SmsLoginInput {
  phone: string
  code: string
}

/** Password login fields accepted from the Shell renderer. */
export interface PasswordLoginInput {
  phone: string
  password: string
  uuid: string
  imageCode: string
}

/** Captcha fields safe for the Shell renderer. */
export interface CaptchaView {
  uuid: string
  image: string
}

/** Result returned by a mutating authentication command. */
export type AuthCommandResult =
  | { ok: true }
  | {
      ok: false
      reason: 'invalid-input' | 'rejected' | 'offline' | 'service-error'
      message: string
    }
