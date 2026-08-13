import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppSettingsStore } from '../src/main/state/app-settings'

describe('AppSettingsStore', () => {
  it('remembers and de-duplicates recent workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-settings-'))
    const first = join(root, 'first')
    const second = join(root, 'second')
    await mkdir(first)
    await mkdir(second)
    const file = join(root, 'settings.json')
    const store = new AppSettingsStore(file)

    await store.load()
    await store.rememberWorkspace(first)
    await store.rememberWorkspace(second)
    await store.rememberWorkspace(first)

    expect(store.lastWorkspace).toBe(first)
    expect(store.recentWorkspaces).toEqual([first, second])
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1)
  })

  it('drops workspaces that no longer exist on load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-settings-'))
    const file = join(root, 'settings.json')
    const store = new AppSettingsStore(file)
    await store.load()
    await store.rememberWorkspace(join(root, 'missing'))

    const reloaded = new AppSettingsStore(file)
    await reloaded.load()

    expect(reloaded.lastWorkspace).toBeUndefined()
    expect(reloaded.recentWorkspaces).toEqual([])
  })
})
