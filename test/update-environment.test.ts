import { describe, expect, it } from 'vitest'
import { parseUpdateDistribution } from '../src/main/update/update-environment'

describe('desktop update distribution', () => {
  it('derives every URL from the fixed production origin', () => {
    const distribution = parseUpdateDistribution({
      schema: 1,
      updateOrigin: 'https://updates.insight-aigc.com'
    })

    expect(distribution.updateOrigin.href).toBe('https://updates.insight-aigc.com/')
    expect(distribution.currentPointerUrl('candidate').href).toBe(
      'https://updates.insight-aigc.com/desktop/candidate/current.json'
    )
    expect(distribution.releaseBaseUrl('stable', '0.1.2').href).toBe(
      'https://updates.insight-aigc.com/desktop/releases/v0.1.2/'
    )
    expect(distribution.artifactUrl('candidate', '0.1.2-rc.2', 'insight-candidate-0.1.2-rc.2-mac-arm64.dmg').href).toBe(
      'https://updates.insight-aigc.com/desktop/releases/v0.1.2-rc.2/insight-candidate-0.1.2-rc.2-mac-arm64.dmg'
    )
  })

  it.each([
    { schema: 1, updateOrigin: 'http://updates.insight-aigc.com' },
    { schema: 1, updateOrigin: 'https://user:secret@updates.insight-aigc.com' },
    { schema: 1, updateOrigin: 'https://updates.insight-aigc.com/desktop' },
    { schema: 1, updateOrigin: 'https://updates.insight-aigc.com?token=secret' },
    { schema: 1, updateOrigin: 'https://updates.insight-aigc.com#fragment' },
    { schema: 1, updateOrigin: 'https://updates.insight-aigc.com', bucket: 'forbidden' },
    { schema: 2, updateOrigin: 'https://updates.insight-aigc.com' }
  ])('rejects unsafe configuration %#', (value) => {
    expect(() => parseUpdateDistribution(value)).toThrow()
  })

  it.each([
    ['stable', '0.1.2-rc.1'],
    ['candidate', '0.1.2'],
    ['candidate', '0.1.2-beta.1'],
    ['stable', 'v0.1.2'],
    ['development', '0.1.2']
  ])('rejects version %s/%s outside its release channel', (channel, version) => {
    const distribution = parseUpdateDistribution({
      schema: 1,
      updateOrigin: 'https://updates.insight-aigc.com'
    })
    expect(() => distribution.releaseBaseUrl(channel as never, version)).toThrow()
  })

  it.each([
    '../app.dmg',
    'folder/app.dmg',
    'folder\\app.dmg',
    'app name.dmg',
    '.hidden',
    'app%2Fdmg',
    '应用.dmg'
  ])('rejects unsafe artifact name %s', (name) => {
    const distribution = parseUpdateDistribution({
      schema: 1,
      updateOrigin: 'https://updates.insight-aigc.com'
    })
    expect(() => distribution.artifactUrl('stable', '0.1.2', name)).toThrow()
  })
})
