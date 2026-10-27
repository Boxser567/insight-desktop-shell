import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeBundledProfile } from '../src/main/state/bundled-profile'
import { repairProfilePackages } from '../src/main/state/profile-startup-repair'
import { isProfileInstallComplete, markProfileInstallComplete } from '../src/main/state/profile-install-marker'

const communityPlugins = [
  { name: 'dsh-memory-evolve', version: '0.1.0-insight.1', archive: 'dsh-memory-evolve-0.1.0-insight.1.tgz' },
  { name: 'dsh-prompt-enhance', version: '0.2.7', archive: 'dsh-prompt-enhance-0.2.7.tgz' },
  { name: '@insight-ai/desktop-canvas-plugin', version: '0.3.0-alpha.32', archive: 'insight-ai-desktop-canvas-plugin-0.3.0-alpha.32.tgz' }
] as const

describe('bundled profile initialization', () => {
  const testDir = join(__dirname, '.temp-bundled-profile-test')

  async function writeCurrentTemplate(template: string, clientBundle = 'bundle\n'): Promise<void> {
    const profile = join(template, 'web')
    await mkdir(join(profile, 'packages', 'insight-desktop-integration', 'lib'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: Object.fromEntries([
        ...communityPlugins.map((plugin) => [
          plugin.name,
          `file:.insight-bundled-plugins/${plugin.archive}`
        ]),
        ['@insight-ai/desktop-integration', 'workspace:*']
      ]),
      dsh: {
        profile: {
          bundles: [
            '@deepseek-ai/dsh-base',
            '@deepseek-ai/dsh-web-app',
            ...communityPlugins.map((plugin) => plugin.name),
            '@insight-ai/desktop-integration'
          ]
        }
      },
      insightDesktop: { defaultProfileVersion: 8 }
    }), 'utf8')
    await writeFile(
      join(profile, 'packages', 'insight-desktop-integration', 'package.json'),
      JSON.stringify({ name: '@insight-ai/desktop-integration' }),
      'utf8'
    )
    for (const plugin of communityPlugins) {
      const installed = join(profile, 'node_modules', ...plugin.name.split('/'))
      await mkdir(installed, { recursive: true })
      await writeFile(join(installed, 'package.json'), JSON.stringify({
        name: plugin.name,
        version: plugin.version
      }), 'utf8')
      if (plugin.name === 'dsh-memory-evolve') {
        await mkdir(join(installed, 'lib'), { recursive: true })
        await writeFile(join(installed, 'lib', 'client.js'), 'new memory\n', 'utf8')
      }
      await mkdir(join(profile, '.insight-bundled-plugins'), { recursive: true })
      await writeFile(join(profile, '.insight-bundled-plugins', plugin.archive), plugin.name, 'utf8')
    }
    await mkdir(join(profile, 'node_modules', 'dsh-prompt-enhance', 'lib'), { recursive: true })
    await mkdir(join(profile, 'node_modules', 'dsh-memory-evolve', 'lib'), { recursive: true })
    await writeFile(
      join(profile, 'node_modules', 'dsh-prompt-enhance', 'lib', 'client.js'),
      'const imageCount = useInput((state) => countOf(state.attachmentIds));\nconst scope = settingsCtx.configForms.get(NS);\nbody:not([data-ds-dark-theme]) .dsh-pe-panel {\n  color: black;\n}\n',
      'utf8'
    )
    await writeFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), clientBundle, 'utf8')
    const integration = join(profile, 'node_modules', '@insight-ai', 'desktop-integration')
    await mkdir(join(integration, 'lib'), { recursive: true })
    await writeFile(join(integration, 'package.json'), JSON.stringify({ name: '@insight-ai/desktop-integration' }))
    await writeFile(join(integration, 'lib', 'client.js'), clientBundle)
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n  - packages/*\n', 'utf8')
  }

  async function writeLegacyProfile(dshHome: string): Promise<string> {
    const profile = join(dshHome, 'profiles', 'web')
    await mkdir(join(profile, 'packages', 'insight-desktop-integration', 'lib'), { recursive: true })
    await mkdir(join(profile, 'node_modules', 'dsh-prompt-enhance', 'lib'), { recursive: true })
    await mkdir(join(profile, 'node_modules', 'dsh-memory-evolve', 'lib'), { recursive: true })
    await mkdir(join(profile, 'node_modules', '@changfenhuang', 'dsh-genui'), { recursive: true })
    await mkdir(join(profile, 'node_modules', 'dshmarket'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        dshmarket: '1.46.1',
        '@changfenhuang/dsh-genui': 'file:.insight-bundled-plugins/changfenhuang-dsh-genui-0.9.8.tgz',
        'dsh-prompt-enhance': 'file:.insight-bundled-plugins/dsh-prompt-enhance-0.1.9.tgz',
        'dsh-memory-evolve': 'file:.insight-bundled-plugins/dsh-memory-evolve-0.1.0.tgz',
        'dsh-user-plugin': '1.2.3',
        'dsh-better-sidebar': '0.16.1'
      },
      dsh: {
        profile: {
          bundles: [
            '@deepseek-ai/dsh-base',
            '@deepseek-ai/dsh-web-app',
            'dshmarket',
            '@changfenhuang/dsh-genui',
            'dsh-prompt-enhance',
            'dsh-memory-evolve',
            'dsh-better-sidebar',
            'dsh-user-plugin',
            '@insight-ai/desktop-integration'
          ]
        }
      },
      insightDesktop: { defaultProfileVersion: 6 }
    }), 'utf8')
    await writeFile(join(profile, 'packages', 'insight-desktop-integration', 'package.json'), '{}', 'utf8')
    await writeFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), 'old bundle\n', 'utf8')
    await writeFile(join(profile, 'node_modules', 'dsh-prompt-enhance', 'package.json'), JSON.stringify({
      name: 'dsh-prompt-enhance', version: '0.1.9'
    }), 'utf8')
    await writeFile(join(profile, 'node_modules', 'dsh-prompt-enhance', 'lib', 'client.js'), 'old prompt client\n', 'utf8')
    await writeFile(join(profile, 'node_modules', 'dsh-memory-evolve', 'package.json'), JSON.stringify({
      name: 'dsh-memory-evolve', version: '0.1.0'
    }), 'utf8')
    await writeFile(join(profile, 'node_modules', 'dsh-memory-evolve', 'lib', 'client.js'), 'old memory\n', 'utf8')
    await writeFile(join(profile, 'node_modules', '@changfenhuang', 'dsh-genui', 'package.json'), JSON.stringify({
      name: '@changfenhuang/dsh-genui', version: '0.9.8'
    }), 'utf8')
    await writeFile(join(profile, 'node_modules', 'dshmarket', 'package.json'), JSON.stringify({
      name: 'dshmarket', version: '1.46.1'
    }), 'utf8')
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n', 'utf8')
    return profile
  }

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('copies the current profile without retired built-in plugins', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    const profile = join(dshHome, 'profiles', 'web')
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    expect(manifest.insightDesktop.defaultProfileVersion).toBe(8)
    expect(manifest.dependencies).not.toHaveProperty('dshmarket')
    expect(manifest.dependencies).not.toHaveProperty('@changfenhuang/dsh-genui')
    expect(manifest.dsh.profile.bundles).not.toContain('dshmarket')
    expect(manifest.dsh.profile.bundles).not.toContain('@changfenhuang/dsh-genui')
    for (const plugin of communityPlugins) {
      expect(manifest.dependencies[plugin.name]).toBe(`file:.insight-bundled-plugins/${plugin.archive}`)
      expect(await readFile(join(profile, '.insight-bundled-plugins', plugin.archive), 'utf8')).toBe(plugin.name)
    }

    await writeFile(join(profile, 'package.json'), '{"name":"user-profile"}', 'utf8')
    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    expect(await readFile(join(profile, 'package.json'), 'utf8')).toContain('user-profile')
  })

  it('migrates the old managed Profile and preserves user plugins', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template, 'new bundle\n')
    const profile = await writeLegacyProfile(dshHome)

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    expect(manifest.insightDesktop.defaultProfileVersion).toBe(8)
    expect(manifest.dependencies.dshmarket).toBeUndefined()
    expect(manifest.dependencies['@changfenhuang/dsh-genui']).toBeUndefined()
    expect(manifest.dependencies['dsh-better-sidebar']).toBeUndefined()
    expect(manifest.dependencies['dsh-user-plugin']).toBe('1.2.3')
    expect(manifest.dsh.profile.bundles).not.toContain('dshmarket')
    expect(manifest.dsh.profile.bundles).not.toContain('@changfenhuang/dsh-genui')
    expect(manifest.dsh.profile.bundles).toContain('dsh-user-plugin')
    expect(manifest.dependencies['dsh-prompt-enhance']).toBe('file:.insight-bundled-plugins/dsh-prompt-enhance-0.2.7.tgz')
    expect(await readFile(join(profile, 'node_modules', 'dsh-memory-evolve', 'lib', 'client.js'), 'utf8')).toBe('new memory\n')
    expect(await readFile(join(profile, 'node_modules', 'dsh-prompt-enhance', 'package.json'), 'utf8')).toContain('0.2.7')
    expect(await readFile(join(profile, '.insight-bundled-plugins', 'dsh-memory-evolve-0.1.0-insight.1.tgz'), 'utf8')).toBe('dsh-memory-evolve')
    expect(await readFile(join(profile, '.insight-bundled-plugins', 'dsh-prompt-enhance-0.2.7.tgz'), 'utf8')).toBe('dsh-prompt-enhance')
    await expect(readFile(join(profile, 'node_modules', 'dshmarket', 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(profile, 'node_modules', '@changfenhuang', 'dsh-genui', 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), 'utf8')).toBe('new bundle\n')
    expect(await isProfileInstallComplete(dshHome)).toBe(false)
  })

  it('repairs the retained Canvas archive without changing user data or enabling the plugin', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    const canvas = communityPlugins[2]
    await writeCurrentTemplate(template)
    await initializeBundledProfile(template, dshHome)
    const profile = join(dshHome, 'profiles', 'web')
    const archive = join(profile, '.insight-bundled-plugins', canvas.archive)
    await rm(archive)
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name: string) => name !== canvas.name)
    const contents = JSON.stringify(manifest, null, 2) + '\n'
    await writeFile(manifestPath, contents)
    await writeFile(join(profile, 'cordis.patch.yml'), '# user settings\n[]\n')
    await mkdir(join(dshHome, 'sessions'), { recursive: true })
    await writeFile(join(dshHome, 'sessions', 'saved.jsonl'), 'saved session\n')
    await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    await markProfileInstallComplete(dshHome)
    expect(await isProfileInstallComplete(dshHome)).toBe(true)

    await initializeBundledProfile(template, dshHome)
    expect(await readFile(archive, 'utf8')).toBe(canvas.name)
    expect(await readFile(manifestPath, 'utf8')).toBe(contents)
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('# user settings\n[]\n')
    expect(await readFile(join(dshHome, 'sessions', 'saved.jsonl'), 'utf8')).toBe('saved session\n')
    expect(await isProfileInstallComplete(dshHome)).toBe(false)
    await markProfileInstallComplete(dshHome)
    await initializeBundledProfile(template, dshHome)
    expect(await isProfileInstallComplete(dshHome)).toBe(true)
  })

  it.each(communityPlugins.flatMap(plugin =>
    (['absent', 'removed', 'user-upgraded', 'user-local-same-version'] as const).map(state => ({ plugin, state }))
  ))('reconciles $state $plugin.name in existing profiles', async ({ plugin, state }) => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    if (state === 'absent') await writeLegacyProfile(dshHome)
    else await initializeBundledProfile(template, dshHome)
    const profile = join(dshHome, 'profiles', 'web')
    const installed = join(profile, 'node_modules', plugin.name)
    const archive = join(profile, '.insight-bundled-plugins', plugin.archive)
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const userInstalled = state === 'user-upgraded' || state === 'user-local-same-version'
    const installedVersion = state === 'user-upgraded' ? '99.0.0' : plugin.version
    if (userInstalled) {
      manifest.dependencies[plugin.name] = 'file:/missing-download/user-plugin.tgz'
      if (plugin.name === 'dsh-prompt-enhance') await writeFile(join(installed, 'lib', 'client.js'), 'user client')
      await writeFile(join(installed, 'package.json'), JSON.stringify({ name: plugin.name, version: installedVersion }))
    } else {
      delete manifest.dependencies[plugin.name]
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name: string) => name !== plugin.name)
      await rm(installed, { recursive: true, force: true })
    }
    await rm(archive, { force: true })
    await writeFile(manifestPath, JSON.stringify(manifest))
    await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    await markProfileInstallComplete(dshHome)

    await initializeBundledProfile(template, dshHome)
    const refreshed = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(refreshed.dependencies[plugin.name]).toBe(userInstalled
      ? manifest.dependencies[plugin.name]
      : `file:.insight-bundled-plugins/${plugin.archive}`)
    expect(refreshed.dsh.profile.bundles).toContain(plugin.name)
    if (userInstalled) {
      expect(JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')).version).toBe(installedVersion)
      await expect(readFile(archive)).rejects.toMatchObject({ code: 'ENOENT' })
      if (plugin.name === 'dsh-prompt-enhance') expect(await readFile(join(installed, 'lib', 'client.js'), 'utf8')).toBe('user client')
    } else {
      expect(await readFile(archive, 'utf8')).toBe(plugin.name)
      await expect(readFile(join(installed, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    if (state !== 'absent') expect(await isProfileInstallComplete(dshHome)).toBe(userInstalled)
    const first = await readFile(manifestPath, 'utf8')
    await initializeBundledProfile(template, dshHome)
    expect(await readFile(manifestPath, 'utf8')).toBe(first)
  })

  it.each(['devDependencies', 'optionalDependencies'] as const)('preserves replacement plugins in %s', async (field) => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    await initializeBundledProfile(template, dshHome)
    const profile = join(dshHome, 'profiles', 'web')
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest[field] = {}
    for (const plugin of communityPlugins) {
      delete manifest.dependencies[plugin.name]
      manifest[field][plugin.name] = 'file:./user-plugin.tgz'
      await writeFile(join(profile, 'node_modules', plugin.name, 'package.json'), JSON.stringify({ version: plugin.version }))
    }
    const contents = JSON.stringify(manifest, null, 2) + '\n'
    await writeFile(manifestPath, contents)
    await initializeBundledProfile(template, dshHome)
    expect(await readFile(manifestPath, 'utf8')).toBe(contents)
  })

  it('installs a new template default in a custom Profile through startup repair without replacing user data', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    await initializeBundledProfile(template, dshHome)
    const profile = join(dshHome, 'profiles', 'web')
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.insightDesktop
    manifest.dependencies['user-plugin'] = '1.2.3'
    await writeFile(manifestPath, JSON.stringify(manifest))
    await writeFile(join(profile, 'pnpm-lock.yaml'), 'user lock')
    await writeFile(join(profile, 'cordis.patch.yml'), '# user config\n[]\n')
    await mkdir(join(dshHome, 'sessions'), { recursive: true })
    await writeFile(join(dshHome, 'sessions', 'saved.jsonl'), 'user session')
    await markProfileInstallComplete(dshHome)

    const name = 'new-bundled-plugin'
    const archive = 'new-bundled-plugin-1.0.0.tgz'
    const templatePath = join(template, 'web', 'package.json')
    const defaults = JSON.parse(await readFile(templatePath, 'utf8'))
    defaults.dependencies[name] = `file:.insight-bundled-plugins/${archive}`
    defaults.dsh.profile.bundles.push(name)
    await writeFile(templatePath, JSON.stringify(defaults))
    await writeFile(join(template, 'web', '.insight-bundled-plugins', archive), 'new archive')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    const updated = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(updated.dependencies[name]).toBe(defaults.dependencies[name])
    expect(updated.dependencies['user-plugin']).toBe('1.2.3')
    expect(updated.dsh.profile.bundles).toContain(name)
    expect(await readFile(join(profile, '.insight-bundled-plugins', archive), 'utf8')).toBe('new archive')
    expect(await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8')).toBe('user lock')
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('# user config\n[]\n')
    expect(await readFile(join(dshHome, 'sessions', 'saved.jsonl'), 'utf8')).toBe('user session')
    expect(await isProfileInstallComplete(dshHome)).toBe(false)
    let installs = 0
    const install = async () => {
      installs++
      await mkdir(join(profile, 'node_modules', name), { recursive: true })
      await writeFile(join(profile, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
      return { ok: true }
    }
    expect(await repairProfilePackages({ dshHome, install, note: () => {} })).toEqual({ ok: true })
    expect(await isProfileInstallComplete(dshHome)).toBe(true)
    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(false)
    await repairProfilePackages({ dshHome, install, note: () => {} })
    expect(installs).toBe(1)
  })

  it('retries a failed archive copy and detects missing files in an otherwise complete install', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    const plugin = communityPlugins[2]
    await writeCurrentTemplate(template)
    await initializeBundledProfile(template, dshHome)
    const profile = join(dshHome, 'profiles', 'web')
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.dependencies[plugin.name]
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name: string) => name !== plugin.name)
    const contents = JSON.stringify(manifest)
    await writeFile(manifestPath, contents)
    await writeFile(join(profile, 'pnpm-lock.yaml'), 'user lock')
    await markProfileInstallComplete(dshHome)
    const sourceArchive = join(template, 'web', '.insight-bundled-plugins', plugin.archive)
    await rm(sourceArchive)
    await expect(initializeBundledProfile(template, dshHome)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await isProfileInstallComplete(dshHome)).toBe(false)
    expect(await readFile(manifestPath, 'utf8')).toBe(contents)
    await writeFile(sourceArchive, plugin.name)
    await initializeBundledProfile(template, dshHome)
    await markProfileInstallComplete(dshHome)
    expect(await isProfileInstallComplete(dshHome)).toBe(true)
    await rm(join(profile, 'node_modules', plugin.name), { recursive: true, force: true })
    await initializeBundledProfile(template, dshHome)
    expect(await isProfileInstallComplete(dshHome)).toBe(false)
  })

  it.each([7, 8])('upgrades managed prompt-enhance 0.2.1 in Profile generation %s', async (version) => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    const profile = await writeLegacyProfile(dshHome)
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.insightDesktop.defaultProfileVersion = version
    manifest.dependencies['dsh-prompt-enhance'] = 'file:.insight-bundled-plugins/dsh-prompt-enhance-0.2.1.tgz'
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')
    await writeFile(join(profile, 'node_modules', 'dsh-prompt-enhance', 'package.json'), JSON.stringify({
      name: 'dsh-prompt-enhance', version: '0.2.1'
    }), 'utf8')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).dependencies['dsh-prompt-enhance'])
      .toBe('file:.insight-bundled-plugins/dsh-prompt-enhance-0.2.7.tgz')
    expect(JSON.parse(await readFile(join(profile, 'node_modules', 'dsh-prompt-enhance', 'package.json'), 'utf8')).version)
      .toBe('0.2.7')
    await expect(readFile(join(profile, '.insight-bundled-plugins', 'dsh-memory-evolve-0.1.0-insight.1.tgz'), 'utf8')).resolves.toBe('dsh-memory-evolve')
    await expect(readFile(join(profile, '.insight-bundled-plugins', 'dsh-prompt-enhance-0.2.7.tgz'), 'utf8')).resolves.toBe('dsh-prompt-enhance')
    await expect(isProfileInstallComplete(dshHome)).resolves.toBe(false)
  })

  it('retires normalized market versions in managed profiles and preserves unrelated plugins', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    const profile = await writeLegacyProfile(dshHome)
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dependencies.dshmarket = '2.0.0'
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')
    await writeFile(join(profile, 'node_modules', 'dshmarket', 'package.json'), JSON.stringify({ name: 'dshmarket', version: '2.0.0' }), 'utf8')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    const migrated = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(migrated.dependencies.dshmarket).toBeUndefined()
    expect(migrated.dsh.profile.bundles).not.toContain('dshmarket')
    await expect(readFile(join(profile, 'node_modules', 'dshmarket', 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(migrated.dependencies['dsh-user-plugin']).toBe('1.2.3')
  })

  it.each([2, 3, 4, 5, 6, 7])('migrates managed generation %s to Profile version 8', async (version) => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    const profile = await writeLegacyProfile(dshHome)
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.insightDesktop.defaultProfileVersion = version
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    const migrated = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(migrated.insightDesktop.defaultProfileVersion).toBe(8)
    expect(migrated.dependencies.dshmarket).toBeUndefined()
  })

  it('cleans a partially installed GenUI and stale locks, and can run twice', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    const profile = await writeLegacyProfile(dshHome)
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.insightDesktop.defaultProfileVersion = 7
    manifest.dependencies['@changfenhuang/dsh-genui'] = '^0.9.8'
    await writeFile(manifestPath, JSON.stringify(manifest))
    await rm(join(profile, 'node_modules', '@changfenhuang', 'dsh-genui', 'package.json'))
    await writeFile(join(profile, 'pnpm-lock.yaml'), 'obsolete lock')
    await writeFile(join(profile, 'cordis.patch.yml'), '- insert:\n    - name: "@changfenhuang/dsh-genui"\n    - name: dsh-user-plugin\n')
    await initializeBundledProfile(template, dshHome)
    const first = await readFile(manifestPath, 'utf8')
    await initializeBundledProfile(template, dshHome)
    expect(await readFile(manifestPath, 'utf8')).toBe(first)
    expect(first).not.toContain('genui')
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).not.toContain('genui')
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toContain('dsh-user-plugin')
    await expect(readFile(join(profile, 'pnpm-lock.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('marks a copied packaged profile complete', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await mkdir(join(template, 'web'), { recursive: true })
    await writeFile(join(template, 'web', 'package.json'), '{"name":"web-profile"}', 'utf8')
    await writeFile(join(template, 'web', 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    await expect(isProfileInstallComplete(dshHome)).resolves.toBe(true)
  })

  it('refuses to replace a corrupt existing Profile with the default template', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    await initializeBundledProfile(template, dshHome)
    const profile = join(dshHome, 'profiles', 'web')
    await writeFile(join(profile, 'package.json'), '{"dependencies":')
    await writeFile(join(profile, 'cordis.patch.yml'), '# user configuration\n')
    await expect(initializeBundledProfile(template, dshHome)).rejects.toThrow('manifest could not be read')
    expect(await readFile(join(profile, 'package.json'), 'utf8')).toBe('{"dependencies":')
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('# user configuration\n')
  })

  it('refreshes the installed desktop integration client on a same-version upgrade', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template, 'old bundle\n')
    const installedClient = join('web', 'node_modules', '@insight-ai', 'desktop-integration', 'lib', 'client.js')
    await mkdir(join(template, 'web', 'node_modules', '@insight-ai', 'desktop-integration', 'lib'), { recursive: true })
    await writeFile(join(template, installedClient), 'old bundle\n')
    await initializeBundledProfile(template, dshHome)

    await writeFile(join(template, 'web', 'packages', 'insight-desktop-integration', 'lib', 'client.js'), 'new bundle\n')
    await writeFile(join(template, installedClient), 'new bundle\n')
    await initializeBundledProfile(template, dshHome)

    const profile = join(dshHome, 'profiles', 'web')
    expect(await readFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), 'utf8')).toBe('new bundle\n')
    expect(await readFile(join(profile, 'node_modules', '@insight-ai', 'desktop-integration', 'lib', 'client.js'), 'utf8')).toBe('new bundle\n')
  })

  it('refreshes only the desktop integration in a newer Profile without downgrading user data', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template, 'old bundle\n')
    const installed = join('node_modules', '@insight-ai', 'desktop-integration')
    await mkdir(join(template, 'web', installed, 'lib'), { recursive: true })
    await writeFile(join(template, 'web', installed, 'package.json'), '{"peerDependencies":{"@deepseek-ai/dsh-llm":"old"}}')
    await writeFile(join(template, 'web', installed, 'lib/client.js'), 'old bundle\n')
    await initializeBundledProfile(template, dshHome)
    const profile = join(dshHome, 'profiles/web')
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.insightDesktop = { defaultProfileVersion: 9, futureSetting: true }
    manifest.dependencies['user-plugin'] = 'file:./user-plugin.tgz'
    manifest.dsh.profile.bundles.push('user-plugin')
    await writeFile(manifestPath, JSON.stringify(manifest))
    const preserved = [
      ['package.json', JSON.stringify(manifest)],
      ['pnpm-lock.yaml', 'user lock'],
      ['pnpm-workspace.yaml', 'user workspace'],
      ['cordis.patch.yml', 'user patch'],
      ['node_modules/user-plugin/state.json', 'user plugin data'],
      ['../../sessions/session.v4.jsonl', 'committed session data']
    ] as const
    for (const [path, contents] of preserved) {
      await mkdir(join(profile, path, '..'), { recursive: true })
      await writeFile(join(profile, path), contents)
    }
    await markProfileInstallComplete(dshHome)
    await writeFile(join(template, 'web', 'packages/insight-desktop-integration/lib/client.js'), 'new bundle\n')
    await writeFile(join(template, 'web', installed, 'lib/client.js'), 'new bundle\n')
    await writeFile(join(template, 'web', installed, 'package.json'), '{"peerDependencies":{"@deepseek-ai/dsh-llm":"new"}}')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    for (const [path, contents] of preserved) expect(await readFile(join(profile, path), 'utf8')).toBe(contents)
    expect(await readFile(join(profile, 'packages/insight-desktop-integration/lib/client.js'), 'utf8')).toBe('new bundle\n')
    expect(await readFile(join(profile, installed, 'lib/client.js'), 'utf8')).toBe('new bundle\n')
    expect(await readFile(join(profile, installed, 'package.json'), 'utf8')).toContain('"new"')
    await expect(isProfileInstallComplete(dshHome)).resolves.toBe(true)
  })

  it('fills missing Canvas in generation nine while preserving replacement plugins and user configuration', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    const canvas = communityPlugins[2]
    await writeCurrentTemplate(template)
    await initializeBundledProfile(template, dshHome)
    const profile = join(dshHome, 'profiles', 'web')
    const path = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.insightDesktop = { defaultProfileVersion: 9, futureSetting: true }
    delete manifest.dependencies[canvas.name]
    manifest.dependencies['dsh-memory-evolve'] = 'file:./user-memory.tgz'
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name: string) =>
      name !== canvas.name && name !== 'dsh-memory-evolve')
    await writeFile(path, JSON.stringify(manifest))
    await rm(join(profile, 'node_modules', canvas.name), { recursive: true, force: true })
    await rm(join(profile, '.insight-bundled-plugins', canvas.archive))
    await writeFile(join(profile, 'pnpm-lock.yaml'), 'user lock')
    await writeFile(join(profile, 'cordis.patch.yml'), '# user patch\n[]\n')
    await markProfileInstallComplete(dshHome)
    expect(await isProfileInstallComplete(dshHome)).toBe(true)

    await initializeBundledProfile(template, dshHome)
    const updated = JSON.parse(await readFile(path, 'utf8'))
    expect(updated.insightDesktop).toEqual(manifest.insightDesktop)
    expect(updated.dependencies['dsh-memory-evolve']).toBe('file:./user-memory.tgz')
    expect(updated.dsh.profile.bundles).not.toContain('dsh-memory-evolve')
    expect(updated.dependencies[canvas.name]).toBe(`file:.insight-bundled-plugins/${canvas.archive}`)
    expect(updated.dsh.profile.bundles).toContain(canvas.name)
    expect(await readFile(join(profile, '.insight-bundled-plugins', canvas.archive), 'utf8')).toBe(canvas.name)
    expect(await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8')).toBe('user lock')
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('# user patch\n[]\n')
    expect(await isProfileInstallComplete(dshHome)).toBe(false)
  })

  it('preserves an unknown future Profile without adding older defaults', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    const profile = join(dshHome, 'profiles/web')
    await mkdir(profile, { recursive: true })
    const contents = JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } }, insightDesktop: { defaultProfileVersion: 10 } })
    await writeFile(join(profile, 'package.json'), contents)
    await writeFile(join(profile, 'pnpm-lock.yaml'), 'future lock')
    await writeFile(join(profile, 'cordis.patch.yml'), 'future patch')
    await markProfileInstallComplete(dshHome)
    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(false)
    expect(await readFile(join(profile, 'package.json'), 'utf8')).toBe(contents)
    expect(await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8')).toBe('future lock')
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('future patch')
    expect(await isProfileInstallComplete(dshHome)).toBe(true)
  })

  it('adds missing defaults to a compatible newer Profile without downgrading its schema', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    await mkdir(join(dshHome, 'profiles/web'), { recursive: true })
    const path = join(dshHome, 'profiles/web/package.json')
    const contents = JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } }, insightDesktop: { defaultProfileVersion: 9 } })
    await writeFile(path, contents)
    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    const updated = JSON.parse(await readFile(path, 'utf8'))
    expect(updated.insightDesktop.defaultProfileVersion).toBe(9)
    expect(updated.dependencies['@insight-ai/desktop-integration']).toBe('workspace:*')
    for (const plugin of communityPlugins) {
      expect(updated.dependencies[plugin.name]).toBe(`file:.insight-bundled-plugins/${plugin.archive}`)
      expect(updated.dsh.profile.bundles).toContain(plugin.name)
      expect(await readFile(join(dshHome, 'profiles/web/.insight-bundled-plugins', plugin.archive), 'utf8')).toBe(plugin.name)
    }
    expect(await isProfileInstallComplete(dshHome)).toBe(false)
    const first = await readFile(path, 'utf8')
    await initializeBundledProfile(template, dshHome)
    expect(await readFile(path, 'utf8')).toBe(first)
  })
})
