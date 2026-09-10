import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { openUpdateWindowAndCheck } from '../src/main/update/open-update-window'

describe('menu update check orchestration', () => {
  it('starts a manual check before opening the status window', async () => {
    const calls: string[] = []
    const manager = {
      check: async (manual: boolean) => { calls.push(`check:${manual}`) }
    }
    const window = {
      open: async () => { calls.push('open') }
    }

    await openUpdateWindowAndCheck(manager, window)

    expect(calls).toEqual(['check:true', 'open'])
  })

  it('does not swallow check or window errors', async () => {
    await expect(openUpdateWindowAndCheck(
      { check: vi.fn().mockRejectedValue(new Error('check failed')) },
      { open: vi.fn().mockResolvedValue(undefined) }
    )).rejects.toThrow('check failed')

    await expect(openUpdateWindowAndCheck(
      { check: vi.fn().mockResolvedValue(undefined) },
      { open: vi.fn().mockRejectedValue(new Error('window failed')) }
    )).rejects.toThrow('window failed')
  })

  it('uses active checks only for menu commands and preserves sidebar open semantics', async () => {
    const main = await readFile('src/main/index.ts', 'utf8')

    expect(main).toContain('return openUpdateWindowAndCheck(updateManager, updateWindowController)')
    expect(main).toMatch(/case 'check-for-updates':\s+await checkForUpdatesFromMenu\(\)/u)
    expect(main).toContain('click: () => void checkForUpdatesFromMenu().catch(showUnexpectedError)')
    expect(main).toContain('return updateWindowController.open()')
  })
})
