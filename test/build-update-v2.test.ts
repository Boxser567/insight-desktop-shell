import { verify } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import {
  sha512,
  writeReleaseFixture
} from './release-script-fixtures'

const temporaryDirectories: string[] = []
const projectRoot = path.resolve(import.meta.dirname, '..')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-update-v2-build-'))
  temporaryDirectories.push(root)
  const paths = await writeReleaseFixture(root, '1.0.1', 'stable')
  await writeFile(paths.compatibility, JSON.stringify({
    profileSchema: 1,
    accountStorageSchema: 1,
    readsDataSchema: { minimum: 1, maximum: 1 },
    writesDataSchema: 1
  }))
  return { root, paths }
}

async function writeTargetMetadata(
  releaseDir: string,
  target: 'darwin-arm64' | 'darwin-x64' | 'win32-x64',
  metadataVersion = '1.0.1',
  metadataSha512?: string
): Promise<void> {
  const version = '1.0.1'
  const name = target === 'darwin-arm64'
    ? `insight-${version}-mac-arm64.zip`
    : target === 'darwin-x64'
      ? `insight-${version}-mac-x64.zip`
      : `insight-${version}-windows-x64-setup.exe`
  const bytes = await readFile(path.join(releaseDir, name))
  const metadata = {
    version: metadataVersion,
    files: [{ url: name, sha512: metadataSha512 ?? sha512(bytes), size: bytes.length }],
    path: name,
    sha512: metadataSha512 ?? sha512(bytes),
    ...(target.startsWith('darwin-') ? { minimumSystemVersion: '22.0.0' } : {})
  }
  await writeFile(
    path.join(releaseDir, target.startsWith('darwin-') ? 'latest-mac.yml' : 'latest.yml'),
    stringify(metadata)
  )
}

function runTarget(input: {
  paths: Awaited<ReturnType<typeof writeReleaseFixture>>
  outDir: string
  target: 'darwin-arm64' | 'darwin-x64' | 'win32-x64'
  shellCommit?: string
}) {
  return spawnSync(process.execPath, [
    path.join(projectRoot, 'scripts', 'build-update-v2-target.mjs'),
    '--asset-dir', input.paths.releaseDir,
    '--out-dir', input.outDir,
    '--version', '1.0.1',
    '--target', input.target,
    '--shell-commit', input.shellCommit ?? 'a'.repeat(40),
    '--runtime-manifest', input.paths.runtimeManifest,
    '--compatibility', input.paths.compatibility,
    '--private-key', input.paths.privateKey
  ], { encoding: 'utf8' })
}

async function buildTarget(input: {
  paths: Awaited<ReturnType<typeof writeReleaseFixture>>
  releaseRoot: string
  target: 'darwin-arm64' | 'darwin-x64' | 'win32-x64'
  shellCommit?: string
}) {
  await writeTargetMetadata(input.paths.releaseDir, input.target)
  const outDir = path.join(input.releaseRoot, 'targets', input.target)
  const result = runTarget({ ...input, outDir })
  expect(result.status, result.stderr).toBe(0)
  return outDir
}

