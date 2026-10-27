import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { quarantineBlockedRuntimeDependencies } from '../src/main/state/profile-runtime-repair'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })
async function fixture(activeOwner = false) {
  const home = await mkdtemp(join(tmpdir(), 'insight-legacy-runtime-'))
  homes.push(home)
  const profile = join(home, 'profiles/web')
  const install = async (name: string, fields: object) => {
    const directory = join(profile, 'node_modules', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...fields }))
    return directory
  }
  const legacy = await install('legacy-plugin', { peerDependencies: { '@deepseek-ai/dsh-tools': '0.2.1-alpha.1' }, dependencies: { '@deepseek-ai/dsh-storage-domain': '0.2.1-alpha.1', string_decoder: '^1.0.0', '@deepseek-ai/schemastery': '*' } })
  const old = await install('@deepseek-ai/dsh-storage-domain', { version: '0.2.1-alpha.1', peerDependencies: { '@deepseek-ai/dsh-storage': '0.2.1-alpha.1' } })
  await writeFile(join(old, 'retained.js'), 'original bytes')
  const dependencies = { 'legacy-plugin': 'file:./legacy.tgz', ...(activeOwner ? { 'active-plugin': '1.0.0' } : {}) }
  if (activeOwner) await install('active-plugin', { dependencies: { '@deepseek-ai/dsh-storage-domain': '0.2.1-alpha.1' } })
  const manifest = JSON.stringify({ dependencies, dsh: { profile: { bundles: Object.keys(dependencies) } } })
  await writeFile(join(profile, 'package.json'), manifest)
  await mkdir(join(home, 'storages'), { recursive: true })
  await mkdir(join(home, 'sessions'), { recursive: true })
  await writeFile(join(home, 'storages/workspace.json'), '{"existing":"workspace"}')
  await writeFile(join(home, 'sessions/session.v4.jsonl.zstd'), 'committed history')
  return { home, profile, manifest, old, legacy }
}
const options = (home: string) => ({ dshHome: home, runtimeRoot: resolve('build/core-runtime'), note: vi.fn() })

it('isolates a legacy blocked plugin Core dependency without changing plugins or historical data', async () => {
  const { home, profile, manifest, old, legacy } = await fixture()
  const beforePlugin = await readFile(join(legacy, 'package.json'), 'utf8')
  const moved = await quarantineBlockedRuntimeDependencies(options(home))
  expect(moved).toHaveLength(1)
  expect(existsSync(old)).toBe(false)
  expect(await readFile(join(moved[0]!, 'retained.js'), 'utf8')).toBe('original bytes')
  expect(await readFile(join(profile, 'package.json'), 'utf8')).toBe(manifest)
  expect(await readFile(join(legacy, 'package.json'), 'utf8')).toBe(beforePlugin)
  expect(await readFile(join(home, 'storages/workspace.json'), 'utf8')).toBe('{"existing":"workspace"}')
  expect(await readFile(join(home, 'sessions/session.v4.jsonl.zstd'), 'utf8')).toBe('committed history')
  expect(await quarantineBlockedRuntimeDependencies(options(home))).toEqual([])
})

it('preserves a conflicting copy still used by an active plugin', async () => {
  const { home, old } = await fixture(true)
  expect(await quarantineBlockedRuntimeDependencies(options(home))).toEqual([])
  expect(existsSync(old)).toBe(true)
})

it('preserves a conflicting copy consumed through an exempted active plugin peer', async () => {
  const { home, profile, old } = await fixture(true)
  await writeFile(join(profile, 'node_modules/active-plugin/package.json'), JSON.stringify({
    name: 'active-plugin', version: '1.0.0',
    peerDependencies: { '@deepseek-ai/dsh-storage-domain': '0.2.1-alpha.1' }
  }))
  await writeFile(join(profile, 'compatibility.json'), JSON.stringify({ 'active-plugin@1.0.0': ['0.2.1-rc.2'] }))
  expect(await quarantineBlockedRuntimeDependencies(options(home))).toEqual([])
  expect(existsSync(old)).toBe(true)
})

it('does not override an explicit compatibility exemption', async () => {
  const { home, profile, old } = await fixture()
  await writeFile(join(profile, 'compatibility.json'), JSON.stringify({ 'legacy-plugin@1.0.0': ['0.2.1-rc.2'] }))
  expect(await quarantineBlockedRuntimeDependencies(options(home))).toEqual([])
  expect(existsSync(old)).toBe(true)
})

it('preserves explicit Core dependencies and incomplete dependency graphs', async () => {
  const { home, profile, old } = await fixture()
  const path = join(profile, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.dependencies['@deepseek-ai/dsh-storage-domain'] = '0.2.1-alpha.1'
  await writeFile(path, JSON.stringify(manifest))
  expect(await quarantineBlockedRuntimeDependencies(options(home))).toEqual([])
  delete manifest.dependencies['@deepseek-ai/dsh-storage-domain']
  manifest.dependencies['missing-plugin'] = '1.0.0'
  await writeFile(path, JSON.stringify(manifest))
  expect(await quarantineBlockedRuntimeDependencies(options(home))).toEqual([])
  expect(existsSync(old)).toBe(true)
})
