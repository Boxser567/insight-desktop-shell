import type {
  AuthCommandResult,
  CaptchaCommandResult,
  PasswordLoginInput,
  SessionView,
  SmsLoginInput
} from './auth-contracts'

/** Authentication commands exposed only to the Shell renderer. */
export interface ShellAuthApi {
  current(): Promise<SessionView>
  subscribe(listener: (view: SessionView) => void): () => void
  retry(): Promise<void>
  sendSmsCode(phone: string): Promise<AuthCommandResult>
  loadCaptcha(): Promise<CaptchaCommandResult>
  loginSms(input: SmsLoginInput): Promise<AuthCommandResult>
  loginPassword(input: PasswordLoginInput): Promise<AuthCommandResult>
  signOut(): Promise<void>
}
