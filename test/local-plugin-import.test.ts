import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveLocalPluginImport } from '../src/main/state/local-plugin-import'

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
})