describe('v2 update release builders', () => {
  it('builds and verifies one signed channel-neutral target', async () => {
    const { root, paths } = await fixture()
    const releaseRoot = path.join(root, 'v1.0.1')
    const targetDir = await buildTarget({ paths, releaseRoot, target: 'darwin-arm64' })
    const verifyResult = spawnSync(process.execPath, [
      path.join(projectRoot, 'scripts', 'verify-update-v2-assets.mjs'),
      '--dir', targetDir,
      '--version', '1.0.1',
      '--target', 'darwin-arm64',
      '--public-key', paths.publicKey
    ], { encoding: 'utf8' })
    expect(verifyResult.status, verifyResult.stderr).toBe(0)

    const manifest = JSON.parse(await readFile(
      path.join(targetDir, 'insight-target.json'),
      'utf8'
    )) as { schema: string; version: string; target: object; artifacts: unknown[] }
    expect(manifest).toMatchObject({
      schema: 'insight-desktop-target/v2',
      version: '1.0.1',
      target: { platform: 'darwin', arch: 'arm64' }
    })
    expect(manifest.artifacts).toHaveLength(4)
  })

  it('rejects updater metadata for another version or target', async () => {
    const { root, paths } = await fixture()
    await writeTargetMetadata(paths.releaseDir, 'darwin-arm64', '1.0.0')
    const result = runTarget({
      paths,
      outDir: path.join(root, 'target'),
      target: 'darwin-arm64'
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('exactly the current target and version')
  })

  it('rejects updater metadata whose artifact digest is not the packaged update', async () => {
    const { root, paths } = await fixture()
    await writeTargetMetadata(
      paths.releaseDir,
      'darwin-arm64',
      '1.0.1',
      Buffer.alloc(64).toString('base64')
    )
    const result = runTarget({
      paths,
      outDir: path.join(root, 'target'),
      target: 'darwin-arm64'
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('exactly the current target and version')
  })

  it('builds a complete signed index and rejects mismatched Shell commits', async () => {
    const success = await fixture()
    const successRoot = path.join(success.root, 'v1.0.1')
    for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const) {
      await buildTarget({ paths: success.paths, releaseRoot: successRoot, target })
    }
    const built = spawnSync(process.execPath, [
      path.join(projectRoot, 'scripts', 'build-update-v2-index.mjs'),
      '--dir', successRoot,
      '--version', '1.0.1',
      '--private-key', success.paths.privateKey
    ], { encoding: 'utf8' })
    expect(built.status, built.stderr).toBe(0)
    const indexBytes = await readFile(path.join(successRoot, 'insight-release.json'))
    const signature = await readFile(path.join(successRoot, 'insight-release.json.sig'))
    expect(verify(null, indexBytes, await readFile(success.paths.publicKey, 'utf8'), signature)).toBe(true)
    expect(JSON.parse(indexBytes.toString('utf8')).targets.map((value: { id: string }) => value.id))
      .toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64'])

    const failure = await fixture()
    const failureRoot = path.join(failure.root, 'v1.0.1')
    await buildTarget({ paths: failure.paths, releaseRoot: failureRoot, target: 'darwin-arm64' })
    await buildTarget({
      paths: failure.paths,
      releaseRoot: failureRoot,
      target: 'darwin-x64',
      shellCommit: 'c'.repeat(40)
    })
    await buildTarget({ paths: failure.paths, releaseRoot: failureRoot, target: 'win32-x64' })
    const rejected = spawnSync(process.execPath, [
      path.join(projectRoot, 'scripts', 'build-update-v2-index.mjs'),
      '--dir', failureRoot,
      '--version', '1.0.1',
      '--private-key', failure.paths.privateKey
    ], { encoding: 'utf8' })
    expect(rejected.status).not.toBe(0)
    expect(rejected.stderr).toContain('identity does not match')
  })

  it('builds a canonical optional Candidate envelope above every supplied floor', async () => {
    const { root, paths } = await fixture()
    const releaseRoot = path.join(root, 'v1.0.1')
    const targetDir = await buildTarget({ paths, releaseRoot, target: 'win32-x64' })
    const legacyPointer = path.join(root, 'legacy-current.json')
    const out = path.join(root, 'candidate-current.json')
    await writeFile(legacyPointer, JSON.stringify({
      schemaVersion: 1,
      channel: 'candidate',
      version: '1.0.0-rc.18'
    }))
    const built = spawnSync(process.execPath, [
      path.join(projectRoot, 'scripts', 'build-update-v2-rollout.mjs'),
      '--track', 'candidate',
      '--version', '1.0.1',
      '--target', 'win32-x64',
      '--referenced-file', path.join(targetDir, 'insight-target.json'),
      '--minimum-supported-version', '1.0.0-rc.18',
      '--private-key', paths.privateKey,
      '--out', out,
      '--current-pointer', legacyPointer
    ], { encoding: 'utf8' })
    expect(built.status, built.stderr).toBe(0)
    const envelope = JSON.parse(await readFile(out, 'utf8')) as {
      payloadBase64: string
      signatureBase64: string
    }
    const payloadBytes = Buffer.from(envelope.payloadBase64, 'base64')
    expect(verify(
      null,
      payloadBytes,
      await readFile(paths.publicKey, 'utf8'),
      Buffer.from(envelope.signatureBase64, 'base64')
    )).toBe(true)
    expect(JSON.parse(payloadBytes.toString('utf8'))).toMatchObject({
      track: 'candidate',
      target: 'win32-x64',
      version: '1.0.1',
      policy: { mode: 'optional' }
    })

    const rejected = spawnSync(process.execPath, [
      path.join(projectRoot, 'scripts', 'build-update-v2-rollout.mjs'),
      '--track', 'candidate',
      '--version', '1.0.0-rc.18',
      '--target', 'win32-x64',
      '--referenced-file', path.join(targetDir, 'insight-target.json'),
      '--minimum-supported-version', '1.0.0-rc.18',
      '--private-key', paths.privateKey,
      '--out', out,
      '--current-pointer', legacyPointer
    ], { encoding: 'utf8' })
    expect(rejected.status).not.toBe(0)
  })

  it('keeps v2 package metadata neutral while preserving bridge-only Candidate scripts', () => {
    const require = createRequire(import.meta.url)
    const packageJson = require('../package.json')
    const candidate = require('../electron-builder.candidate.cjs')
    expect(packageJson.build.extraMetadata.insightDesktopChannel).toBe('stable')
    expect(candidate.extraMetadata.insightDesktopChannel).toBe('candidate')
    expect(candidate.appId).toBe(packageJson.build.appId)
    expect(candidate.productName).toBe(packageJson.build.productName)
    expect(packageJson.scripts).toMatchObject({
      'package:bridge:mac:arm64': expect.stringContaining('electron-builder.candidate.cjs'),
      'package:release:mac:arm64': expect.stringContaining('dist stable'),
      'package:release:mac:x64': expect.stringContaining('dist stable'),
      'package:release:win': expect.stringContaining('--publish never')
    })
    expect(packageJson.scripts['package:bridge:mac:arm64']).toContain('--publish never')
  })
})
