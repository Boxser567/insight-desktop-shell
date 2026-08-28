import type { AccountSummary, AuthEnvironment } from './auth-contracts'

/** Desktop metadata exposed to the authenticated Harness client. */
export interface DesktopClientInfo {
  version: string
  environment: AuthEnvironment
  platform: 'darwin' | 'win32' | 'linux'
}

/** Narrow account surface available only inside the authenticated Harness view. */
export interface HarnessAccountApi {
  current(): Promise<AccountSummary | undefined>
  subscribe(listener: (account: AccountSummary | undefined) => void): () => void
  signOut(): Promise<void>
  info(): Promise<DesktopClientInfo>
}
