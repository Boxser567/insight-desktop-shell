import { describe, expect, it } from 'vitest'
import { buildHarnessArguments, buildNodeArguments } from '../src/main/runtime/harness-runtime'
import { isTrustedAppUrl } from '../src/main/security-policy'

describe('Harness launch contract', () => {
  it('binds the web server to a random loopback port', () => {
    expect(buildHarnessArguments(43127)).toEqual([
      'web',
      '--host',
      '127.0.0.1',
      '--port',
      '43127'
    ])
  })

  it('grants Node internals only to the Harness child process', () => {
    expect(buildNodeArguments('/runtime/dsh.js', 43127)).toEqual([
      '--expose-internals',
      '/runtime/dsh.js',
      'web',
      '--host',
      '127.0.0.1',
      '--port',
      '43127'
    ])
  })
})

describe('navigation trust boundary', () => {
  it('only trusts the launcher and loopback HTTP pages', () => {
    expect(isTrustedAppUrl('file:///app/index.html')).toBe(true)
    expect(isTrustedAppUrl('http://127.0.0.1:43127')).toBe(true)
    expect(isTrustedAppUrl('http://localhost:43127')).toBe(true)
    expect(isTrustedAppUrl('https://127.0.0.1:43127')).toBe(false)
    expect(isTrustedAppUrl('http://example.com')).toBe(false)
    expect(isTrustedAppUrl('javascript:alert(1)')).toBe(false)
  })
})
