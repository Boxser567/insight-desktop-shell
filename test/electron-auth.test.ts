import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authCredentialPath } from '../src/main/auth/electron-auth'

describe('Electron auth dependencies', () => {
  it('separates test and production credential files', () => {
    expect(authCredentialPath('/user-data/insight', 'test')).toBe(
      join('/user-data/insight', 'auth', 'test.json')
    )
    expect(authCredentialPath('/user-data/insight', 'production')).toBe(
      join('/user-data/insight', 'auth', 'production.json')
    )
  })
})
