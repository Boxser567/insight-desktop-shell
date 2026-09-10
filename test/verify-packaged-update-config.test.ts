import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyPackagedUpdateConfig } from '../scripts/verify-packaged-update-config.mjs'

const temporaryDirectories: string[] = []

async function resourcesDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-app-update-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('packaged updater configuration', () => {
  it('accepts the OSS bootstrap metadata required by electron-updater downloads', async () => {
    const directory = await resourcesDirectory()
    await writeFile(join(directory, 'app-update.yml'), [
      'provider: generic',
      'url: https://updates.insight-aigc.com/desktop/',
      'updaterCacheDirName: insight-desktop-updater',
      ''
    ].join('\n'))

    await expect(verifyPackagedUpdateConfig(directory)).resolves.toMatchObject({
      provider: 'generic',
      url: 'https://updates.insight-aigc.com/desktop/'
    })
  })

  it('rejects missing or non-OSS updater metadata', async () => {
    const missing = await resourcesDirectory()
    await expect(verifyPackagedUpdateConfig(missing)).rejects.toThrow(
      'Packaged updater configuration is missing'
    )

    const github = await resourcesDirectory()
    await writeFile(join(github, 'app-update.yml'), [
      'provider: github',
      'owner: Boxser567',
      'repo: insight-desktop-shell',
      'updaterCacheDirName: insight-desktop-updater',
      ''
    ].join('\n'))
    await expect(verifyPackagedUpdateConfig(github)).rejects.toThrow(
      'does not match the OSS update contract'
    )
  })
})
