import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_CHECK_INTERVAL_MS } from '../src/main/update/update-policy'
import { readRequiredUpdatePolicy } from '../src/main/update/required-update-policy'
import { writeSkippedVersion } from '../src/main/update/skipped-version'
import {
  UpdateManager,
  type UpdateManagerResumeSource,
  type UpdateManagerTimers
} from '../src/main/update/update-manager'
import {
  ElectronUpdateExecutor,
  type ExecutorEvent,
  type UpdateExecutor
} from '../src/main/update/update-executor'
import type {
  ResolvedRelease,
  UpdateSource
} from '../src/main/update/update-source'
import type { SignedReleaseManifest, UpdateTarget } from '../src/shared/update-contracts'

const temporaryDirectories: string[] = []
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const target: UpdateTarget = { channel: 'stable', platform: 'darwin', arch: 'arm64' }

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-update-manager-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

function sha512(value: Uint8Array): string {
  return createHash('sha512').update(value).digest('base64')
}

function resolvedRelease(input: {
  version?: string
  mode?: 'optional' | 'required'
  minimumSupportedVersion?: string
  downloadedBytes?: Uint8Array
} = {}): ResolvedRelease {
  const bytes = input.downloadedBytes ?? Buffer.from('verified installer')
  const manifest: SignedReleaseManifest = {
    schema: 'insight-desktop-update/v1',
    version: input.version ?? '1.1.0',
    channel: 'stable',
    publishedAt: '2026-09-04T03:00:00.000Z',
    shellCommit: 'a'.repeat(40),
    coreRuntime: {
      tag: 'insight-runtime-v0.1.1-rc.10',
      commit: 'b'.repeat(40)
    },
    policy: {
      mode: input.mode ?? 'optional',
      minimumSupportedVersion: input.minimumSupportedVersion ?? '1.0.0'
    },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      minimumReadableDataSchema: 1,
      maximumReadableDataSchema: 1
    },
    artifacts: [
      { platform: 'darwin', arch: 'arm64', kind: 'dmg', name: 'app.dmg', size: 1, sha512: sha512(Buffer.from('dmg')) },
      { platform: 'darwin', arch: 'arm64', kind: 'zip', name: 'app.zip', size: bytes.byteLength, sha512: sha512(bytes) },
      { platform: 'darwin', arch: 'arm64', kind: 'blockmap', name: 'app.zip.blockmap', size: 1, sha512: sha512(Buffer.from('map')) },
      { platform: 'darwin', arch: 'arm64', kind: 'updater-metadata', name: 'latest-mac.yml', size: 1, sha512: sha512(Buffer.from('yml')) }
    ]
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
  return {
    manifest,
    manifestBytes,
    signatureBytes: sign(null, manifestBytes, privateKey),
    artifactUrls: new Map(manifest.artifacts.map((artifact) => [
      artifact.name,
      new URL(`https://github.com/Boxser567/insight-desktop-shell/releases/download/v${manifest.version}/${artifact.name}`)
    ]))
  }
}

class FakeExecutor implements UpdateExecutor {
  readonly configure = vi.fn()
  readonly check = vi.fn<UpdateExecutor['check']>()
  readonly download = vi.fn<UpdateExecutor['download']>()
  readonly quitAndInstall = vi.fn()
  readonly listeners = new Set<(event: ExecutorEvent) => void>()

  constructor(version = '1.1.0') {
    this.check.mockResolvedValue({ version })
    this.download.mockResolvedValue(undefined)
  }

