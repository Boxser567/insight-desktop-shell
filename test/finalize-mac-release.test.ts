import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createZipFixture } from './release-script-fixtures'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-mac-release-'))
  temporaryDirectories.push(root)
  const releaseDirectory = path.join(root, 'release')
  const archiveName = 'insight-candidate-mac-arm64.zip'
  const archive = createZipFixture('candidate')
  await mkdir(releaseDirectory)
  await Promise.all([
    writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.2-rc.1' })),
    writeFile(path.join(releaseDirectory, archiveName), archive),
    writeFile(path.join(releaseDirectory, `${archiveName}.blockmap`), 'blockmap')
  ])
  return { root, releaseDirectory, archiveName, archive }
}

function run(value: Awaited<ReturnType<typeof fixture>>) {
  return spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'finalize-mac-release.mjs'),
    value.releaseDirectory,
    value.archiveName
  ], { cwd: value.root, encoding: 'utf8' })
}

describe('macOS release finalizer', () => {
  it('writes updater metadata from the final ZIP and blockmap', async () => {
    const value = await fixture()
    const result = run(value)
    expect(result.status, result.stderr).toBe(0)

    const metadata = parse(
      await readFile(path.join(value.releaseDirectory, 'latest-mac.yml'), 'utf8')
    )
    const digest = createHash('sha512').update(value.archive).digest('base64')
    expect(metadata).toMatchObject({
      version: '0.1.2-rc.1',
      files: [{ url: value.archiveName, sha512: digest, size: value.archive.length }],
      path: value.archiveName,
      sha512: digest
    })
  })

  it('rejects a missing blockmap or a channel-mismatched archive', async () => {
    const missingBlockmap = await fixture()
    await rm(path.join(
      missingBlockmap.releaseDirectory,
      `${missingBlockmap.archiveName}.blockmap`
    ))
    expect(run(missingBlockmap).status).not.toBe(0)

    const wrongChannel = await fixture()
    const stableName = 'insight-mac-arm64.zip'
    await Promise.all([
      writeFile(path.join(wrongChannel.releaseDirectory, stableName), wrongChannel.archive),
      writeFile(path.join(wrongChannel.releaseDirectory, `${stableName}.blockmap`), 'blockmap')
    ])
    wrongChannel.archiveName = stableName
    expect(run(wrongChannel).stderr).toContain('does not match version')
  })
})
