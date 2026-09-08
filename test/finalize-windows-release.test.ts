import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPeFixture } from './release-script-fixtures'

describe('Windows release finalizer', () => {
  it('rebuilds the blockmap and updater metadata for the final installer', async () => {
    const releaseDir = await mkdtemp(path.join(tmpdir(), 'dsh-windows-release-'))
    try {
      const installerName = 'dsh-desktop-windows-x64-setup.exe'
      const installer = path.join(releaseDir, installerName)
      const app = path.join(releaseDir, 'win-unpacked', '因赛AI.exe')
      const content = createPeFixture(0x14c)
      await mkdir(path.dirname(app))
      await writeFile(installer, content)
      await writeFile(app, createPeFixture())
      await writeFile(`${installer}.blockmap`, 'stale blockmap')
      await writeFile(path.join(releaseDir, 'latest.yml'), 'stale metadata')

      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), 'scripts', 'finalize-windows-release.mjs'),
          releaseDir,
          '1.2.3',
          app
        ],
        { encoding: 'utf8' }
      )
      expect(result.status, result.stderr).toBe(0)

      const digest = createHash('sha512').update(content).digest('base64')
      const metadata = await readFile(path.join(releaseDir, 'latest.yml'), 'utf8')
      expect(metadata).toContain('version: 1.2.3')
      expect(metadata).toContain(`url: "${installerName}"`)
      expect(metadata).toContain(`sha512: ${digest}`)
      expect(metadata).toContain(`size: ${content.length}`)
      expect((await stat(`${installer}.blockmap`)).size).toBeGreaterThan(0)
    } finally {
      await rm(releaseDir, { recursive: true, force: true })
    }
  })

  it('rejects a non-PE file before writing updater metadata', async () => {
    const releaseDir = await mkdtemp(path.join(tmpdir(), 'dsh-windows-release-'))
    try {
      await writeFile(
        path.join(releaseDir, 'insight-windows-x64-setup.exe'),
        'not a Windows executable'
      )
      const app = path.join(releaseDir, 'win-unpacked', '因赛AI.exe')
      await mkdir(path.dirname(app))
      await writeFile(app, createPeFixture())
      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), 'scripts', 'finalize-windows-release.mjs'),
          releaseDir,
          '1.2.3',
          app
        ],
        { encoding: 'utf8' }
      )
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('invalid DOS header')
    } finally {
      await rm(releaseDir, { recursive: true, force: true })
    }
  })

  it('rejects a packaged application that is not x64', async () => {
    const releaseDir = await mkdtemp(path.join(tmpdir(), 'dsh-windows-release-'))
    try {
      await writeFile(
        path.join(releaseDir, 'insight-windows-x64-setup.exe'),
        createPeFixture(0x14c)
      )
      const app = path.join(releaseDir, 'win-unpacked', '因赛AI.exe')
      await mkdir(path.dirname(app))
      await writeFile(app, createPeFixture(0xaa64))
      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), 'scripts', 'finalize-windows-release.mjs'),
          releaseDir,
          '1.2.3',
          app
        ],
        { encoding: 'utf8' }
      )
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('application is not x64')
    } finally {
      await rm(releaseDir, { recursive: true, force: true })
    }
  })
})