  on(listener: (event: ExecutorEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: ExecutorEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

class FakeTimers implements UpdateManagerTimers {
  readonly timeouts = new Map<number, { handler: () => void; delay: number }>()
  readonly intervals = new Map<number, { handler: () => void; delay: number }>()
  readonly cleared = new Set<number>()
  #next = 1

  setTimeout(handler: () => void, delay: number): number {
    const id = this.#next++
    this.timeouts.set(id, { handler, delay })
    return id
  }

  clearTimeout(id: unknown): void {
    this.cleared.add(id as number)
    this.timeouts.delete(id as number)
  }

  setInterval(handler: () => void, delay: number): number {
    const id = this.#next++
    this.intervals.set(id, { handler, delay })
    return id
  }

  clearInterval(id: unknown): void {
    this.cleared.add(id as number)
    this.intervals.delete(id as number)
  }
}

class FakeResumeSource implements UpdateManagerResumeSource {
  listener?: () => void
  subscribe(listener: () => void): () => void {
    this.listener = listener
    return () => { this.listener = undefined }
  }
}

async function setup(input: {
  release?: ResolvedRelease
  source?: UpdateSource
  executor?: FakeExecutor
  currentVersion?: string
  packaged?: boolean
  channel?: 'development' | 'stable'
  now?: () => number
  prepareToInstall?: () => Promise<void>
} = {}) {
  const userData = await temporaryDirectory()
  const release = input.release ?? resolvedRelease()
  const source = input.source ?? {
    resolve: vi.fn().mockResolvedValue(release)
  }
  const executor = input.executor ?? new FakeExecutor(release.manifest.version)
  const timers = new FakeTimers()
  const resume = new FakeResumeSource()
  const prepareToInstall = input.prepareToInstall ?? vi.fn().mockResolvedValue(undefined)
  const manager = new UpdateManager({
    currentVersion: input.currentVersion ?? '1.0.0',
    environment: {
      packaged: input.packaged ?? true,
      channel: input.channel ?? 'stable',
      platform: 'darwin',
      arch: 'arm64'
    },
    source,
    executor,
    publicKeyPem,
    userData,
    prepareToInstall,
    now: input.now,
    random: () => 0,
    timers,
    resume
  })
  return { manager, release, source, executor, timers, resume, userData, prepareToInstall }
}

describe('desktop update manager', () => {
  it('creates one startup timer, one six-hour interval and cleans them on stop', async () => {
    const { manager, executor, timers, resume } = await setup()

    await manager.start()

    expect(executor.configure).toHaveBeenCalledWith({ channel: 'stable', autoInstallOnQuit: false })
    expect([...timers.timeouts.values()].map(({ delay }) => delay)).toEqual([15_000])
    expect([...timers.intervals.values()].map(({ delay }) => delay)).toEqual([UPDATE_CHECK_INTERVAL_MS])
    expect(resume.listener).toBeTypeOf('function')
    await manager.stop()
    expect(timers.timeouts).toHaveLength(0)
    expect(timers.intervals).toHaveLength(0)
    expect(resume.listener).toBeUndefined()
    expect(executor.listeners).toHaveLength(0)
  })

  it('coalesces concurrent checks into one authenticated source and executor operation', async () => {
    let finish: ((release: ResolvedRelease) => void) | undefined
    const release = resolvedRelease()
    const source: UpdateSource = {
      resolve: vi.fn(() => new Promise<ResolvedRelease>((resolve) => { finish = resolve }))
    }
    const { manager, executor } = await setup({ release, source })
    await manager.start()

    const first = manager.check(true)
    const second = manager.check(true)
    await Promise.resolve()
    expect(source.resolve).toHaveBeenCalledOnce()
    finish?.(release)
    await Promise.all([first, second])

    expect(executor.check).toHaveBeenCalledOnce()
    expect(manager.status()).toMatchObject({ phase: 'available', availableVersion: '1.1.0' })
  })

  it('does not consult the executor when the authenticated source fails', async () => {
    const source: UpdateSource = { resolve: vi.fn().mockRejectedValue(new Error('bad signature')) }
    const { manager, executor } = await setup({ source })
    await manager.start()

    await manager.check(true)

    expect(executor.check).not.toHaveBeenCalled()
    expect(manager.status()).toMatchObject({ phase: 'error', required: false })
  })

  it.each(['1.0.0', '0.9.0'])('does not offer current or older version %s', async (version) => {
    const { manager, executor } = await setup({ release: resolvedRelease({ version }) })
    await manager.start()

    await manager.check(true)

    expect(executor.check).not.toHaveBeenCalled()
    expect(manager.status().phase).toBe('up-to-date')
  })

  it('suppresses a skipped optional version automatically but shows it manually', async () => {
    const { manager, executor, userData } = await setup()
    await writeSkippedVersion(join(userData, 'updates', 'skipped-version.json'), '1.1.0')
    await manager.start()

    await manager.check(false)
    expect(manager.status().phase).toBe('idle')
    expect(executor.check).not.toHaveBeenCalled()
    await manager.check(true)
    expect(manager.status().phase).toBe('available')
    expect(executor.check).toHaveBeenCalledOnce()
  })

  it('persists an optional skip request and ignores a skip request for a required update', async () => {
    const optional = await setup()
    await optional.manager.start()
    await optional.manager.check(true)
    await optional.manager.skip('1.1.0')
    expect(optional.manager.status().phase).toBe('idle')
    await expect(readFile(
      join(optional.userData, 'updates', 'skipped-version.json'),
      'utf8'
    )).resolves.toContain('1.1.0')

    const required = await setup({
      release: resolvedRelease({ mode: 'required', minimumSupportedVersion: '1.1.0' })
    })
    await required.manager.start()
    await required.manager.check(true)
    await required.manager.skip('1.1.0')
    expect(required.manager.status()).toMatchObject({ phase: 'available', required: true })
    await expect(readFile(
      join(required.userData, 'updates', 'skipped-version.json')
    )).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists only an applicable required policy and restores it after restart', async () => {
    const release = resolvedRelease({ mode: 'required', minimumSupportedVersion: '1.1.0' })
    const first = await setup({ release })
    await first.manager.start()
    await first.manager.check(false)

    expect(first.manager.status()).toMatchObject({ phase: 'available', required: true })
    await expect(readRequiredUpdatePolicy({
      path: join(first.userData, 'updates', 'required-policy.json'),
      publicKeyPem,
      target,
      currentVersion: '1.0.0'
    })).resolves.toBeDefined()

    const restarted = new UpdateManager({
      currentVersion: '1.0.0',
      environment: { packaged: true, channel: 'stable', platform: 'darwin', arch: 'arm64' },
      source: first.source,
      executor: first.executor,
      publicKeyPem,
      userData: first.userData,
      prepareToInstall: vi.fn().mockResolvedValue(undefined),
      timers: new FakeTimers(),
      resume: new FakeResumeSource(),
      random: () => 0
    })
    await restarted.start()
    expect(restarted.status()).toMatchObject({ phase: 'available', required: true })

    vi.mocked(first.source.resolve).mockResolvedValue(resolvedRelease({
      version: '1.2.0',
      mode: 'optional'
    }))
    first.executor.check.mockResolvedValue({ version: '1.2.0' })
    await restarted.check(true)
    expect(restarted.status()).toMatchObject({
      phase: 'available',
      availableVersion: '1.2.0',
      required: true
    })
    await expect(readFile(join(first.userData, 'updates', 'required-policy.json'))).resolves.toBeDefined()
  })

  it('does not persist required policy when the current version meets the minimum', async () => {
    const release = resolvedRelease({ mode: 'required', minimumSupportedVersion: '1.0.0' })
    const { manager, userData } = await setup({ release })
    await manager.start()
    await manager.check(false)

    expect(manager.status()).toMatchObject({ phase: 'available', required: false })
    await expect(readFile(join(userData, 'updates', 'required-policy.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never starts a download while merely checking and offering an update', async () => {
    const { manager, executor } = await setup()
    await manager.start()
    await manager.check(false)

    expect(executor.download).not.toHaveBeenCalled()
  })

  it('verifies the downloaded size and SHA512 before allowing installation', async () => {
    const downloadedBytes = Buffer.from('verified installer')
    const release = resolvedRelease({ downloadedBytes })
    const executor = new FakeExecutor(release.manifest.version)
    const { manager, userData } = await setup({ release, executor })
    const downloadedFile = join(userData, 'app.zip')
    await writeFile(downloadedFile, downloadedBytes)
    executor.download.mockImplementation(async () => {
      executor.emit({ type: 'downloaded', version: '1.1.0', downloadedFile })
    })
    await manager.start()
    await manager.check(true)

    await manager.download()

    expect(manager.status()).toMatchObject({ phase: 'downloaded', availableVersion: '1.1.0' })
    await expect(readFile(downloadedFile)).resolves.toEqual(downloadedBytes)
  })

  it('deletes only a mismatched downloaded installer and preserves sibling data', async () => {
    const release = resolvedRelease()
    const executor = new FakeExecutor(release.manifest.version)
    const { manager, userData } = await setup({ release, executor })
    const downloadedFile = join(userData, 'app.zip')
    const sibling = join(userData, 'keep.txt')
    await writeFile(downloadedFile, 'forged')
    await writeFile(sibling, 'keep')
    executor.download.mockImplementation(async () => {
      executor.emit({ type: 'downloaded', version: '1.1.0', downloadedFile })
    })
    await manager.start()
    await manager.check(true)

    await manager.download()

    expect(manager.status()).toMatchObject({ phase: 'error', required: false })
    await expect(readFile(downloadedFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(sibling, 'utf8')).resolves.toBe('keep')
  })

  it('prepares once before one install and never installs when preparation fails', async () => {
    const success = await setup()
    await success.manager.start()
    await success.manager.check(true)
    const file = join(success.userData, 'app.zip')
    await writeFile(file, 'verified installer')
    success.executor.download.mockImplementation(async () => {
      success.executor.emit({ type: 'downloaded', version: '1.1.0', downloadedFile: file })
    })
    await success.manager.download()

    await Promise.all([success.manager.install(), success.manager.install()])
    expect(success.prepareToInstall).toHaveBeenCalledOnce()
    expect(success.executor.quitAndInstall).toHaveBeenCalledOnce()

    const prepareToInstall = vi.fn().mockRejectedValue(new Error('workspace stop failed'))
    const failure = await setup({ prepareToInstall })
    await failure.manager.start()
    await failure.manager.check(true)
    const failedFile = join(failure.userData, 'app.zip')
    await writeFile(failedFile, 'verified installer')
    failure.executor.download.mockImplementation(async () => {
      failure.executor.emit({ type: 'downloaded', version: '1.1.0', downloadedFile: failedFile })
    })
    await failure.manager.download()
    await failure.manager.install()

    expect(failure.executor.quitAndInstall).not.toHaveBeenCalled()
    expect(failure.manager.status()).toMatchObject({ phase: 'error', message: 'workspace stop failed' })
  })

  it('checks on system resume only after six hours have elapsed', async () => {
    let now = 1_000
    const { manager, source, resume } = await setup({ now: () => now })
    await manager.start()
    await manager.check(false)
    vi.mocked(source.resolve).mockClear()

    now += UPDATE_CHECK_INTERVAL_MS - 1
    resume.listener?.()
    await Promise.resolve()
    expect(source.resolve).not.toHaveBeenCalled()
    now += 1
    resume.listener?.()
    await vi.waitFor(() => expect(source.resolve).toHaveBeenCalledOnce())
  })

  it('does not configure or start a real updater for development and unpackaged clients', async () => {
    for (const options of [
      { packaged: false, channel: 'stable' as const },
      { packaged: true, channel: 'development' as const }
    ]) {
      const { manager, source, executor, timers } = await setup(options)
      await manager.start()
      expect(manager.status().phase).toBe('unsupported')
      expect(source.resolve).not.toHaveBeenCalled()
      expect(executor.configure).not.toHaveBeenCalled()
      expect(timers.timeouts).toHaveLength(0)
      expect(timers.intervals).toHaveLength(0)
    }
  })

  it('configures electron-updater defensively and translates its events', async () => {
    const handlers = new Map<string, (...args: never[]) => void>()
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      allowDowngrade: true,
      on: vi.fn((name: string, handler: (...args: never[]) => void) => {
        handlers.set(name, handler)
        return updater
      }),
      checkForUpdates: vi.fn().mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { version: '1.1.0' }
      }),
      downloadUpdate: vi.fn().mockResolvedValue(['/tmp/app.zip']),
      quitAndInstall: vi.fn()
    }
    const executor = new ElectronUpdateExecutor(updater as never)
    const events: ExecutorEvent[] = []
    executor.on((event) => events.push(event))

    executor.configure({ channel: 'candidate', autoInstallOnQuit: false })
    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: true,
      allowDowngrade: false
    })
    await expect(executor.check()).resolves.toEqual({ version: '1.1.0' })
    await executor.download()
    executor.quitAndInstall()
    handlers.get('update-available')?.({ version: '1.1.0' } as never)
    handlers.get('update-not-available')?.({ version: '1.0.0' } as never)
    handlers.get('download-progress')?.({ percent: 42 } as never)
    handlers.get('update-downloaded')?.({
      version: '1.1.0',
      downloadedFile: '/tmp/app.zip'
    } as never)
    handlers.get('error')?.(new Error('offline') as never)

    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
    expect(events).toEqual([
      { type: 'available', version: '1.1.0' },
      { type: 'not-available', version: '1.0.0' },
      { type: 'progress', percent: 42 },
      { type: 'downloaded', version: '1.1.0', downloadedFile: '/tmp/app.zip' },
      { type: 'error', message: 'offline' }
    ])
  })
})
