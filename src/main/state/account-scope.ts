import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { AuthEnvironment } from '../../shared/auth-contracts'

const ACCOUNT_SCOPE_PATTERN = /^[a-f0-9]{32}$/u

/** Directories owned by one authenticated account on this device. */
export interface AccountPaths {
  root: string
  shell: string
  harness: string
  cache: string
  launchRoot: string
}

/** Derive an opaque, environment-specific account directory key. */
export function accountScopeKey(
  environment: AuthEnvironment,
  userId: string
): string {
  return createHash('sha256')
    .update(`insight-account-v1\0${environment}\0${userId}`)
    .digest('hex')
    .slice(0, 32)
}

/** Resolve account-owned paths after validating the opaque scope key. */
export function accountPaths(insightRoot: string, scope: string): AccountPaths {
  if (!ACCOUNT_SCOPE_PATTERN.test(scope)) {
    throw new Error('The account scope is invalid.')
  }
  const root = join(insightRoot, 'accounts', scope)
  return {
    root,
    shell: join(root, 'shell'),
    harness: join(root, 'harness'),
    cache: join(root, 'cache'),
    launchRoot: join(root, 'launch-root')
  }
}
