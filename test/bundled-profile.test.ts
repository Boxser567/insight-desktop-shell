import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeBundledProfile } from '../src/main/state/bundled-profile'
import { isProfileInstallComplete } from '../src/main/state/profile-install-marker'

const communityPlugins = [
  { name: 'dsh-memory-evolve', version: '0.1.0', archive: 'dsh-memory-evolve-0.1.0.tgz' },
  { name: '@changfenhuang/dsh-genui', version: '0.9.8', archive: 'changfenhuang-dsh-genui-0.9.8.tgz' },
  { name: 'dsh-prompt-enhance', version: '0.1.9', archive: 'dsh-prompt-enhance-0.1.9.tgz' }
] as const

describe('bundled profile initialization', () => {
  const testDir = join(__dirname, '.temp-bundled-profile-test')

  async function writeVersionThreeTemplate(template: string, clientBundle = 'bundle\n'): Promise<void> {
    const profile = join(template, 'web')
    await mkdir(join(profile, 'packages', 'insight-desktop-integration', 'lib'), { recursive: true })
    await writeFile(
      join(profile, 'package.json'),
      JSON.stringify({
        dependencies: {
          'dsh-better-sidebar': '0.16.1',
          dshmarket: '1.41.0',
          ...Object.fromEntries(communityPlugins.map((plugin) => [
            plugin.name,
            `file:.insight-bundled-plugins/${plugin.archive}`
          ])),
          '@insight-ai/desktop-integration': 'workspace:*'
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              'dsh-better-sidebar',
              'dshmarket',
              ...communityPlugins.map((plugin) => plugin.name),
              '@insight-ai/desktop-integration'
            ]
          }
        },
        insightDesktop: { defaultProfileVersion: 3 }
      }),
      'utf8'
    )
    await writeFile(
      join(profile, 'packages', 'insight-desktop-integration', 'package.json'),
      JSON.stringify({ name: '@insight-ai/desktop-integration' }),
      'utf8'
    )
    for (const plugin of communityPlugins) {
      const installed = join(profile, 'node_modules', ...plugin.name.split('/'))
      await mkdir(installed, { recursive: true })
      await writeFile(
        join(installed, 'package.json'),
        JSON.stringify({ name: plugin.name, version: plugin.version }),
        'utf8'
      )
      await mkdir(join(profile, '.insight-bundled-plugins'), { recursive: true })
      await writeFile(join(profile, '.insight-bundled-plugins', plugin.archive), plugin.name, 'utf8')
    }
    await writeFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), clientBundle, 'utf8')
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n  - packages/*\n', 'utf8')
  }

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('copies the packaged web profile only for a new Harness home', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await writeVersionThreeTemplate(template)

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    const initialized = JSON.parse(
      await readFile(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8')
    )
    expect(initialized.dependencies.dshmarket).toBe('1.41.0')
    expect(initialized.dsh.profile.bundles).toContain('dshmarket')
    for (const plugin of communityPlugins) {
      expect(initialized.dependencies[plugin.name]).toBe(
        `file:.insight-bundled-plugins/${plugin.archive}`
      )
      expect(initialized.dsh.profile.bundles).toContain(plugin.name)
      expect(await readFile(
        join(dshHome, 'profiles', 'web', '.insight-bundled-plugins', plugin.archive),
        'utf8'
      )).toBe(plugin.name)
    }

    await writeFile(join(dshHome, 'profiles', 'web', 'package.json'), '{"name":"user-profile"}', 'utf8')
    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(false)
    expect(await readFile(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8')).toContain('user-profile')
  })

  it('upgrades only an uncustomized legacy default profile', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    const profile = join(dshHome, 'profiles', 'web')
    await writeVersionThreeTemplate(template)
    await mkdir(profile, { recursive: true })
    await writeFile(
      join(profile, 'package.json'),
      JSON.stringify({
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
        insightDesktop: { defaultProfileVersion: 1 }
      }),
      'utf8'
    )

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    expect(await readFile(join(profile, 'package.json'), 'utf8')).toContain('dsh-better-sidebar')
    expect(await readFile(join(profile, 'package.json'), 'utf8')).toContain('dsh-memory-evolve')

    await writeFile(
      join(profile, 'package.json'),
      JSON.stringify({
        dependencies: { 'dsh-user-plugin': '1.0.0' },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-user-plugin'] } }
      }),
      'utf8'
    )
    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(false)
    expect(await readFile(join(profile, 'package.json'), 'utf8')).toContain('dsh-user-plugin')
  })

  it('adds the installation-owned bundle to a customized version two profile', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    const profile = join(dshHome, 'profiles', 'web')
    await writeVersionThreeTemplate(template)
    await mkdir(profile, { recursive: true })
    const patch = '- id: user-plugin\n  disabled: true\n'
    await writeFile(
      join(profile, 'package.json'),
      JSON.stringify({
        dependencies: {
          'dsh-better-sidebar': '0.16.1',
          'user-plugin': '1.2.3'
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              'dsh-better-sidebar',
              'user-plugin'
            ]
          }
        },
        insightDesktop: { defaultProfileVersion: 2 }
      }),
      'utf8'
    )
    await writeFile(join(profile, 'cordis.patch.yml'), patch, 'utf8')
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n', 'utf8')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)

    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({
      'dsh-better-sidebar': '0.16.1',
      'user-plugin': '1.2.3',
      '@insight-ai/desktop-integration': 'workspace:*'
    })
    expect(manifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-better-sidebar',
      'user-plugin',
      '@insight-ai/desktop-integration'
    ])
    expect(manifest.insightDesktop.defaultProfileVersion).toBe(3)
    for (const plugin of communityPlugins) {
      expect(manifest.dependencies).not.toHaveProperty(plugin.name)
      expect(manifest.dsh.profile.bundles).not.toContain(plugin.name)
    }
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    expect(await readFile(join(profile, 'pnpm-workspace.yaml'), 'utf8')).toContain('packages/*')
    expect(await readFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), 'utf8')).toBe('bundle\n')
  })

  it('refreshes the installation-owned bundle in an existing version three profile', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    const profile = join(dshHome, 'profiles', 'web')
    await writeVersionThreeTemplate(template, 'new bundle\n')
    await mkdir(join(profile, 'packages', 'insight-desktop-integration', 'lib'), { recursive: true })
    const patch = '- id: user-plugin\n  disabled: true\n'
    await writeFile(
      join(profile, 'package.json'),
      JSON.stringify({
        dependencies: {
          'dsh-better-sidebar': '0.16.1',
          'user-plugin': '1.2.3',
          '@insight-ai/desktop-integration': 'workspace:*'
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              'dsh-better-sidebar',
              'user-plugin',
              '@insight-ai/desktop-integration'
            ]
          }
        },
        insightDesktop: { defaultProfileVersion: 3 }
      }),
      'utf8'
    )
    await writeFile(join(profile, 'cordis.patch.yml'), patch, 'utf8')
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n  - packages/*\n', 'utf8')
    await writeFile(join(profile, 'packages', 'insight-desktop-integration', 'package.json'), '{}', 'utf8')
    await writeFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), 'old bundle\n', 'utf8')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)

    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    expect(manifest.dependencies['user-plugin']).toBe('1.2.3')
    expect(manifest.dsh.profile.bundles).toContain('user-plugin')
    expect(manifest.dependencies).not.toHaveProperty('dshmarket')
    expect(manifest.dsh.profile.bundles).not.toContain('dshmarket')
    for (const plugin of communityPlugins) {
      expect(manifest.dependencies).not.toHaveProperty(plugin.name)
      expect(manifest.dsh.profile.bundles).not.toContain(plugin.name)
    }
    expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    expect(await readFile(join(profile, 'packages', 'insight-desktop-integration', 'lib', 'client.js'), 'utf8')).toBe('new bundle\n')
  })

  it('marks a copied packaged profile complete without reinstalling its dependencies', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    const profile = join(template, 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), '{"name":"web-profile"}', 'utf8')
    await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    await expect(isProfileInstallComplete(dshHome)).resolves.toBe(true)
  })
})
