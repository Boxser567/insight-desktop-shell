import { join } from 'node:path'
import type { AuthEnvironment } from '../../shared/auth-contracts'
import { AuthApiClient, type FetchLike } from './auth-api-client'
import type { AuthEnvironmentConfig } from './auth-environment'
import { AuthSessionManager } from './auth-session-manager'
import { CredentialStore, type CredentialCipher } from './credential-store'

/** Resolve the encrypted credential file for one build environment. */
export function authCredentialPath(
  insightRoot: string,
  environment: AuthEnvironment
): string {
  return join(insightRoot, 'auth', `${environment}.json`)
}

/** Compose the session manager from Electron-owned transport and encryption. */
export function createElectronAuth(input: {
  environment: AuthEnvironmentConfig
  insightRoot: string
  fetch: FetchLike
  cipher: CredentialCipher
}): AuthSessionManager {
  let accessToken: string | undefined
  const api = new AuthApiClient(
    input.fetch,
    input.environment,
    () => accessToken
  )
  const credentials = new CredentialStore(
    authCredentialPath(input.insightRoot, input.environment.name),
    input.cipher
  )
  return new AuthSessionManager(api, credentials, (token) => {
    accessToken = token
  })
}
