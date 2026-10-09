import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectPluginRecovery } from '../src/main/plugin-recovery-detection'
import { extractSlotConflictName } from '../src/main/runtime/harness-runtime'
import {
  profilePackageJsonPath,
  resolveProfileRecoveryPlugins
} from '../src/main/state/plugin-recovery'

describe('plugin recovery detection', () => {
  const testDir = join(__dirname, '.temp-plugin-recovery-detection-test')
  const pluginDir = join(testDir, 'profiles', 'web', 'node_modules', 'conflicting-plugin')

  beforeEach(async () => {
    await mkdir(join(pluginDir, 'lib'), { recursive: true })
    await writeFile(
      profilePackageJsonPath(testDir),
      JSON.stringify({
        dependencies: {
          'conflicting-plugin': '^1.0.0'
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              'conflicting-plugin'
            ]
          }
        }
      })
    )
    await writeFile(
      join(pluginDir, 'lib', 'client.js'),
      'ctx.slot("conversation.hero.workspace.directoryFlow", component);'
    )
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('attributes a rejected Core dependency to the installed plugin that brought it into the profile', async () => {
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh-tools': '0.1.6-alpha.2' }
    }))
    const detection = await detectPluginRecovery({
      dshHome: testDir,
      initialLogs: [
        '[stderr] dsh: disabling profile plugin row "tools": Plugin @deepseek-ai/dsh-tools@0.1.6-alpha.2 is incompatible with dsh 0.2.1-alpha.1: peerDependencies {}.',
        '[stderr] dsh: startup failed: 1 required plugin did not activate'
      ]
    })
    expect(detection.plugins).toEqual(['conflicting-plugin'])
  })

  it('does not offer removal of a Core package without a configured third-party owner', async () => {
    const detection = await detectPluginRecovery({
      dshHome: testDir,
      initialLogs: [
        '[stderr] dsh: disabling profile plugin row "tools": Plugin @deepseek-ai/dsh-tools@0.1.6-alpha.2 is incompatible with dsh 0.2.1-alpha.1: peerDependencies {}.'
      ]
    })
    expect(detection.plugins).toEqual([])
  })

  it('attributes a missing local archive in profile repair to its declared plugin', async () => {
    const archive = join(testDir, 'deleted-source.tgz')
    await writeFile(profilePackageJsonPath(testDir), JSON.stringify({
      dependencies: { 'conflicting-plugin': `file:${archive}` },
      dsh: { profile: { bundles: ['conflicting-plugin'] } }
    }))
    const detection = await detectPluginRecovery({
      dshHome: testDir,
      initialLogs: [],
      message: `ENOENT: no such file or directory, open '${archive}'`
    })
    expect(detection.plugins).toEqual(['conflicting-plugin'])
  })

  it('does not attribute an unrelated missing file to a local archive plugin', async () => {
    const archive = join(testDir, 'deleted-source.tgz')
    await writeFile(profilePackageJsonPath(testDir), JSON.stringify({
      dependencies: { 'conflicting-plugin': `file:${archive}` },
      dsh: { profile: { bundles: ['conflicting-plugin'] } }
    }))
    expect((await detectPluginRecovery({
      dshHome: testDir,
      initialLogs: [],
      message: `ENOENT: no such file or directory, open '${archive}.other'`
    })).plugins).toEqual([])
  })

  it('resolves relative archive dependencies from the profile directory', async () => {
    const archive = join(testDir, 'profiles', 'web', 'downloads', 'plugin.tgz')
    await writeFile(profilePackageJsonPath(testDir), JSON.stringify({
      dependencies: { '@example/plugin': 'file:downloads/plugin.tgz' },
      dsh: { profile: { bundles: ['@example/plugin'] } }
    }))
    const detection = await detectPluginRecovery({
      dshHome: testDir,
      initialLogs: [],
      message: `ENOENT: no such file or directory, open "${archive}"`
    })
    expect(detection.plugins).toEqual(['@example/plugin'])
  })

  it('retries unresolved frontend evidence and identifies a plugin from a later console error', async () => {
    let currentTime = 0
    let liveLogs: string[] = []
    let waits = 0

    const detection = await detectPluginRecovery({
      dshHome: testDir,
      initialLogs: [
        '[stderr] Failed to load plugins\n@deepseek-ai/dsh-client-ui-directory-picker-browse'
      ],
      readLatestLogs: () => liveLogs,
      timeoutMs: 1_000,
      pollIntervalMs: 100,
      now: () => currentTime,
      wait: async (milliseconds) => {
        waits += 1
        currentTime += milliseconds
        liveLogs = [
          '[stderr] single slot "conversation.hero.workspace.directoryFlow" already has a registration at priority 0'
        ]
      }
    })

    expect(waits).toBe(1)
    expect(detection.plugins).toEqual(['conflicting-plugin'])
    expect(detection.logs).toContain(liveLogs[0])
  })

  it('stops retrying at the deadline when no direct evidence arrives', async () => {
    let currentTime = 0
    let waits = 0

    const detection = await detectPluginRecovery({
      dshHome: testDir,
      initialLogs: ['[stderr] Failed to load plugins'],
      readLatestLogs: () => [],
      timeoutMs: 250,
      pollIntervalMs: 100,
      now: () => currentTime,
      wait: async (milliseconds) => {
        waits += 1
        currentTime += milliseconds
      }
    })

    expect(waits).toBe(3)
    expect(detection.plugins).toEqual([])
  })

  it('attributes a generic slot conflict to a bundle that dynamically loads its provider', async () => {
    const profileDirectory = join(testDir, 'profiles', 'web')
    const remotePluginDirectory = join(profileDirectory, 'node_modules', 'dsh-full-remote')
    const unrelatedPluginDirectory = join(profileDirectory, 'node_modules', 'unrelated-plugin')
    const coreNodeModules = join(testDir, 'app-node_modules')
    const browseProviderDirectory = join(
      coreNodeModules,
      '@deepseek-ai',
      'dsh-client-ui-directory-picker-browse',
      'lib'
    )

    await mkdir(remotePluginDirectory, { recursive: true })
    await mkdir(unrelatedPluginDirectory, { recursive: true })
    await mkdir(browseProviderDirectory, { recursive: true })
    await writeFile(
      profilePackageJsonPath(testDir),
      JSON.stringify({
        dependencies: {
          'dsh-full-remote': '^0.3.5',
          'unrelated-plugin': '^1.0.0'
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              'dsh-full-remote',
              'unrelated-plugin'
            ]
          }
        }
      })
    )
    await writeFile(
      join(remotePluginDirectory, 'package.json'),
      JSON.stringify({ name: 'dsh-full-remote' })
    )
    await writeFile(
      join(remotePluginDirectory, 'index.js'),
      'const BROWSE_UI_PACKAGE = "@deepseek-ai/dsh-client-ui-directory-picker-browse";'
    )
    await writeFile(
      join(unrelatedPluginDirectory, 'package.json'),
      JSON.stringify({ name: 'unrelated-plugin' })
    )
    await writeFile(
      join(browseProviderDirectory, 'client.js'),
      'ctx.slots.inject("conversation.hero.workspace.directoryFlow", register);'
    )

    const logs = [
      '[stderr] UI slot "conversation.hero.workspace.directoryFlow" has duplicate registrations from conflicting plugins.'
    ]
    const slotName = extractSlotConflictName(logs)
    expect(slotName).toBe('conversation.hero.workspace.directoryFlow')
    await expect(
      resolveProfileRecoveryPlugins(testDir, [], undefined, slotName, [], [coreNodeModules])
    ).resolves.toEqual(['dsh-full-remote'])

    const detection = await detectPluginRecovery({
      dshHome: testDir,
      initialLogs: logs,
      slotProviderNodeModulesPaths: [coreNodeModules]
    })

    expect(detection.plugins).toEqual(['dsh-full-remote'])
  })

  it('attributes a reported leaf package without relying on app node_modules discovery', async () => {
    const profileDirectory = join(testDir, 'profiles', 'web')
    const dynamicPluginDirectory = join(profileDirectory, 'node_modules', 'dynamic-plugin')

    await mkdir(join(dynamicPluginDirectory, 'lib'), { recursive: true })
    await writeFile(
      profilePackageJsonPath(testDir),
      JSON.stringify({
        dependencies: {
          'dynamic-plugin': '^1.0.0'
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              'dynamic-plugin'
            ]
          }
        }
      })
    )
    await writeFile(
      join(dynamicPluginDirectory, 'package.json'),
      JSON.stringify({ name: 'dynamic-plugin' })
    )
    await writeFile(
      join(dynamicPluginDirectory, 'lib', 'index.js'),
      'const UI_PACKAGE = "@deepseek-ai/dsh-client-ui-directory-picker-browse";'
    )

    const logs = [
      '[stderr] failed to apply loader entry abc123 (@deepseek-ai/dsh-client-ui-directory-picker-browse): single slot "conversation.hero.workspace.directoryFlow" already has a registration'
    ]
    const detection = await detectPluginRecovery({
      dshHome: testDir,
      initialLogs: logs
    })

    expect(detection.plugins).toEqual(['dynamic-plugin'])
  })
})
