import { verify } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeReleaseFixture } from './release-script-fixtures'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-release-build-'))
  temporaryDirectories.push(root)
  return writeReleaseFixture(root)
}

function runBuild(paths: Awaited<ReturnType<typeof fixture>>, extra: string[] = []) {
  return spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'build-update-release.mjs'),
    '--dir', paths.releaseDir,
    '--version', '0.1.2',
    '--channel', 'stable',
    '--shell-commit', 'a'.repeat(40),
    '--runtime-manifest', paths.runtimeManifest,
    '--compatibility', paths.compatibility,
    '--policy', paths.policy,
    '--private-key', paths.privateKey,
    ...extra
  ], { encoding: 'utf8' })
}

describe('authenticated update release builder', () => {
  it('hashes real assets, sorts them, records the Core Runtime, and signs exact bytes', async () => {
    const paths = await fixture()
    const result = runBuild(paths)
    expect(result.status, result.stderr).toBe(0)

    const manifestBytes = await readFile(path.join(paths.releaseDir, 'insight-update.json'))
    const signature = await readFile(path.join(paths.releaseDir, 'insight-update.json.sig'))
    const publicKey = await readFile(paths.publicKey, 'utf8')
    expect(verify(null, manifestBytes, publicKey, signature)).toBe(true)
    expect(manifestBytes.toString('utf8')).toMatch(/\n$/)
    expect(manifestBytes.toString('utf8')).not.toMatch(/\n\n$/)

    const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
      coreRuntime: { tag: string; commit: string }
      artifacts: Array<{ platform: string; arch: string; kind: string; name: string; size: number }>
    }
    expect(manifest.coreRuntime).toEqual({
      tag: 'insight-runtime-v0.1.1-rc.10',
      commit: 'b'.repeat(40)
    })
    const identities = manifest.artifacts.map(({ platform, arch, kind, name }) =>
      [platform, arch, kind, name].join('\0')
    )
    expect(identities).toEqual([...identities].sort())
    for (const artifact of manifest.artifacts) {
      expect(artifact.size).toBe((await stat(path.join(paths.releaseDir, artifact.name))).size)
    }
  })

  it('requires an exact policy version and channel without defaults', async () => {
    const paths = await fixture()
    await writeFile(paths.policy, JSON.stringify({
      schema: 1,
      releaseVersion: '0.1.3',
      channel: 'candidate',
      mode: 'optional',
      minimumSupportedVersion: '0.1.1'
    }))

    const result = runBuild(paths)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('must match')
  })

  it('rejects unknown policy fields and a minimum version above the release', async () => {
    const paths = await fixture()
    await writeFile(paths.policy, JSON.stringify({
      schema: 1,
      releaseVersion: '0.1.2',
      channel: 'stable',
      mode: 'required',
      minimumSupportedVersion: '0.1.3',
      fallback: true
    }))

    const result = runBuild(paths)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('missing or unknown fields')
  })
})
