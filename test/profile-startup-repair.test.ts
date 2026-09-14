import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { repairProfilePackages } from '../src/main/state/profile-startup-repair'
import { isProfileInstallComplete } from '../src/main/state/profile-install-marker'
const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const dshHome = await mkdtemp(join(tmpdir(), 'insight-profile-repair-'))
  homes.push(dshHome)
  const profile = join(dshHome, 'profiles/web')
  await mkdir(profile, { recursive: true })
  const files = { 'package.json': JSON.stringify({ dependencies: { 'plugin-a': '1.0.0' }, dsh: { profile: { bundles: ['plugin-a'] } } }), 'cordis.patch.yml': '- id: user-config\n', 'pnpm-lock.yaml': 'lockfileVersion: 9.0\n' }
  await Promise.all(Object.entries(files).map(([name, value]) => writeFile(join(profile, name), value)))
  return { dshHome, profile, files }
}
describe('profile startup repair', () => {
  it.each(['reported', 'thrown'])('preserves declarations and incomplete marker after %s install failure', async (failure) => {
    const { dshHome, profile, files } = await fixture()
    const install = vi.fn(async () => { if (failure === 'thrown') throw new Error('offline'); return { ok: false, detail: 'offline' } })
    expect(await repairProfilePackages({ dshHome, install, note: vi.fn() })).toEqual({ ok: false, detail: 'offline' })
    expect(await isProfileInstallComplete(dshHome)).toBe(false)
    for (const [name, content] of Object.entries(files)) expect(await readFile(join(profile, name), 'utf8')).toBe(content)
  })
  it('records successful repair and skips a second install', async () => {
    const { dshHome } = await fixture()
    const install = vi.fn(async () => ({ ok: true }))
    const options = { dshHome, install, note: vi.fn() }
    expect(await repairProfilePackages(options)).toEqual({ ok: true })
    expect(await isProfileInstallComplete(dshHome)).toBe(true)
    await repairProfilePackages(options)
    expect(install).toHaveBeenCalledTimes(1)
  })
})
