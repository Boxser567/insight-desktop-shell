import { join } from 'node:path'
import type { AuthEnvironment } from '../../shared/auth-contracts'
import { AuthApiClient, type FetchLike } from './auth-api-client'
import type { AuthEnvironmentConfig } from './auth-environment'
import {
  AuthSessionManager,
  type CredentialPersistence
} from './auth-session-manager'
import { CredentialStore, type CredentialCipher } from './credential-store'

/** Resolve the encrypted credential file for one build environment. */
export function authCredentialPath(
  insightRoot: string,
  environment: AuthEnvironment
): string {
  return join(insightRoot, 'auth', `${environment}.json`)
}

interface ElectronAuthInput {
  environment: AuthEnvironmentConfig
  insightRoot: string
  fetch: FetchLike
}

type ElectronCredentialInput =
  | { persistCredentials: false }
  | { persistCredentials: true; cipher: CredentialCipher }

function createCredentialPersistence(
  input: ElectronAuthInput & ElectronCredentialInput
): CredentialPersistence {
  if (!input.persistCredentials) {
    return {
      load: async () => undefined,
      save: async () => undefined,
      clear: async () => undefined
    }
  }

  return new CredentialStore(
    authCredentialPath(input.insightRoot, input.environment.name),
    input.cipher
  )
}

/** Compose the session manager from Electron-owned transport and encryption. */
export function createElectronAuth(
  input: ElectronAuthInput & ElectronCredentialInput
): AuthSessionManager {
  let accessToken: string | undefined
  const api = new AuthApiClient(
    input.fetch,
    input.environment,
    () => accessToken
  )
  const credentials = createCredentialPersistence(input)
  return new AuthSessionManager(api, credentials, (token) => {
    accessToken = token
  })
}
