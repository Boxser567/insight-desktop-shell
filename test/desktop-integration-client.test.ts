import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { accountMenuActions } from '../packages/insight-desktop-integration/src/client/account-menu-model'
import { createSkillCatalog, filterSkills } from '../packages/insight-desktop-integration/src/skill-catalog'
import { BUNDLED_SKILL_PRESENTATIONS } from '../packages/insight-desktop-integration/src/bundled-skill-presentations'

describe('desktop integration client', () => {
  it('uses the shared skill catalog so incomplete new-session results refresh to the full bundle', async () => {
    const sessionId = 'session-test' as Parameters<ReturnType<typeof createSkillCatalog>['list']>[0]
    const listeners = new Set<() => void>()
    const bundled = Object.keys(BUNDLED_SKILL_PRESENTATIONS).map((name, index) => ({
      name,
      description: `${name} description`,
      path: `/Applications/因赛AI.app/Contents/Resources/bundled-skills/${name}/SKILL.md`,
      order: index,
      pickerVisible: name !== 'media-generator'
    }))
    let rows = bundled.slice(0, 2)
    const nativeCatalog = {
      list: vi.fn(async () => rows),
      subscribe: vi.fn((_sessionId, listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      })
    }
    const remoteList = vi.fn()
    const ctx = {
      get: vi.fn((name: string) => name === 'skillCatalog' ? nativeCatalog : undefined),
      get skillCatalog(): never {
        throw new Error('service "skillCatalog" is not declared by your plugin')
      },
      on: vi.fn(),
      remote: {
        skills: { list: remoteList },
        workspaceFiles: { readBytes: vi.fn().mockRejectedValue(new Error('sidecar unavailable')) }
      }
    }
    const catalog = createSkillCatalog(ctx as unknown as Parameters<typeof createSkillCatalog>[0])
    const refresh = vi.fn()
    const off = catalog.subscribe(sessionId, refresh)

    expect(await catalog.list(sessionId)).toHaveLength(2)
    rows = bundled
    for (const listener of listeners) listener()

    expect(refresh).toHaveBeenCalledOnce()
    expect(filterSkills(await catalog.list(sessionId), '')).toHaveLength(11)
    expect(nativeCatalog.list).toHaveBeenCalledTimes(2)
    expect(ctx.get).toHaveBeenCalledWith('skillCatalog')
    expect(remoteList).not.toHaveBeenCalled()
    off()
  })

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
      'sidebar.brand.control',
      'sidebar.brand.mark',
      'sidebar.footer.action',
      'settings.trigger',
      'settings.section',
      'shell.overlay'
    ]) expect(source).toContain(`ctx.slots.inject('${slot}'`)
    expect(source).toContain("name: 'settings.trigger'")
    expect(source).toContain('priority: -100')
    expect(source).toContain('HiddenSettingsTrigger')
    expect(source).toContain('UpdateButton')
    expect(source).toContain('window.insightDesktopUpdates')
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

  it('opens the official website from the expanded sidebar brand without starting a session', async () => {
    const components = await readFile('packages/insight-desktop-integration/src/client/components.tsx', 'utf8')

    expect(components).toContain("const INSIGHT_DESKTOP_WEBSITE = 'https://desktop.insight-aigc.com/'")
    expect(components).toContain("window.open(INSIGHT_DESKTOP_WEBSITE, '_blank', 'noopener,noreferrer')")
    expect(components).toMatch(/<button type="button" data-insight-desktop-sidebar-brand aria-label="打开因赛AI官网"[\s\S]*?onClick=\{openProductWebsite\}/u)
    expect(components).toMatch(/export function BrandName\(\) \{\s+return <span data-insight-desktop-brand-name>/u)
  })

  it('does not render the account update button before a verified update exists', async () => {
    const components = await readFile('packages/insight-desktop-integration/src/client/components.tsx', 'utf8')

    expect(components).toContain('shouldShowUpdateEntry(status)')
    expect(components).toContain('return null')
    expect(components).toContain('availableVersion')
  })
})
