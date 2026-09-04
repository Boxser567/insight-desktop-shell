import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPeFixture, writeReleaseFixture } from './release-script-fixtures'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function builtFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-release-verify-'))
  temporaryDirectories.push(root)
  const paths = await writeReleaseFixture(root)
  const result = spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'build-update-release.mjs'),
    '--dir', paths.releaseDir,
    '--version', '0.1.2',
    '--channel', 'stable',
    '--shell-commit', 'a'.repeat(40),
    '--runtime-manifest', paths.runtimeManifest,
    '--compatibility', paths.compatibility,
    '--policy', paths.policy,
    '--private-key', paths.privateKey
  ], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return paths
}

function runVerify(paths: Awaited<ReturnType<typeof builtFixture>>, version = '0.1.2') {
  return spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'verify-release-assets.mjs'),
    '--dir', paths.releaseDir,
    '--version', version,
    '--channel', 'stable',
    '--public-key', paths.publicKey
  ], { encoding: 'utf8' })
}

describe('complete release asset verifier', () => {
  it('accepts an authenticated, complete release set', async () => {
    const paths = await builtFixture()
    const result = runVerify(paths)
    expect(result.status, result.stderr).toBe(0)
  })

  it('rejects signature, digest, and requested-version mismatches', async () => {
    const signature = await builtFixture()
    const manifestPath = path.join(signature.releaseDir, 'insight-update.json')
    const manifestBytes = await readFile(manifestPath)
    manifestBytes[1] = manifestBytes[1] === 0x20 ? 0x09 : 0x20
    await writeFile(manifestPath, manifestBytes)
    expect(runVerify(signature).stderr).toContain('signature is invalid')

    const digest = await builtFixture()
    await writeFile(path.join(digest.releaseDir, 'insight-mac-arm64.dmg'), 'changed')
    expect(runVerify(digest).stderr).toContain('does not match release asset')

    const version = await builtFixture()
    expect(runVerify(version, '0.1.3').status).not.toBe(0)
  })

  it('rejects unreadable ZIP central directories and non-x64 PE files', async () => {
    const zip = await builtFixture()
    await writeFile(path.join(zip.releaseDir, 'insight-mac-arm64.zip'), 'not a zip')
    expect(runVerify(zip).status).not.toBe(0)

    const pe = await builtFixture()
    await writeFile(
      path.join(pe.releaseDir, 'insight-windows-x64-setup.exe'),
      createPeFixture(0xaa64)
    )
    expect(runVerify(pe).status).not.toBe(0)
  })

  it('rejects missing, empty, or unexpected assets', async () => {
    const missing = await builtFixture()
    await rm(path.join(missing.releaseDir, 'insight-mac-x64.dmg'))
    expect(runVerify(missing).status).not.toBe(0)

    const empty = await builtFixture()
    await writeFile(path.join(empty.releaseDir, 'insight-mac-arm64.zip.blockmap'), '')
    expect(runVerify(empty).status).not.toBe(0)

    const unexpected = await builtFixture()
    await writeFile(path.join(unexpected.releaseDir, 'update-private.pem'), 'forbidden')
    expect(runVerify(unexpected).stderr).toContain('missing or unexpected files')
  })
})
