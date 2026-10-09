import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveLocalPluginImport, stageLocalPluginImport } from '../src/main/state/local-plugin-import'

describe('local plugin import validation', () => {
  const testDir = join(__dirname, '.temp-local-plugin-import-test')

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('accepts a named package directory and a tgz archive', async () => {
    const directory = join(testDir, 'plugin')
    const archive = join(testDir, 'plugin.tgz')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), '{"name":"example-plugin"}', 'utf8')
    await writeFile(archive, '')

    await expect(resolveLocalPluginImport(directory)).resolves.toEqual({ path: directory, kind: 'directory' })
    await expect(resolveLocalPluginImport(archive)).resolves.toEqual({ path: archive, kind: 'archive' })
  })

  it('rejects a directory without a package manifest and unsupported files', async () => {
    const directory = join(testDir, 'not-a-plugin')
    const archive = join(testDir, 'plugin.zip')
    await mkdir(directory, { recursive: true })
    await writeFile(archive, '')

    await expect(resolveLocalPluginImport(directory)).rejects.toThrow('package.json')
    await expect(resolveLocalPluginImport(archive)).rejects.toThrow('.tgz')
  })

  it('keeps an imported archive available after its external source is deleted', async () => {
    await mkdir(testDir, { recursive: true })
    const archive = join(testDir, 'plugin.tgz')
    const bytes = Buffer.from('original archive contents')
    await writeFile(archive, bytes)
    const home = join(testDir, 'home')
    const staged = await stageLocalPluginImport(home, await resolveLocalPluginImport(archive))
    await rm(archive)
    expect(staged.kind).toBe('archive')
    expect(staged.path.startsWith(join(home, 'profiles', 'web', '.insight-local-plugins'))).toBe(true)
    expect(await readFile(staged.path)).toEqual(bytes)
  })

  it('keeps directory imports linked to their selected development directory', async () => {
    const directory = join(testDir, 'plugin')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), '{"name":"example-plugin"}')
    const plugin = await resolveLocalPluginImport(directory)
    expect(await stageLocalPluginImport(join(testDir, 'home'), plugin)).toEqual(plugin)
  })

  it('does not replace an earlier imported archive when the same filename is selected again', async () => {
    await mkdir(testDir, { recursive: true })
    const archive = join(testDir, 'plugin.tgz')
    const home = join(testDir, 'home')
    await writeFile(archive, 'version one')
    const first = await stageLocalPluginImport(home, await resolveLocalPluginImport(archive))
    await writeFile(archive, 'version two')
    const second = await stageLocalPluginImport(home, await resolveLocalPluginImport(archive))
    expect(second.path).not.toBe(first.path)
    expect(await readFile(first.path, 'utf8')).toBe('version one')
    expect(await readFile(second.path, 'utf8')).toBe('version two')
  })
})
