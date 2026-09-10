import type { AuthEnvironment } from '../../shared/auth-contracts'
import { desktopServiceEnvironment } from '../../shared/service-environment'

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
  const development = !input.packaged || input.channel === 'development'
  const service = desktopServiceEnvironment(development ? 'test' : undefined)
  return {
    name: service.name,
    baseUrl: service.authOrigin,
    partition: development
      ? `insight-auth-${service.name}`
      : `persist:insight-auth-${service.name}`
  }
}
