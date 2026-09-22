import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import semver from 'semver'
import {
  readRequiredUpdatePolicy,
  requiredUpdatePolicyPath,
  writeRequiredUpdatePolicyV2
} from '../src/main/update/required-update-policy'
import { ElectronUpdateExecutor, type ExecutorEvent, type UpdateExecutor } from '../src/main/update/update-executor'
import { UpdateManager, type UpdateManagerTimers } from '../src/main/update/update-manager'
import {
  createUpdatePreferenceService,
  migrateLegacyCandidatePreference,
  readUpdatePreferences,
  updatePreferencesPath
} from '../src/main/update/update-preferences'
import type { ResolvedV2Release, V2UpdateSource } from '../src/main/update/update-source'
import { updateViewModel } from '../src/renderer/src/update-view-model'
import { shouldShowUpdateEntry } from '../src/shared/update-visibility'
import type {
  RolloutPayload,
  SignedReleaseIndex,
  SignedTargetManifest,
  UpdateStatus
} from '../src/shared/update-contracts'

const temporaryDirectories: string[] = []
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

function digest(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64')
}

function signedJson(value: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  return { bytes, signature: sign(null, bytes, privateKey) }
}

function releaseFixture() {
  const target = { platform: 'darwin' as const, arch: 'arm64' as const }
  const checksum = Buffer.alloc(64, 4).toString('base64')
  const manifest: SignedTargetManifest = {
    schema: 'insight-desktop-target/v2',
    version: '1.0.0',
    target,
    shellCommit: 'a'.repeat(40),
    coreRuntime: { tag: 'runtime-v1', commit: 'b'.repeat(40) },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      readsDataSchema: { minimum: 1, maximum: 1 },
      writesDataSchema: 1
    },
    artifacts: [
      { ...target, kind: 'dmg', name: 'insight-1.0.0-mac-arm64.dmg', size: 1, sha512: checksum },
      { ...target, kind: 'zip', name: 'insight-1.0.0-mac-arm64.zip', size: 1, sha512: checksum },
      { ...target, kind: 'blockmap', name: 'insight-1.0.0-mac-arm64.zip.blockmap', size: 1, sha512: checksum },
      { ...target, kind: 'updater-metadata', name: 'latest-mac.yml', size: 1, sha512: checksum }
    ]
  }
  const authenticatedManifest = signedJson(manifest)
  const index: SignedReleaseIndex = {
    schema: 'insight-desktop-release/v2',
    version: '1.0.0',
    shellCommit: manifest.shellCommit,
    coreRuntime: manifest.coreRuntime,
    targets: [
      { id: 'darwin-arm64', manifestSha512: digest(authenticatedManifest.bytes) },
      { id: 'darwin-x64', manifestSha512: Buffer.alloc(64, 5).toString('base64') },
      { id: 'win32-x64', manifestSha512: Buffer.alloc(64, 6).toString('base64') }
    ]
  }
  const authenticatedIndex = signedJson(index)
  const resolved = (track: 'candidate' | 'stable'): ResolvedV2Release => {
    const payload: RolloutPayload = {
      schema: 'insight-desktop-rollout/v2',
      track,
      version: '1.0.0',
      ...(track === 'candidate' ? { target: 'darwin-arm64' as const } : {}),
      referencedSha512: track === 'candidate'
        ? digest(authenticatedManifest.bytes)
        : digest(authenticatedIndex.bytes),
      policy: { mode: 'optional', minimumSupportedVersion: '1.0.0-rc.18' },
      publishedAt: '2026-09-22T12:00:00.000Z'
    }
    return {
      rollout: payload,
      rolloutEnvelopeBytes: Buffer.from(track),
      ...(track === 'stable'
        ? {
            releaseIndex: index,
            releaseIndexBytes: authenticatedIndex.bytes,
            releaseIndexSignatureBytes: authenticatedIndex.signature
          }
        : {}),
      manifest,
      manifestBytes: authenticatedManifest.bytes,
      signatureBytes: authenticatedManifest.signature,
      releaseBaseUrl: new URL('https://updates.example.test/desktop/releases/v1.0.0/targets/darwin-arm64/'),
      manualInstallerUrl: new URL('https://updates.example.test/desktop/releases/v1.0.0/targets/darwin-arm64/insight-1.0.0-mac-arm64.dmg')
    }
  }
  return { manifest, authenticatedManifest, index, authenticatedIndex, resolved }
}

class Timers implements UpdateManagerTimers {
  readonly timeouts: Array<{ handler: () => void; delay: number }> = []
  readonly intervals: Array<{ handler: () => void; delay: number }> = []
  setTimeout(handler: () => void, delay: number): number {
    this.timeouts.push({ handler, delay }); return this.timeouts.length
  }
  clearTimeout(): void {}
  setInterval(handler: () => void, delay: number): number {
    this.intervals.push({ handler, delay }); return this.intervals.length
  }
  clearInterval(): void {}
}

class Executor implements UpdateExecutor {
  readonly configure = vi.fn()
  readonly useRelease = vi.fn()
  readonly check = vi.fn(async () => ({ version: '1.0.0' }))
  readonly download = vi.fn(async () => undefined)
  readonly quitAndInstall = vi.fn()
  on(_listener: (event: ExecutorEvent) => void): () => void { return () => undefined }
}

function sourceFixture(release: ReturnType<typeof releaseFixture>): V2UpdateSource {
  return {
    resolve: vi.fn(async (track) => release.resolved(track)),
    resolveRecoveryBaseline: vi.fn(async () => ({
      version: '1.0.0-rc.18',
      source: 'bridge' as const,
      readsDataSchema: { minimum: 1, maximum: 1 },
      manualInstallerUrl: new URL('https://updates.example.test/desktop/releases/v1.0.0-rc.18/bridge.dmg')
    })),
    v2ReleaseBaseUrl: vi.fn(() => release.resolved('stable').releaseBaseUrl),
    v2ManualInstallerUrl: vi.fn(() => release.resolved('stable').manualInstallerUrl)
  }
}

