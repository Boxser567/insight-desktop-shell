import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readmes = [
  'README.md',
  'README.zh.md'
]

const requiredFacts = [
  'Core Runtime',
  'core-runtime.lock.json',
  'npm run build',
  'npm run package:win'
]

describe('localized README parity', () => {
  for (const path of readmes) {
    it(`${path} carries the current product facts`, () => {
      const content = readFileSync(path, 'utf8')

      for (const fact of requiredFacts) expect(content).toContain(fact)
      expect(content).not.toContain('@deepseek-ai/dsh@0.1.1-rc.1')
    })
  }

  it('keeps every relative Markdown link resolvable', () => {
    const documents = readmes

    for (const path of documents) {
      const content = readFileSync(path, 'utf8')
      const links = content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)

      for (const match of links) {
        const target = match[1]
        if (!target) continue
        if (/^(?:https?:|mailto:)/.test(target)) continue
        const withoutAnchor = target.split('#', 1)[0]
        if (!withoutAnchor) continue
        expect(
          existsSync(resolve(dirname(path), decodeURIComponent(withoutAnchor))),
          `${path} links to missing ${target}`
        ).toBe(true)
      }
    }
  })

  it('does not publish internal working documents', () => {
    expect(existsSync('docs/preset-square-mvp.md')).toBe(false)
    expect(existsSync('docs/windows-profile-repair.md')).toBe(false)
  })

  it('documents reference upstream review instead of periodic whole-repository merges', () => {
    const readme = readFileSync('README.md', 'utf8')
    const localizedReadme = readFileSync('README.zh.md', 'utf8')
    const intake = readFileSync('docs/upstream-intake.md', 'utf8')

    expect(readme).toContain('reference upstream')
    expect(readme).toContain('selective adoption')
    expect(intake).toContain('upstream commit range')
    expect(localizedReadme).toContain('参考上游')
    expect(localizedReadme).toContain('定向采用')
    expect(`${readme}\n${localizedReadme}`).not.toContain('periodically merges')
    expect(localizedReadme).not.toContain('定期合并')
  })
})
