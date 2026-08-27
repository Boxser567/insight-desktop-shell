import { describe, expect, it } from 'vitest'
import { resolveAuthEnvironment } from '../src/main/auth/auth-environment'

describe('desktop auth environment', () => {
  it('uses test for source and development builds', () => {
    expect(resolveAuthEnvironment({ packaged: false })).toEqual({
      name: 'test',
      baseUrl: 'https://gapi-test.insight-aigc.com',
      partition: 'persist:insight-auth-test'
    })
    expect(
      resolveAuthEnvironment({ packaged: true, channel: 'development' })
    ).toEqual({
      name: 'test',
      baseUrl: 'https://gapi-test.insight-aigc.com',
      partition: 'persist:insight-auth-test'
    })
  })

  it('uses production for a packaged release build', () => {
    expect(resolveAuthEnvironment({ packaged: true })).toEqual({
      name: 'production',
      baseUrl: 'https://gapi.insight-aigc.com',
      partition: 'persist:insight-auth-production'
    })
  })
})
