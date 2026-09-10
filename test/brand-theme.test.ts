import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const firstPartyFiles = [
  '../src/renderer/src/styles.css',
  '../src/renderer/src/update.css',
  '../packages/insight-desktop-integration/src/client/styles.tsx',
  '../src/preload/windows-menu.ts',
  '../build/plugin-recovery.html',
  '../build/safe-mode.html',
  '../src/renderer/src/about.css'
]

async function read(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('first-party brand theme', () => {
  it('uses the exact Insight primary token across every owned surface', async () => {
    const sources = await Promise.all(firstPartyFiles.map(read))

    for (const source of sources) {
      expect(source).toContain('--insight-primary: #315dfb')
    }
    expect(sources.join('\n')).not.toMatch(/#315efb|#6d8cff|#6c63ff|#4d6bfe/i)
  })

  it('routes primary actions and focus indicators through the token', async () => {
    const [shell, update, integration, windowsMenu, recovery, safeMode] =
      await Promise.all(firstPartyFiles.map(read))

    expect(shell).toContain('--accent: var(--insight-primary)')
    expect(shell).toMatch(/\.primary-button[^}]*background: var\(--accent\)/u)
    expect(update).toContain('accent-color: var(--insight-primary)')
    expect(integration).toContain('background: var(--insight-primary)')
    expect(windowsMenu).toContain('outline:2px solid var(--insight-primary)')
    expect(recovery).toContain('--button: var(--insight-primary)')
    expect(safeMode).toContain('--button: var(--insight-primary)')
  })
})
