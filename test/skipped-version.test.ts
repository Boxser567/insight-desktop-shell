import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearSkippedVersion,
  readSkippedVersion,
  skippedVersionPath,
  writeSkippedVersion
} from '../src/main/update/skipped-version'

const temporaryDirectories: string[] = []

async function temporaryUserData(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-skipped-update-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('skipped update version', () => {
  it('survives a new reader and atomically replaces the previous version', async () => {
    const userData = await temporaryUserData()
    const path = skippedVersionPath(userData)

    await writeSkippedVersion(path, '1.2.3')
    expect(await readSkippedVersion(path)).toBe('1.2.3')
    await writeSkippedVersion(path, '1.2.4')

    expect(await readSkippedVersion(path)).toBe('1.2.4')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ schema: 1, version: '1.2.4' })
    expect(await readdir(join(userData, 'updates'))).toEqual(['skipped-version.json'])
  })

  it('removes a damaged preference and continues without a skipped version', async () => {
    const userData = await temporaryUserData()
    const path = skippedVersionPath(userData)
    await writeSkippedVersion(path, '1.2.3')
    await writeFile(path, '{broken', 'utf8')

    await expect(readSkippedVersion(path)).resolves.toBeUndefined()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects invalid versions without replacing the saved preference', async () => {
    const userData = await temporaryUserData()
    const path = skippedVersionPath(userData)
    await writeSkippedVersion(path, '1.2.3')

    await expect(writeSkippedVersion(path, 'next')).rejects.toThrow('语义版本')
    await expect(readSkippedVersion(path)).resolves.toBe('1.2.3')
  })

  it('clears only the skipped-version file', async () => {
    const userData = await temporaryUserData()
    const path = skippedVersionPath(userData)
    const sibling = join(userData, 'updates', 'keep.txt')
    await writeSkippedVersion(path, '1.2.3')
    await writeFile(sibling, 'keep', 'utf8')

    await clearSkippedVersion(path)

    await expect(readSkippedVersion(path)).resolves.toBeUndefined()
    await expect(readFile(sibling, 'utf8')).resolves.toBe('keep')
  })
})