async function manager(input: {
  currentVersion: string
  userData: string
  source: V2UpdateSource
  timers: Timers
  executor: Executor
}) {
  const value = new UpdateManager({
    currentVersion: input.currentVersion,
    environment: { packaged: true, channel: 'stable', platform: 'darwin', arch: 'arm64' },
    source: input.source,
    preferences: createUpdatePreferenceService(updatePreferencesPath(input.userData)),
    executor: input.executor,
    publicKeyPem,
    userData: input.userData,
    prepareToInstall: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    random: () => 0,
    timers: input.timers
  })
  await value.start()
  return value
}

describe('rc.18 bridge to v2 Stable integration', () => {
  it('moves rc.17 through rc.18 into the same Candidate and Stable 1.0.0 bytes', async () => {
    expect(semver.gt('1.0.0-rc.18', '1.0.0-rc.17')).toBe(true)
    const nativeUpdater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      allowDowngrade: true,
      setFeedURL: vi.fn(), on: vi.fn().mockReturnThis(),
      checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn()
    }
    new ElectronUpdateExecutor(nativeUpdater as never).configure({
      currentVersion: '1.0.0-rc.17', autoInstallOnQuit: false
    })
    expect(nativeUpdater.allowPrerelease).toBe(true)
    expect(nativeUpdater.allowDowngrade).toBe(false)

    const userData = await mkdtemp(join(tmpdir(), 'update-v2-bridge-'))
    temporaryDirectories.push(userData)
    const preferencePath = updatePreferencesPath(userData)
    await expect(migrateLegacyCandidatePreference({
      path: preferencePath,
      packagedChannel: 'candidate',
      currentVersion: '1.0.0-rc.18'
    })).resolves.toBe(true)

    const release = releaseFixture()
    const source = sourceFixture(release)
    const candidateTimers = new Timers()
    const candidateExecutor = new Executor()
    const candidate = await manager({
      currentVersion: '1.0.0-rc.18', userData, source,
      timers: candidateTimers, executor: candidateExecutor
    })
    expect(candidateTimers.timeouts).toHaveLength(1)
    expect(candidateTimers.intervals).toHaveLength(1)
    expect(source.resolve).not.toHaveBeenCalled()
    await candidate.check('candidate', true)
    const candidateStatus = candidate.status()
    expect(candidateStatus).toMatchObject({
      phase: 'available', track: 'candidate', availableVersion: '1.0.0', manual: true
    })
    expect(shouldShowUpdateEntry(candidateStatus)).toBe(false)
    expect(candidateExecutor.check).toHaveBeenCalledOnce()
    await candidate.stop()

    const stableExecutor = new Executor()
    const stable = await manager({
      currentVersion: '1.0.0', userData, source,
      timers: new Timers(), executor: stableExecutor
    })
    await stable.check('stable', true)
    expect(stable.status()).toMatchObject({
      phase: 'up-to-date',
      track: 'stable',
      promotedFromCandidate: true
    })
    expect(updateViewModel(stable.status()).title).toBe('当前版本已转为正式版')
    expect(stableExecutor.check).not.toHaveBeenCalled()
    expect(digest(release.resolved('candidate').manifestBytes)).toBe(
      digest(release.resolved('stable').manifestBytes)
    )

    const cleanUserData = await mkdtemp(join(tmpdir(), 'update-v2-clean-'))
    temporaryDirectories.push(cleanUserData)
    await expect(readUpdatePreferences(updatePreferencesPath(cleanUserData)))
      .resolves.toEqual({ candidateOptIn: false })
  })

  it('restores a required Stable v2 trust chain across restart', async () => {
    const release = releaseFixture()
    const payload: RolloutPayload = {
      ...release.resolved('stable').rollout,
      policy: { mode: 'required', minimumSupportedVersion: '1.0.0' }
    }
    const payloadBytes = Buffer.from(JSON.stringify(payload))
    const rolloutEnvelopeBytes = Buffer.from(JSON.stringify({
      schema: 'insight-desktop-rollout-envelope/v2',
      payloadBase64: payloadBytes.toString('base64'),
      signatureBase64: sign(null, payloadBytes, privateKey).toString('base64')
    }))
    const userData = await mkdtemp(join(tmpdir(), 'update-v2-required-'))
    temporaryDirectories.push(userData)
    const path = requiredUpdatePolicyPath(userData)
    await writeRequiredUpdatePolicyV2({
      path,
      rolloutEnvelopeBytes,
      releaseIndexBytes: release.authenticatedIndex.bytes,
      releaseIndexSignatureBytes: release.authenticatedIndex.signature,
      targetManifestBytes: release.authenticatedManifest.bytes,
      targetManifestSignatureBytes: release.authenticatedManifest.signature,
      publicKeyPem,
      target: { channel: 'stable', platform: 'darwin', arch: 'arm64' }
    })
    await expect(readRequiredUpdatePolicy({
      path,
      publicKeyPem,
      target: { channel: 'stable', platform: 'darwin', arch: 'arm64' },
      currentVersion: '1.0.0-rc.18'
    })).resolves.toMatchObject({ schema: 2, manifest: { version: '1.0.0' } })
  })

  it('keeps Candidate availability outside the global badge contract', () => {
    const status: UpdateStatus = {
      phase: 'available',
      currentVersion: '1.0.0-rc.18',
      availableVersion: '1.0.0',
      track: 'candidate',
      required: false,
      manual: true
    }
    expect(shouldShowUpdateEntry(status)).toBe(false)
  })
})
