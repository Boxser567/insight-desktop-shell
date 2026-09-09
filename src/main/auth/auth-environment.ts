import type { AuthEnvironment } from '../../shared/auth-contracts'

/** API and cookie partition fixed by the product's release environment. */
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
      partition: 'insight-auth-test'
    }
  }

  // v1 uses the test user center together with the test model Gateway.
  // Keep the build inputs for a coordinated future production cutover.
  return {
    name: 'test',
    baseUrl: 'https://gapi-test.insight-aigc.com',
    partition: 'persist:insight-auth-test'
  }
}
