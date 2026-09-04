import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { createZipFixture, sha512 } from './release-script-fixtures'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-mac-metadata-'))
  temporaryDirectories.push(root)
  const metadataPaths: Record<'arm64' | 'x64', string> = {
    arm64: path.join(root, 'latest-mac-arm64.yml'),
    x64: path.join(root, 'latest-mac-x64.yml')
  }
  for (const arch of ['arm64', 'x64'] as const) {
    const name = `insight-mac-${arch}.zip`
    const bytes = createZipFixture(arch)
    await writeFile(path.join(root, name), bytes)
    await writeFile(path.join(root, `${name}.blockmap`), `${arch} blockmap`)
    await writeFile(metadataPaths[arch], stringify({
      version: '0.1.2',
      files: [{ url: name, sha512: sha512(bytes), size: bytes.length }],
      path: name,
      sha512: sha512(bytes),
      releaseDate: `2026-09-04T0${arch === 'arm64' ? '3' : '4'}:00:00.000Z`
    }))
  }
  return { root, metadataPaths, output: path.join(root, 'latest-mac.yml') }
}

function run(paths: Awaited<ReturnType<typeof fixture>>) {
  return spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'merge-mac-update-metadata.mjs'),
    paths.metadataPaths.arm64,
    paths.metadataPaths.x64,
    paths.output
  ], { encoding: 'utf8' })
}

describe('macOS updater metadata merger', () => {
  it('merges unique arm64 and x64 metadata with verified assets', async () => {
    const paths = await fixture()
    const result = run(paths)
    expect(result.status, result.stderr).toBe(0)

    const merged = parse(await readFile(paths.output, 'utf8')) as {
      version: string
      files: Array<{ url: string }>
      releaseDate: string
    }
    expect(merged.version).toBe('0.1.2')
    expect(merged.files.map(({ url }) => url)).toEqual([
      'insight-mac-arm64.zip',
      'insight-mac-x64.zip'
    ])
    expect(merged.releaseDate).toBe('2026-09-04T04:00:00.000Z')
  })

  it('rejects duplicate architectures and mismatched versions', async () => {
    const duplicate = await fixture()
    await writeFile(duplicate.metadataPaths.x64, await readFile(duplicate.metadataPaths.arm64))
    expect(run(duplicate).status).not.toBe(0)

    const mismatch = await fixture()
    const x64 = parse(await readFile(mismatch.metadataPaths.x64, 'utf8'))
    x64.version = '0.1.3'
    await writeFile(mismatch.metadataPaths.x64, stringify(x64))
    const result = run(mismatch)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('versions do not match')
  })

  it('rejects missing blockmaps and invalid YAML', async () => {
    const missing = await fixture()
    await rm(path.join(missing.root, 'insight-mac-arm64.zip.blockmap'))
    expect(run(missing).status).not.toBe(0)

    const invalid = await fixture()
    await writeFile(invalid.metadataPaths.arm64, 'files: [')
    const result = run(invalid)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Invalid updater YAML')
  })
})
