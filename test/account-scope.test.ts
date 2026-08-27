import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { accountPaths, accountScopeKey } from '../src/main/state/account-scope'

describe('desktop account scope', () => {
  it('derives stable, environment-specific keys without exposing the user id', () => {
    const first = accountScopeKey('test', '12345')
    const repeated = accountScopeKey('test', '12345')
    const production = accountScopeKey('production', '12345')

    expect(first).toBe(repeated)
    expect(first).not.toBe(production)
    expect(first).not.toContain('12345')
    expect(first).toMatch(/^[a-f0-9]{32}$/)
  })

  it('places Shell, Harness and cache under one account root', () => {
    const scope = accountScopeKey('test', '12345')

    expect(accountPaths('/data/insight', scope)).toEqual({
      root: join('/data/insight', 'accounts', scope),
      shell: join('/data/insight', 'accounts', scope, 'shell'),
      harness: join('/data/insight', 'accounts', scope, 'harness'),
      cache: join('/data/insight', 'accounts', scope, 'cache')
    })
  })

  it('rejects a scope that could escape the accounts root', () => {
    expect(() => accountPaths('/data/insight', '../legacy')).toThrow('account scope')
  })
})
