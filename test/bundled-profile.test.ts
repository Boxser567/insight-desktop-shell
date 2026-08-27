import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeBundledProfile } from '../src/main/state/bundled-profile'

describe('bundled profile initialization', () => {
  const testDir = join(__dirname, '.temp-bundled-profile-test')

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('copies the packaged web profile only for a new Harness home', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    await mkdir(join(template, 'web'), { recursive: true })
    await writeFile(join(template, 'web', 'package.json'), '{"name":"web-profile"}', 'utf8')

    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(true)
    expect(await readFile(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8')).toContain('web-profile')

    await writeFile(join(dshHome, 'profiles', 'web', 'package.json'), '{"name":"user-profile"}', 'utf8')
    await expect(initializeBundledProfile(template, dshHome)).resolves.toBe(false)
    expect(await readFile(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8')).toContain('user-profile')
  })

  it('upgrades only an uncustomized legacy default profile', async () => {
    const template = join(testDir, 'template')
    const dshHome = join(testDir, 'harness')
    const profile = join(dshHome, 'profiles', 'web')
    await mkdir(join(template, 'web'), { recursive: true })
    await writeFile(
      join(template, 'web', 'package.json'),
      JSON.stringify({
        dependencies: { 'dsh-better-sidebar': '0.16.1' },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-better-sidebar'] } },
        insightDesktop: { defaultProfileVersion: 2 }
      }),
      'utf8'
    )
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
})
