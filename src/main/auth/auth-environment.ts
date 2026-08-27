import type { AuthEnvironment } from '../../shared/auth-contracts'

/** API and cookie partition fixed by the desktop build channel. */
export interface AuthEnvironmentConfig {
  name: AuthEnvironment
  baseUrl: string
  partition: string
}

/** Resolve the authentication backend without a user-editable environment switch. */
export function resolveAuthEnvironment(input: {
  packaged: boolean
  channel?: unknown
}): AuthEnvironmentConfig {
  if (!input.packaged || input.channel === 'development') {
    return {
      name: 'test',
      baseUrl: 'https://gapi-test.insight-aigc.com',
      partition: 'persist:insight-auth-test'
    }
  }

  return {
    name: 'production',
    baseUrl: 'https://gapi.insight-aigc.com',
    partition: 'persist:insight-auth-production'
  }
}
