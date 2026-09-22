import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { release as systemRelease } from 'node:os'
import semver from 'semver'
import {
  readRequiredUpdatePolicy,
  writeRequiredUpdatePolicy,
  writeRequiredUpdatePolicyV2
} from './required-update-policy'
import {
  readSkippedVersion,
  writeSkippedVersion
} from './skipped-version'
import {
  createUpdatePreferenceService,
  updatePreferencesPath,
  type UpdatePreferenceService
} from './update-preferences'
import {
  AUTO_INSTALL_ON_APP_QUIT,
  UPDATE_CHECK_INTERVAL_MS,
  isUpdateCheckDue,
  resolveUpdateSupport,
  shouldSuppressSkippedUpdate,
  startupCheckDelay
} from './update-policy'
import { initialUpdateStatus, reduceUpdateState } from './update-state'
import type { UpdateExecutor, ExecutorEvent } from './update-executor'
import type {
  AnyResolvedRelease,
  AnyUpdateSource,
  ResolvedV2Release,
  UpdateSource,
  V2UpdateSource
} from './update-source'
import type {
  ReleaseArtifact,
  SignedReleaseManifest,
  SignedTargetManifest,
  UpdateTrack,
  UpdateStatus
} from '../../shared/update-contracts'
import type { UpdateEnvironment, UpdateSupport } from './update-policy'

export interface UpdateManagerTimers {
  setTimeout(handler: () => void, delay: number): unknown
  clearTimeout(id: unknown): void
  setInterval(handler: () => void, delay: number): unknown
  clearInterval(id: unknown): void
}

export interface UpdateManagerResumeSource {
  subscribe(listener: () => void): () => void
}

export interface UpdateManagerOptions {
  currentVersion: string
  environment: UpdateEnvironment
  source: AnyUpdateSource
  preferences?: UpdatePreferenceService
  executor: UpdateExecutor
  publicKeyPem: string
  userData: string
  prepareToInstall(): Promise<void>
  openExternal(url: string): Promise<void>
  now?: () => number
  systemRelease?: () => string
  random?: () => number
  timers?: UpdateManagerTimers
  resume?: UpdateManagerResumeSource
}

interface DownloadCompletion {
  promise: Promise<void>
  resolve(): void
  reject(error: unknown): void
}

const systemTimers: UpdateManagerTimers = {
  setTimeout: (handler, delay) => setTimeout(handler, delay),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (handler, delay) => setInterval(handler, delay),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>)
}

/** Coordinate authenticated release discovery with a platform update executor. */
export class UpdateManager {
  private readonly support: UpdateSupport
  private readonly listeners = new Set<(status: UpdateStatus) => void>()
  private readonly now: () => number
  private readonly random: () => number
  private readonly timers: UpdateManagerTimers
  private statusValue: UpdateStatus
  private operation?: Promise<void>
  private startupTimer?: unknown
  private intervalTimer?: unknown
  private removeResumeListener?: () => void
  private removeExecutorListener?: () => void
  private activeManifest?: SignedReleaseManifest | SignedTargetManifest
  private activeReleaseBaseUrl?: URL
  private manualInstallerUrl?: URL
  private executorVersion?: string
  private downloadCompletion?: DownloadCompletion
  private lastStableCheckedAt?: number
  private started = false

