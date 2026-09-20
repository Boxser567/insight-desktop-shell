import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeBundledProfile } from '../src/main/state/bundled-profile'
import { isProfileInstallComplete } from '../src/main/state/profile-install-marker'

const communityPlugins = [
  { name: 'dsh-memory-evolve', version: '0.1.0', archive: 'dsh-memory-evolve-0.1.0.tgz' },
  { name: 'dsh-prompt-enhance', version: '0.2.1', archive: 'dsh-prompt-enhance-0.2.1.tgz' }
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
      insightDesktop: { defaultProfileVersion: 7 }
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
      'const imageCount = useInput((state) => state.attachmentIds.length);\nbody:not([data-ds-dark-theme]) .dsh-pe-panel {\n  color: black;\n}\n',
      'utf8'
    )
    await writeFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), clientBundle, 'utf8')
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
    expect(manifest.insightDesktop.defaultProfileVersion).toBe(7)
    expect(manifest.dependencies).not.toHaveProperty('dshmarket')
    expect(manifest.dependencies).not.toHaveProperty('@changfenhuang/dsh-genui')
    expect(manifest.dsh.profile.bundles).not.toContain('dshmarket')
    expect(manifest.dsh.profile.bundles).not.toContain('@changfenhuang/dsh-genui')
    for (const plugin of communityPlugins) {
      expect(manifest.dependencies[plugin.name]).toBe(`file:.insight-bundled-plugins/${plugin.archive}`)
      expect(await readFile(join(profile, '.insight-bundled-plugins', plugin.archive), 'utf8')).toBe(plugin.name)
    }

    await writeFile(join(profile, 'package.json'), '{"name":"user-profile"}', 'utf8')
    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(false)
    expect(await readFile(join(profile, 'package.json'), 'utf8')).toContain('user-profile')
  })

  it('migrates the old managed Profile and preserves user plugins', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template, 'new bundle\n')
    const profile = await writeLegacyProfile(dshHome)

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    expect(manifest.insightDesktop.defaultProfileVersion).toBe(7)
    expect(manifest.dependencies.dshmarket).toBeUndefined()
    expect(manifest.dependencies['@changfenhuang/dsh-genui']).toBeUndefined()
    expect(manifest.dependencies['dsh-better-sidebar']).toBeUndefined()
    expect(manifest.dependencies['dsh-user-plugin']).toBe('1.2.3')
    expect(manifest.dsh.profile.bundles).not.toContain('dshmarket')
    expect(manifest.dsh.profile.bundles).not.toContain('@changfenhuang/dsh-genui')
    expect(manifest.dsh.profile.bundles).toContain('dsh-user-plugin')
    expect(manifest.dependencies['dsh-prompt-enhance']).toBe('file:.insight-bundled-plugins/dsh-prompt-enhance-0.2.1.tgz')
    expect(await readFile(join(profile, 'node_modules', 'dsh-memory-evolve', 'lib', 'client.js'), 'utf8')).toBe('new memory\n')
    expect(await readFile(join(profile, 'node_modules', 'dsh-prompt-enhance', 'package.json'), 'utf8')).toContain('0.2.1')
    expect(await readFile(join(profile, '.insight-bundled-plugins', 'dsh-memory-evolve-0.1.0.tgz'), 'utf8')).toBe('dsh-memory-evolve')
    expect(await readFile(join(profile, '.insight-bundled-plugins', 'dsh-prompt-enhance-0.2.1.tgz'), 'utf8')).toBe('dsh-prompt-enhance')
    await expect(readFile(join(profile, 'node_modules', 'dshmarket', 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(profile, 'node_modules', '@changfenhuang', 'dsh-genui', 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), 'utf8')).toBe('new bundle\n')
    expect(await isProfileInstallComplete(dshHome)).toBe(false)
  })

  it('repairs missing managed archives in an already migrated profile', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeCurrentTemplate(template)
    const profile = await writeLegacyProfile(dshHome)
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.insightDesktop.defaultProfileVersion = 7
    manifest.dependencies['dsh-prompt-enhance'] = 'file:.insight-bundled-plugins/dsh-prompt-enhance-0.2.1.tgz'
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8')
    await writeFile(join(profile, 'node_modules', 'dsh-prompt-enhance', 'package.json'), JSON.stringify({
      name: 'dsh-prompt-enhance', version: '0.2.1'
    }), 'utf8')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    await expect(readFile(join(profile, '.insight-bundled-plugins', 'dsh-memory-evolve-0.1.0.tgz'), 'utf8')).resolves.toBe('dsh-memory-evolve')
    await expect(readFile(join(profile, '.insight-bundled-plugins', 'dsh-prompt-enhance-0.2.1.tgz'), 'utf8')).resolves.toBe('dsh-prompt-enhance')
    await expect(isProfileInstallComplete(dshHome)).resolves.toBe(false)
  })

  it('does not remove a user-managed market version', async () => {
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
    expect(migrated.dependencies.dshmarket).toBe('2.0.0')
    expect(migrated.dsh.profile.bundles).toContain('dshmarket')
    expect(await readFile(join(profile, 'node_modules', 'dshmarket', 'package.json'), 'utf8')).toContain('2.0.0')
  })

  it.each([2, 3, 4, 5])('migrates managed generation %s to Profile version 7', async (version) => {
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
    expect(migrated.insightDesktop.defaultProfileVersion).toBe(7)
    expect(migrated.dependencies.dshmarket).toBeUndefined()
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
})
