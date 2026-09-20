import { describe, expect, it } from 'vitest'
import { resolveAuthEnvironment } from '../src/main/auth/auth-environment'

describe('desktop auth environment', () => {
  it('uses test only for an unpackaged source build', () => {
    expect(resolveAuthEnvironment({ packaged: false })).toEqual({
      name: 'test',
      baseUrl: 'https://gapi-test.insight-aigc.com',
      partition: 'insight-auth-test'
    })
  })

  it('routes every packaged build to production', () => {
    expect(resolveAuthEnvironment({ packaged: true })).toEqual({
      name: 'production',
      baseUrl: 'https://gapi.insight-aigc.com',
      partition: 'persist:insight-auth-production'
    })
  })
})