  constructor(private readonly options: UpdateManagerOptions) {
    this.support = resolveUpdateSupport(options.environment)
    this.statusValue = initialUpdateStatus(options.currentVersion)
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.timers = options.timers ?? systemTimers
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    if (!this.support.supported) {
      this.publish({
        phase: 'unsupported',
        currentVersion: this.options.currentVersion,
        track: 'stable',
        reason: this.support.reason,
        manual: false
      })
      return
    }

    this.options.executor.configure({
      currentVersion: this.options.currentVersion,
      autoInstallOnQuit: AUTO_INSTALL_ON_APP_QUIT
    })
    this.removeExecutorListener = this.options.executor.on((event) => this.onExecutorEvent(event))
    await this.restoreRequiredPolicy()
    this.startupTimer = this.timers.setTimeout(
      () => void this.check('stable', false),
      startupCheckDelay(this.random)
    )
    this.intervalTimer = this.timers.setInterval(
      () => void this.check('stable', false),
      UPDATE_CHECK_INTERVAL_MS
    )
    this.removeResumeListener = this.options.resume?.subscribe(() => {
      if (isUpdateCheckDue(this.lastStableCheckedAt, this.now())) {
        void this.check('stable', false)
      }
    })
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    if (this.startupTimer !== undefined) this.timers.clearTimeout(this.startupTimer)
    if (this.intervalTimer !== undefined) this.timers.clearInterval(this.intervalTimer)
    this.startupTimer = undefined
    this.intervalTimer = undefined
    this.removeResumeListener?.()
    this.removeResumeListener = undefined
    await this.operation?.catch(() => undefined)
    this.removeExecutorListener?.()
    this.removeExecutorListener = undefined
  }

  status(): UpdateStatus {
    return this.statusValue
  }

