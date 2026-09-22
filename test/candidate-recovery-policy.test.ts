import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateManager } from '../src/main/update/update-manager'
import { assertCandidateRecoveryCompatible } from '../src/main/update/v2-release-contract'
import { writeCandidateOptIn } from '../src/main/update/update-preferences'
import type { ExecutorEvent, UpdateExecutor } from '../src/main/update/update-executor'
import type { ResolvedV2Release, V2UpdateSource } from '../src/main/update/update-source'
import type { SignedTargetManifest } from '../src/shared/update-contracts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

function sha512(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64')
}

function candidateRelease(writesDataSchema: number): ResolvedV2Release {
  const target = { platform: 'darwin' as const, arch: 'arm64' as const }
  const manifest: SignedTargetManifest = {
    schema: 'insight-desktop-target/v2',
    version: '1.0.1',
    target,
    shellCommit: 'a'.repeat(40),
    coreRuntime: { tag: 'runtime-v1', commit: 'b'.repeat(40) },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      readsDataSchema: { minimum: 1, maximum: 2 },
      writesDataSchema
    },
    artifacts: [
      { ...target, kind: 'dmg', name: 'candidate.dmg', size: 3, sha512: sha512(Buffer.from('dmg')) },
      { ...target, kind: 'zip', name: 'candidate.zip', size: 3, sha512: sha512(Buffer.from('zip')) },
      { ...target, kind: 'blockmap', name: 'candidate.zip.blockmap', size: 3, sha512: sha512(Buffer.from('map')) },
      { ...target, kind: 'updater-metadata', name: 'latest-mac.yml', size: 3, sha512: sha512(Buffer.from('yml')) }
    ]
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  return {
    rollout: {
      schema: 'insight-desktop-rollout/v2',
      track: 'candidate',
      target: 'darwin-arm64',
      version: '1.0.1',
      referencedSha512: sha512(manifestBytes),
      policy: { mode: 'optional', minimumSupportedVersion: '1.0.0' },
      publishedAt: '2026-09-22T12:00:00.000Z'
    },
    rolloutEnvelopeBytes: Buffer.from('envelope'),
    manifest,
    manifestBytes,
    signatureBytes: Buffer.alloc(64),
    releaseBaseUrl: new URL('https://updates.example.test/desktop/releases/v1.0.1/targets/darwin-arm64/'),
    manualInstallerUrl: new URL('https://updates.example.test/desktop/releases/v1.0.1/targets/darwin-arm64/candidate.dmg')
  }
}

class Executor implements UpdateExecutor {
  readonly configure = vi.fn()
  readonly useRelease = vi.fn()
  readonly check = vi.fn(async () => ({ version: '1.0.1' }))
  readonly download = vi.fn(async () => undefined)
  readonly quitAndInstall = vi.fn()
  on(_listener: (event: ExecutorEvent) => void): () => void { return () => undefined }
}

async function managerFixture(input: { candidateWrites: number; stableMaximum: number }) {
  const userData = await mkdtemp(join(tmpdir(), 'candidate-recovery-'))
  temporaryDirectories.push(userData)
  const release = candidateRelease(input.candidateWrites)
  const stableInstaller = new URL('https://updates.example.test/desktop/releases/v1.0.0/targets/darwin-arm64/stable.dmg')
  const source: V2UpdateSource = {
    resolve: vi.fn(async () => release),
    resolveRecoveryBaseline: vi.fn(async () => ({
      version: '1.0.0',
      source: 'stable' as const,
      readsDataSchema: { minimum: 1, maximum: input.stableMaximum },
      manualInstallerUrl: stableInstaller
    })),
    v2ReleaseBaseUrl: vi.fn(() => release.releaseBaseUrl),
    v2ManualInstallerUrl: vi.fn(() => release.manualInstallerUrl)
  }
  const executor = new Executor()
  const openExternal = vi.fn(async () => undefined)
  await writeCandidateOptIn(join(userData, 'updates', 'preferences.json'), true)
  const manager = new UpdateManager({
    currentVersion: '1.0.0',
    environment: { packaged: true, channel: 'stable', platform: 'darwin', arch: 'arm64' },
    source,
    executor,
    publicKeyPem: '',
    userData,
    prepareToInstall: vi.fn(async () => undefined),
    openExternal,
    random: () => 0,
    timers: {
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      setInterval: () => 2,
      clearInterval: () => undefined
    }
  })
  return { manager, source, executor, openExternal, stableInstaller, userData }
}

describe('Candidate recovery policy', () => {
  it('rejects data writes unreadable by the active Stable baseline', async () => {
    expect(() => assertCandidateRecoveryCompatible({
      recoveryReads: { minimum: 1, maximum: 1 },
      candidateWrites: 2
    })).toThrow('无法由当前正式版恢复读取')

    const fixture = await managerFixture({ candidateWrites: 2, stableMaximum: 1 })
    await fixture.manager.start()
    await fixture.manager.check('candidate', true)

    expect(fixture.manager.status()).toMatchObject({
      phase: 'error',
      track: 'candidate',
      message: expect.stringContaining('无法由当前正式版恢复读取'),
      manualInstallerAvailable: false
    })
    expect(fixture.executor.check).not.toHaveBeenCalled()
  })

  it('keeps a verified Stable full installer available without deleting userData', async () => {
    const fixture = await managerFixture({ candidateWrites: 1, stableMaximum: 1 })
    const sentinel = join(fixture.userData, 'account-state.json')
    await writeFile(sentinel, 'preserve-me')
    await fixture.manager.start()
    await fixture.manager.check('candidate', true)

    expect(fixture.manager.status()).toMatchObject({
      phase: 'available',
      track: 'candidate',
      manual: true
    })
    await fixture.manager.downloadFullInstaller()
    expect(fixture.openExternal).toHaveBeenCalledWith(fixture.stableInstaller.href)
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('preserve-me')
  })
})
