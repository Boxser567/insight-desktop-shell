import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { accountMenuActions } from '../packages/insight-desktop-integration/src/client/account-menu-model'

describe('desktop integration client', () => {
  it('opens the client settings section and signs out through narrow capabilities', async () => {
    const settingsDialog = { open: vi.fn() }
    const account = { signOut: vi.fn().mockResolvedValue(undefined) }
    const actions = accountMenuActions(settingsDialog, account)

    actions.openSettings()
    await actions.signOut()

    expect(settingsDialog.open).toHaveBeenCalledWith('client')
    expect(account.signOut).toHaveBeenCalledOnce()
  })

  it('uses only formal Harness slots and no private DOM or authentication transport', async () => {
    const source = await readFile('packages/insight-desktop-integration/src/client/index.tsx', 'utf8')

    for (const slot of [
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'sidebar.footer.action',
      'settings.trigger',
      'settings.section',
      'shell.overlay'
    ]) expect(source).toContain(`ctx.slots.inject('${slot}'`)
    expect(source).toContain("name: 'settings.trigger'")
    expect(source).toContain('priority: -100')
    expect(source).toContain('HiddenSettingsTrigger')
    expect(source).not.toContain("ctx.slots.inject('sidebar.settings'")
    expect(source).not.toMatch(/querySelector|\.click\(|fetch\(|token|cookie/iu)
  })

  it('renders the account menu outside the clipped sidebar and reuses the host React DOM', async () => {
    const components = await readFile('packages/insight-desktop-integration/src/client/components.tsx', 'utf8')
    const build = await readFile('scripts/build-desktop-integration.mjs', 'utf8')

    expect(components).toContain("createPortal(")
    expect(components).toContain('document.body')
    expect(build).toContain("'react-dom'")
    expect(build).toContain("'react-dom/*'")
  })
})
