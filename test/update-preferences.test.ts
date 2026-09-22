import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  migrateLegacyCandidatePreference,
  readUpdatePreferences,
  updatePreferencesPath,
  writeCandidateOptIn
} from '../src/main/update/update-preferences'

const temporaryDirectories: string[] = []

async function temporaryPreferencePath(): Promise<string> {
  const userData = await mkdtemp(join(tmpdir(), 'insight-update-preferences-'))
  temporaryDirectories.push(userData)
  return updatePreferencesPath(userData)
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('desktop update preferences', () => {
  it('defaults clean Stable installs to opted out', async () => {
    const path = await temporaryPreferencePath()

    await expect(readUpdatePreferences(path)).resolves.toEqual({ candidateOptIn: false })
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('opts rc.19 Candidate users in once without overriding an explicit choice', async () => {
    const path = await temporaryPreferencePath()
    await expect(migrateLegacyCandidatePreference({
      path,
      packagedChannel: 'candidate',
      currentVersion: '1.0.0-rc.19'
    })).resolves.toBe(true)
    await writeCandidateOptIn(path, false)

    await expect(migrateLegacyCandidatePreference({
      path,
      packagedChannel: 'candidate',
      currentVersion: '1.0.0-rc.19'
    })).resolves.toBe(false)
    await expect(readUpdatePreferences(path)).resolves.toEqual({ candidateOptIn: false })
  })

  it.each([
    ['another Candidate version', 'candidate', '1.0.0-rc.17'],
    ['a Stable package', 'stable', '1.0.0'],
    ['a development package', 'development', '1.0.0-rc.19']
  ] as const)('does not migrate %s', async (_label, packagedChannel, currentVersion) => {
    const path = await temporaryPreferencePath()
    await expect(migrateLegacyCandidatePreference({
      path,
      packagedChannel,
      currentVersion
    })).resolves.toBe(false)
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['{broken', JSON.stringify({ schema: 1, candidateOptIn: true, extra: true })])(
    'replaces malformed or unknown preference fields with a safe canonical value',
    async (raw) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const path = await temporaryPreferencePath()
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, raw, 'utf8')

      await expect(readUpdatePreferences(path)).resolves.toEqual({ candidateOptIn: false })
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        schema: 1,
        candidateOptIn: false
      })
      expect(warning).toHaveBeenCalledWith(
        '[desktop] 更新偏好无效，已安全关闭内测更新。'
      )
    }
  )

  it('writes atomically with private file permissions', async () => {
    const path = await temporaryPreferencePath()
    await writeCandidateOptIn(path, true)
    await chmod(path, 0o644)
    await writeCandidateOptIn(path, false)

    expect(await readFile(path, 'utf8')).toBe('{"schema":1,"candidateOptIn":false}\n')
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(dirname(path))).toEqual(['preferences.json'])
  })

  it('removes its temporary file when atomic replacement fails', async () => {
    const path = await temporaryPreferencePath()
    await mkdir(path, { recursive: true })

    await expect(writeCandidateOptIn(path, true)).rejects.toThrow()
    expect(await readdir(dirname(path))).toEqual(['preferences.json'])
  })
})
