import type {
  AuthCommandResult,
  AuthEnvironment,
  CaptchaCommandResult,
  PasswordLoginInput,
  SessionView,
  SmsLoginInput
} from './auth-contracts'

/** CSS-pixel rectangle occupied by the Harness workspace. */
export interface WorkspaceBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Read-only application information shown by Shell settings. */
export interface ShellInfo {
  version: string
  environment: AuthEnvironment
}

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

/** Renderer-safe workspace actions performed by Electron Main. */
export interface ShellWorkspaceApi {
  setBounds(bounds: WorkspaceBounds | null): Promise<void>
  info(): Promise<ShellInfo>
  openAccountConfig(): Promise<{ ok: boolean }>
}
