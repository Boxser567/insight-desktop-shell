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
  // v1 uses the test user center together with the test model Gateway.
  // Keep the build inputs for a coordinated future production cutover.
  void input
  return {
    name: 'test',
    baseUrl: 'https://gapi-test.insight-aigc.com',
    partition: 'persist:insight-auth-test'
  }
}