  subscribe(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  check(track: UpdateTrack, manual: boolean): Promise<void> {
    if (!this.started) return Promise.reject(new Error('更新管理器尚未启动。'))
    if (track === 'candidate' && !manual) {
      return Promise.reject(new Error('内测更新只能由用户手动检查。'))
    }
    if (!this.support.supported) {
      if (manual) {
        this.publish({
          phase: 'unsupported',
          currentVersion: this.options.currentVersion,
          track,
          reason: this.support.reason,
          manual: true
        })
      }
      return Promise.resolve()
    }
    if (['checking', 'downloading', 'downloaded', 'installing'].includes(this.statusValue.phase)) {
      return Promise.resolve()
    }
    return this.run(async () => {
      if (track === 'candidate') {
        const preferences = await this.preferences().read()
        if (!preferences.candidateOptIn) {
          throw new Error('请先在“关于因赛AI”中加入内测。')
        }
      }
      await this.performCheck(track, manual)
    })
  }

  download(): Promise<void> {
    return this.run(() => this.performDownload())
  }

  downloadFullInstaller(): Promise<void> {
    return this.run(async () => {
      const status = this.statusValue
      if (
        !this.manualInstallerUrl ||
        (status.phase !== 'available' && status.phase !== 'error')
      ) {
        throw new Error('没有可下载的可信完整安装包。')
      }
      await this.options.openExternal(this.manualInstallerUrl.href)
    })
  }

  skip(version: string): Promise<void> {
    return this.run(async () => {
      const status = this.statusValue
      if (status.phase !== 'available' || status.availableVersion !== version) {
        throw new Error('只能跳过当前可用版本。')
      }
      if (status.required) return
      if (status.track === 'stable') {
        await writeSkippedVersion(this.skippedVersionPath(), version)
      }
      this.clearActiveRelease()
      this.publish(initialUpdateStatus(this.options.currentVersion))
    })
  }

  install(): Promise<void> {
    return this.run(() => this.performInstall())
  }

  private async performCheck(track: UpdateTrack, manual: boolean): Promise<void> {
    if (!this.support.supported) return
    const previous = this.statusValue
    const cachedRequired = isRequiredStatus(previous)
    if (cachedRequired && track === 'candidate') {
      throw new Error('必须先完成正式强制更新。')
    }
    let verifiedContext: ReturnType<typeof versionContext> | undefined
    if (!cachedRequired) this.clearActiveRelease()
    this.publish(reduceUpdateState(previous, { type: 'check', track, manual }))
    try {
      const release = await this.options.source.resolve(track, this.support.target)
      if (track === 'stable') this.lastStableCheckedAt = this.now()
      const version = releaseVersion(release)
      if (!semver.gt(version, this.options.currentVersion)) {
        if (cachedRequired) {
          throw new Error('可信发布记录不能解除尚未满足的强制更新。')
        }
        this.clearActiveRelease()
        this.publish(reduceUpdateState(this.statusValue, { type: 'up-to-date' }))
        return
      }

      if (release.minimumSystemVersion) {
        const currentSystem = semver.coerce((this.options.systemRelease ?? systemRelease)())
        if (!currentSystem || semver.lt(currentSystem, release.minimumSystemVersion)) {
          this.clearActiveRelease()
          this.publish({
            phase: 'unsupported',
            currentVersion: this.options.currentVersion,
            track,
            manual,
            reason: this.support.target.platform === 'darwin' && release.minimumSystemVersion === '22.0.0'
              ? '此更新需要 macOS 13 或更高版本，请先升级 macOS。'
              : `此更新需要系统内核版本 ${release.minimumSystemVersion} 或更高版本。`
          })
          return
        }
      }

      const policy = releasePolicy(release)
      const manifestRequiresUpdate = track === 'stable' && policy.mode === 'required' && semver.lt(
        this.options.currentVersion,
        policy.minimumSupportedVersion
      )
      const required = cachedRequired || manifestRequiresUpdate
      if (shouldSuppressSkippedUpdate({
        availableVersion: version,
        skippedVersion: await readSkippedVersion(this.skippedVersionPath()),
        manual: manual || track === 'candidate',
        required
      })) {
        this.clearActiveRelease()
        this.publish(initialUpdateStatus(
          this.options.currentVersion,
          new Date(this.lastStableCheckedAt ?? this.now()).toISOString()
        ))
        return
      }

      verifiedContext = {
        version,
        required,
        manual
      }
      this.bindRelease(release)
      if (manifestRequiresUpdate) {
        if (isV2Release(release)) {
          if (!release.releaseIndexBytes || !release.releaseIndexSignatureBytes) {
            throw new Error('Stable 更新缺少完整 Release Index 可信链。')
          }
          await writeRequiredUpdatePolicyV2({
            path: this.requiredPolicyPath(),
            rolloutEnvelopeBytes: release.rolloutEnvelopeBytes,
            releaseIndexBytes: release.releaseIndexBytes,
            releaseIndexSignatureBytes: release.releaseIndexSignatureBytes,
            targetManifestBytes: release.manifestBytes,
            targetManifestSignatureBytes: release.signatureBytes,
            publicKeyPem: this.options.publicKeyPem,
            target: { ...this.support.target, channel: 'stable' }
          })
        } else {
          await writeRequiredUpdatePolicy({
            path: this.requiredPolicyPath(),
            manifestBytes: release.manifestBytes,
            signatureBytes: release.signatureBytes,
            publicKeyPem: this.options.publicKeyPem,
            target: { ...this.support.target, channel: 'stable' }
          })
        }
      } else if (!cachedRequired && track === 'stable') {
        await rm(this.requiredPolicyPath(), { force: true })
      }
      const executorUpdate = await this.options.executor.check()
      if (executorUpdate?.version !== version) {
        throw new Error('平台更新器版本与可信发布记录不一致。')
      }
      this.executorVersion = executorUpdate.version
      this.publish(reduceUpdateState(this.statusValue, {
        type: 'available',
        version,
        required,
        manual
      }))
    } catch (error) {
      if (track === 'stable') this.lastStableCheckedAt = this.now()
      this.fail(error, previous, verifiedContext)
    }
  }

  private async performDownload(): Promise<void> {
    const status = this.statusValue
    if (status.phase !== 'available' || !this.activeManifest) {
      throw new Error('没有可下载的可信更新。')
    }
    try {
      if (this.executorVersion !== status.availableVersion) {
        if (!this.activeReleaseBaseUrl) {
          throw new Error('可信更新下载地址不可用。')
        }
        this.options.executor.useRelease(this.activeReleaseBaseUrl)
        const update = await this.options.executor.check()
        if (update?.version !== status.availableVersion) {
          throw new Error('平台更新器版本与可信发布记录不一致。')
        }
        this.executorVersion = update.version
      }
      const completion = deferred()
      this.downloadCompletion = completion
      await this.options.executor.download()
      await completion.promise
      // The artifact has been verified at this point. Installation is part of
      // the same user-approved update action; do not leave a second click in
      // the transient `downloaded` state.
      await this.performInstall()
    } catch (error) {
      this.fail(error, status)
    } finally {
      this.downloadCompletion = undefined
    }
  }

  private async performInstall(): Promise<void> {
    const status = this.statusValue
    if (status.phase === 'installing') return
    if (status.phase !== 'downloaded') throw new Error('更新尚未下载完成。')
    this.publish(reduceUpdateState(status, {
      type: 'installing',
      version: status.availableVersion,
      required: status.required,
      manual: status.manual
    }))
    try {
      await this.options.prepareToInstall()
      this.options.executor.quitAndInstall()
    } catch (error) {
      this.fail(error, status)
    }
  }

  private onExecutorEvent(event: ExecutorEvent): void {
    const status = this.statusValue
    if (event.type === 'progress' && (status.phase === 'available' || status.phase === 'downloading')) {
      this.publish(reduceUpdateState(status, {
        type: 'progress',
        version: status.availableVersion,
        required: status.required,
        percent: event.percent,
        manual: status.manual
      }))
      return
    }
    if (event.type === 'downloaded') {
      void this.verifyDownloaded(event).then(
        () => this.downloadCompletion?.resolve(),
        (error: unknown) => this.downloadCompletion?.reject(error)
      )
      return
    }
    if (event.type === 'error') {
      const error = new Error(event.message)
      if (this.downloadCompletion) {
        this.downloadCompletion.reject(error)
      } else if (status.phase === 'installing') {
        this.fail(error, status)
      }
    }
  }

  private async verifyDownloaded(
    event: Extract<ExecutorEvent, { type: 'downloaded' }>
  ): Promise<void> {
    const status = this.statusValue
    if (
      (status.phase !== 'available' && status.phase !== 'downloading') ||
      !this.activeManifest ||
      event.version !== status.availableVersion
    ) {
      throw new Error('下载完成事件与当前更新不一致。')
    }
    const artifact = downloadedArtifact(
      this.activeManifest,
      this.options.environment.platform,
      this.options.environment.arch
    )
    try {
      await verifyFile(event.downloadedFile, artifact)
    } catch (error) {
      await rm(event.downloadedFile, { force: true })
      throw error
    }
    this.publish(reduceUpdateState(status, {
      type: 'downloaded',
      version: status.availableVersion,
      required: status.required,
      manual: status.manual
    }))
  }

  private async restoreRequiredPolicy(): Promise<void> {
    if (!this.support.supported) return
    const cached = await readRequiredUpdatePolicy({
      path: this.requiredPolicyPath(),
      publicKeyPem: this.options.publicKeyPem,
      target: { ...this.support.target, channel: 'stable' },
      currentVersion: this.options.currentVersion
    })
    if (!cached) return
    this.activeManifest = cached.manifest
    if (cached.schema === 1) {
      if (!isV1Source(this.options.source)) return
      this.activeReleaseBaseUrl = this.options.source.releaseBaseUrl(
        cached.manifest.channel,
        cached.manifest.version
      )
      this.manualInstallerUrl = this.options.source.manualInstallerUrl(
        cached.manifest,
        this.support.target
      )
    } else {
      if (!isV2Source(this.options.source)) return
      this.activeReleaseBaseUrl = this.options.source.v2ReleaseBaseUrl(
        cached.manifest.version,
        this.support.target
      )
      this.manualInstallerUrl = this.options.source.v2ManualInstallerUrl(
        cached.manifest,
        this.support.target
      )
    }
    this.options.executor.useRelease(this.activeReleaseBaseUrl)
    this.publish(reduceUpdateState(
      reduceUpdateState(this.statusValue, {
        type: 'check',
        track: 'stable',
        manual: false
      }),
      {
        type: 'available',
        version: cached.manifest.version,
        required: true,
        manual: false
      }
    ))
  }

  private fail(
    error: unknown,
    previous: UpdateStatus,
    verifiedContext?: ReturnType<typeof versionContext>
  ): void {
    const message = error instanceof Error ? error.message : String(error)
    const context = verifiedContext ?? versionContext(previous)
    const manual = this.statusValue.phase === 'checking'
      ? this.statusValue.manual
      : context.manual
    this.publish(reduceUpdateState(this.statusValue, {
      type: 'error',
      version: context.version,
      required: context.required,
      message,
      retryable: true,
      manual,
      manualInstallerAvailable: this.manualInstallerUrl !== undefined
    }))
  }

  private run(operation: () => Promise<void>): Promise<void> {
    if (this.operation) return this.operation
    const current = operation().finally(() => {
      if (this.operation === current) this.operation = undefined
    })
    this.operation = current
    return current
  }

  private publish(status: UpdateStatus): void {
    this.statusValue = status
    for (const listener of this.listeners) listener(status)
  }

  private bindRelease(release: AnyResolvedRelease): void {
    this.activeManifest = release.manifest
    this.activeReleaseBaseUrl = release.releaseBaseUrl
    this.manualInstallerUrl = release.manualInstallerUrl
    this.executorVersion = undefined
    this.options.executor.useRelease(release.releaseBaseUrl)
  }

  private clearActiveRelease(): void {
    this.activeManifest = undefined
    this.activeReleaseBaseUrl = undefined
    this.manualInstallerUrl = undefined
    this.executorVersion = undefined
  }

  private skippedVersionPath(): string {
    return join(this.options.userData, 'updates', 'skipped-version.json')
  }

  private requiredPolicyPath(): string {
    return join(this.options.userData, 'updates', 'required-policy.json')
  }

  private preferences(): UpdatePreferenceService {
    return this.options.preferences ?? createUpdatePreferenceService(
      updatePreferencesPath(this.options.userData)
    )
  }
}

async function verifyFile(path: string, artifact: ReleaseArtifact): Promise<void> {
  const file = await stat(path)
  if (file.size !== artifact.size) {
    throw new Error('下载的更新文件与可信发布记录不一致。')
  }
  const digest = createHash('sha512')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  if (digest.digest('base64') !== artifact.sha512) {
    throw new Error('下载的更新文件与可信发布记录不一致。')
  }
}

function downloadedArtifact(
  manifest: SignedReleaseManifest | SignedTargetManifest,
  platform: string,
  arch: string
): ReleaseArtifact {
  const kind = platform === 'darwin' ? 'zip' : 'nsis'
  const artifact = manifest.artifacts.find((candidate) =>
    candidate.platform === platform &&
    candidate.arch === arch &&
    candidate.kind === kind
  )
  if (!artifact) throw new Error('可信发布记录缺少平台安装产物。')
  return artifact
}

function isRequiredStatus(status: UpdateStatus): boolean {
  return (
    status.phase === 'available' ||
    status.phase === 'downloading' ||
    status.phase === 'downloaded' ||
    status.phase === 'installing' ||
    status.phase === 'error'
  ) && status.required
}

function versionContext(status: UpdateStatus): {
  version?: string
  required: boolean
  manual: boolean
} {
  if (
    status.phase === 'available' ||
    status.phase === 'downloading' ||
    status.phase === 'downloaded' ||
    status.phase === 'installing'
  ) {
    return {
      version: status.availableVersion,
      required: status.required,
      manual: status.manual
    }
  }
  if (status.phase === 'error') {
    return {
      version: status.availableVersion,
      required: status.required,
      manual: status.manual
    }
  }
  if (status.phase === 'checking') {
    return { required: false, manual: status.manual }
  }
  return { required: false, manual: false }
}

function isV2Release(release: AnyResolvedRelease): release is ResolvedV2Release {
  return 'rollout' in release
}

function releaseVersion(release: AnyResolvedRelease): string {
  return release.manifest.version
}

function releasePolicy(release: AnyResolvedRelease): {
  mode: 'optional' | 'required'
  minimumSupportedVersion: string
} {
  return isV2Release(release) ? release.rollout.policy : release.manifest.policy
}

function isV1Source(source: AnyUpdateSource): source is UpdateSource {
  return 'releaseBaseUrl' in source
}

function isV2Source(source: AnyUpdateSource): source is V2UpdateSource {
  return 'v2ReleaseBaseUrl' in source
}

function deferred(): DownloadCompletion {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}
