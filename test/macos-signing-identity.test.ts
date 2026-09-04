import { describe, expect, it } from 'vitest'
import { findDeveloperIdApplicationIdentity } from '../scripts/macos-signing-identity.mjs'

describe('macOS signing identity', () => {
  it('selects only a Developer ID Application identity for the requested team', () => {
    const output = [
      '  1) 1111111111111111111111111111111111111111 "Apple Development: Developer (8P39WV82RX)"',
      '  2) 2222222222222222222222222222222222222222 "Developer ID Application: Company (8P39WV82RX)"',
      '  3) 3333333333333333333333333333333333333333 "Developer ID Application: Other (AAAAAAAAAA)"'
    ].join('\n')

    expect(findDeveloperIdApplicationIdentity(output, '8P39WV82RX')).toBe(
      '2222222222222222222222222222222222222222'
    )
  })

  it('rejects Apple Development and another team', () => {
    expect(findDeveloperIdApplicationIdentity(
      '  1) 1111111111111111111111111111111111111111 "Apple Development: Developer (8P39WV82RX)"',
      '8P39WV82RX'
    )).toBeUndefined()
    expect(findDeveloperIdApplicationIdentity(
      '  1) 2222222222222222222222222222222222222222 "Developer ID Application: Other (AAAAAAAAAA)"',
      '8P39WV82RX'
    )).toBeUndefined()
  })
})
