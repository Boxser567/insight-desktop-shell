import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  verifyBundledCommunityPlugin,
  type BundledCommunityPluginCommand,
  type BundledCommunityPluginVerifierDependencies
} from '../scripts/verify-bundled-community-plugin.mjs'

const PACKAGE_NAME = 'dsh-memory-evolve'
const PACKAGE_VERSION = '0.1.0'
const ARCHIVE_CONTENTS = Buffer.from('reviewed archive fixture')
const ARCHIVE_SHA256 = createHash('sha256').update(ARCHIVE_CONTENTS).digest('hex')

describe('bundled community plugin verifier', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ))
  })

  async function createProject(sha256 = ARCHIVE_SHA256): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'insight-plugin-verifier-test-'))
    temporaryDirectories.push(root)
    const artifact = 'vendor/plugins/dsh-memory-evolve-0.1.0.tgz'
    const requiredBuildFiles = [
      process.platform === 'win32'
        ? 'build/core-runtime/node_modules/node/bin/node.exe'
        : 'build/core-runtime/node_modules/node/bin/node',
      'build/core-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
      'build/core-runtime/node_modules/pnpm/bin/pnpm.cjs',
      'build/harness-node-entry.mjs',
      'build/dsh-desktop.patch.yml'
    ]
    for (const file of requiredBuildFiles) {
      await mkdir(dirname(join(root, file)), { recursive: true })
      await writeFile(join(root, file), '')
    }
    await mkdir(dirname(join(root, artifact)), { recursive: true })
    await writeFile(join(root, artifact), ARCHIVE_CONTENTS)
    await writeFile(
      join(root, 'vendor/plugins/bundled-community-plugins.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        plugins: [{
          packageName: PACKAGE_NAME,
          version: PACKAGE_VERSION,
          artifact,
          sha256,
          sourceRepository: 'https://example.test/memory.git',
          sourceRef: 'v0.1.0',
          sourceCommit: '1'.repeat(40)
        }]
      }, null, 2)}\n`
    )
    return root
  }

  async function writeInstalledProfile(
    home: string,
    overrides: { name?: string, version?: string, omitClient?: boolean } = {}
  ): Promise<void> {
    const profile = join(home, 'profiles', 'web')
    const installed = join(profile, 'node_modules', PACKAGE_NAME)
    await mkdir(join(installed, 'lib'), { recursive: true })
    await writeFile(
      join(profile, 'package.json'),
      JSON.stringify({
        dependencies: { [PACKAGE_NAME]: 'file:reviewed.tgz' },
        dsh: { profile: { bundles: [PACKAGE_NAME] } }
      })
    )
    await writeFile(
      join(installed, 'package.json'),
      JSON.stringify({
        name: overrides.name ?? PACKAGE_NAME,
        version: overrides.version ?? PACKAGE_VERSION
      })
    )
    await writeFile(join(installed, 'lib', 'index.js'), '')
    if (!overrides.omitClient) await writeFile(join(installed, 'lib', 'client.js'), '')
    await writeFile(join(installed, 'cordis.patch.yml'), '')
  }

  function successfulDependencies(
    commands: BundledCommunityPluginCommand[] = [],
    installedOverrides: { name?: string, version?: string, omitClient?: boolean } = {}
  ): BundledCommunityPluginVerifierDependencies {
    return {
      runDsh: async (command) => {
        commands.push(command)
        if (command.args.includes('install')) {
          await writeInstalledProfile(command.home, installedOverrides)
        }
      },
      runHarness: async () => {}
    }
  }

  it('rejects an unknown package before creating a disposable Profile', async () => {
    const root = await createProject()
    let created = false

    await expect(verifyBundledCommunityPlugin(root, 'missing-plugin', {
      makeTemporaryDirectory: async () => {
        created = true
        return join(root, 'unexpected')
      }
    })).rejects.toThrow('missing-plugin is not a bundled community plugin')
    expect(created).toBe(false)
  })

  it('rejects an archive digest mismatch', async () => {
    const root = await createProject('0'.repeat(64))

    await expect(verifyBundledCommunityPlugin(root, PACKAGE_NAME))
      .rejects.toThrow(`${PACKAGE_NAME} archive SHA-256 mismatch`)
  })

  it('rejects a packed name or version mismatch', async () => {
    const root = await createProject()

    await expect(verifyBundledCommunityPlugin(
      root,
      PACKAGE_NAME,
      successfulDependencies([], { name: 'different-plugin' })
    )).rejects.toThrow(`expected ${PACKAGE_NAME}@${PACKAGE_VERSION}, installed different-plugin@${PACKAGE_VERSION}`)
  })

  it('rejects a package missing a required browser entry', async () => {
    const root = await createProject()

    await expect(verifyBundledCommunityPlugin(
      root,
      PACKAGE_NAME,
      successfulDependencies([], { omitClient: true })
    )).rejects.toThrow(`${PACKAGE_NAME} is missing required entry lib/client.js`)
  })

  it('reports a DSH add failure', async () => {
    const root = await createProject()

    await expect(verifyBundledCommunityPlugin(root, PACKAGE_NAME, {
      runDsh: async () => { throw new Error('fixture add failure') },
      runHarness: async () => {}
    })).rejects.toThrow(`Could not add ${PACKAGE_NAME}: fixture add failure`)
  })

  it('reports a Harness plugin-load failure', async () => {
    const root = await createProject()

    await expect(verifyBundledCommunityPlugin(root, PACKAGE_NAME, {
      ...successfulDependencies(),
      runHarness: async () => { throw new Error('fixture plugin-load failure') }
    })).rejects.toThrow(`${PACKAGE_NAME} Harness boot failed: fixture plugin-load failure`)
  })

  it('removes the disposable DSH home after a failure', async () => {
    const root = await createProject()
    let disposableRoot = ''

    await expect(verifyBundledCommunityPlugin(root, PACKAGE_NAME, {
      ...successfulDependencies(),
      makeTemporaryDirectory: async () => {
        disposableRoot = await mkdtemp(join(root, 'disposable-'))
        return disposableRoot
      },
      runHarness: async () => { throw new Error('fixture plugin-load failure') }
    })).rejects.toThrow('fixture plugin-load failure')
    await expect(stat(disposableRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('adds, installs and boots one package in descriptor order', async () => {
    const root = await createProject()
    const commands: BundledCommunityPluginCommand[] = []

    await expect(verifyBundledCommunityPlugin(
      root,
      PACKAGE_NAME,
      successfulDependencies(commands)
    )).resolves.toBeUndefined()
    expect(commands).toHaveLength(2)
    expect(commands[0]?.args).toEqual(expect.arrayContaining([
      'add', '--save-exact', '--allow-build=node-pty'
    ]))
    expect(commands[0]?.args.at(-1)).toBe(join(root, 'vendor/plugins/dsh-memory-evolve-0.1.0.tgz'))
    expect(commands[1]?.args).toEqual([
      'plugin', '--profile', 'web', 'install', '--no-frozen-lockfile'
    ])
  })
})
