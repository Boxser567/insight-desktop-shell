import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { writeReleaseFixture } from './release-script-fixtures'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function builtFixture(
  version = '0.1.2',
  channel: 'candidate' | 'stable' = 'stable',
  scope = 'all'
) {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-release-verify-'))
  temporaryDirectories.push(root)
  const paths = await writeReleaseFixture(root, version, channel)
  if (scope === 'macos-arm64') {
    const names = await readdir(paths.releaseDir)
    await Promise.all(names
      .filter((name) => name === 'latest.yml' || name.includes('mac-x64') || name.includes('windows-x64'))
      .map((name) => rm(path.join(paths.releaseDir, name))))
    const metadataPath = path.join(paths.releaseDir, 'latest-mac.yml')
    const metadata = parse(await readFile(metadataPath, 'utf8')) as {
      files: Array<{ url: string; sha512: string }>
      path: string
      sha512: string
    }
    metadata.files = metadata.files.filter(({ url }) => url.includes('mac-arm64'))
    const primary = metadata.files[0]
    if (!primary) throw new Error('Apple Silicon updater fixture is incomplete.')
    metadata.path = primary.url
    metadata.sha512 = primary.sha512
    await writeFile(metadataPath, stringify(metadata))
  }
  const result = spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'build-update-release.mjs'),
    '--dir', paths.releaseDir,
    '--version', version,
    '--channel', channel,
    '--shell-commit', 'a'.repeat(40),
    '--runtime-manifest', paths.runtimeManifest,
    '--compatibility', paths.compatibility,
    '--policy', paths.policy,
    '--private-key', paths.privateKey,
    '--scope', scope
  ], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return paths
}

function runVerify(
  paths: Awaited<ReturnType<typeof builtFixture>>,
  version = '0.1.2',
  channel: 'candidate' | 'stable' = 'stable',
  scope = 'all'
) {
  return spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'verify-release-assets.mjs'),
    '--dir', paths.releaseDir,
    '--version', version,
    '--channel', channel,
    '--public-key', paths.publicKey,
    '--scope', scope
  ], { encoding: 'utf8' })
}

describe('complete release asset verifier', () => {
  it('accepts an authenticated, complete release set', async () => {
    const paths = await builtFixture()
    const result = runVerify(paths)
    expect(result.status, result.stderr).toBe(0)
  })

  it('accepts unified artifact names for a Candidate release', async () => {
    const paths = await builtFixture('0.1.2-rc.2', 'candidate')
    const result = runVerify(paths, '0.1.2-rc.2', 'candidate')
    expect(result.status, result.stderr).toBe(0)
  })

  it('accepts the exact Apple Silicon-only asset set for a Candidate release', async () => {
    const paths = await builtFixture('0.1.2-rc.4', 'candidate', 'macos-arm64')
    const result = runVerify(paths, '0.1.2-rc.4', 'candidate', 'macos-arm64')
    expect(result.status, result.stderr).toBe(0)

    const wrongScope = runVerify(paths, '0.1.2-rc.4', 'candidate')
    expect(wrongScope.status).not.toBe(0)
    expect(wrongScope.stderr).toContain('incomplete or unexpected')
  })

  it('rejects signature, digest, and requested-version mismatches', async () => {
    const signature = await builtFixture()
    const manifestPath = path.join(signature.releaseDir, 'insight-update.json')
    const manifestBytes = await readFile(manifestPath)
    manifestBytes[1] = manifestBytes[1] === 0x20 ? 0x09 : 0x20
    await writeFile(manifestPath, manifestBytes)
    expect(runVerify(signature).stderr).toContain('signature is invalid')

    const digest = await builtFixture()
    await writeFile(path.join(digest.releaseDir, 'insight-0.1.2-mac-arm64.dmg'), 'changed')
    expect(runVerify(digest).stderr).toContain('does not match release asset')

    const version = await builtFixture()
    expect(runVerify(version, '0.1.3').status).not.toBe(0)
  })

  it('rejects unreadable ZIP central directories and invalid Windows installers', async () => {
    const zip = await builtFixture()
    await writeFile(path.join(zip.releaseDir, 'insight-0.1.2-mac-arm64.zip'), 'not a zip')
    expect(runVerify(zip).status).not.toBe(0)

    const pe = await builtFixture()
    await writeFile(
      path.join(pe.releaseDir, 'insight-0.1.2-windows-x64-setup.exe'),
      'not a Windows executable'
    )
    expect(runVerify(pe).status).not.toBe(0)
  })

  it('rejects missing, empty, or unexpected assets', async () => {
    const missing = await builtFixture()
    await rm(path.join(missing.releaseDir, 'insight-0.1.2-mac-x64.dmg'))
    expect(runVerify(missing).status).not.toBe(0)

    const empty = await builtFixture()
    await writeFile(path.join(empty.releaseDir, 'insight-0.1.2-mac-arm64.zip.blockmap'), '')
    expect(runVerify(empty).status).not.toBe(0)

    const unexpected = await builtFixture()
    await writeFile(path.join(unexpected.releaseDir, 'update-private.pem'), 'forbidden')
    expect(runVerify(unexpected).stderr).toContain('missing or unexpected files')
  })
})
