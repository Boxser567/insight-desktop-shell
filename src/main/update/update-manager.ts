import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'
import {
  readRequiredUpdatePolicy,
  writeRequiredUpdatePolicy
} from './required-update-policy'
import {
  readSkippedVersion,
  writeSkippedVersion
} from './skipped-version'
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
import type { ResolvedRelease, UpdateSource } from './update-source'
import type {
  ReleaseArtifact,
  SignedReleaseManifest,
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
  source: UpdateSource
  executor: UpdateExecutor
  publicKeyPem: string
  userData: string
  prepareToInstall(): Promise<void>
  now?: () => number
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
  private activeManifest?: SignedReleaseManifest
  private executorVersion?: string
  private downloadCompletion?: DownloadCompletion
  private lastCheckedAt?: number
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
        reason: this.support.reason,
        manual: false
      })
      return
    }

    this.options.executor.configure({
      channel: this.support.target.channel,
      autoInstallOnQuit: AUTO_INSTALL_ON_APP_QUIT
    })
    this.removeExecutorListener = this.options.executor.on((event) => this.onExecutorEvent(event))
    await this.restoreRequiredPolicy()
    this.startupTimer = this.timers.setTimeout(
      () => void this.check(false),
      startupCheckDelay(this.random)
    )
    this.intervalTimer = this.timers.setInterval(
      () => void this.check(false),
      UPDATE_CHECK_INTERVAL_MS
    )
    this.removeResumeListener = this.options.resume?.subscribe(() => {
      if (isUpdateCheckDue(this.lastCheckedAt, this.now())) void this.check(false)
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

  check(manual: boolean): Promise<void> {
    if (!this.started) return Promise.reject(new Error('更新管理器尚未启动。'))
    if (!this.support.supported) {
      if (manual) {
        this.publish({
          phase: 'unsupported',
          currentVersion: this.options.currentVersion,
          reason: this.support.reason,
          manual: true
        })
      }
      return Promise.resolve()
    }
    return this.run(() => this.performCheck(manual))
  }

  download(): Promise<void> {
    return this.run(() => this.performDownload())
  }

  skip(version: string): Promise<void> {
    return this.run(async () => {
      const status = this.statusValue
      if (status.phase !== 'available' || status.availableVersion !== version) {
        throw new Error('只能跳过当前可用版本。')
      }
      if (status.required) return
      await writeSkippedVersion(this.skippedVersionPath(), version)
      this.activeManifest = undefined
      this.executorVersion = undefined
      this.publish(initialUpdateStatus(this.options.currentVersion))
    })
  }

  install(): Promise<void> {
    return this.run(async () => {
      const status = this.statusValue
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
    })
  }

  private async performCheck(manual: boolean): Promise<void> {
    if (!this.support.supported) return
    const previous = this.statusValue
    this.publish(reduceUpdateState(previous, { type: 'check', manual }))
    try {
      const release = await this.options.source.resolve(
        this.support.target.channel,
        this.support.target
      )
      this.lastCheckedAt = this.now()
      const cachedRequired = isRequiredStatus(previous)
      if (!semver.gt(release.manifest.version, this.options.currentVersion)) {
        if (cachedRequired) {
          throw new Error('可信发布记录不能解除尚未满足的强制更新。')
        }
        this.activeManifest = undefined
        this.executorVersion = undefined
        this.publish(reduceUpdateState(this.statusValue, { type: 'up-to-date' }))
        return
      }

      const manifestRequiresUpdate = release.manifest.policy.mode === 'required' && semver.lt(
        this.options.currentVersion,
        release.manifest.policy.minimumSupportedVersion
      )
      const required = cachedRequired || manifestRequiresUpdate
      if (shouldSuppressSkippedUpdate({
        availableVersion: release.manifest.version,
        skippedVersion: await readSkippedVersion(this.skippedVersionPath()),
        manual,
        required
      })) {
        this.publish(initialUpdateStatus(
          this.options.currentVersion,
          new Date(this.lastCheckedAt).toISOString()
        ))
        return
      }

      const executorUpdate = await this.options.executor.check()
      if (executorUpdate?.version !== release.manifest.version) {
        throw new Error('平台更新器版本与可信发布记录不一致。')
      }
      this.executorVersion = executorUpdate.version
      this.activeManifest = release.manifest
      if (manifestRequiresUpdate) {
        await writeRequiredUpdatePolicy({
          path: this.requiredPolicyPath(),
          manifestBytes: release.manifestBytes,
          signatureBytes: release.signatureBytes,
          publicKeyPem: this.options.publicKeyPem,
          target: this.support.target
        })
      } else if (!cachedRequired) {
        await rm(this.requiredPolicyPath(), { force: true })
      }
      this.publish(reduceUpdateState(this.statusValue, {
        type: 'available',
        version: release.manifest.version,
        required,
        manual
      }))
    } catch (error) {
      this.lastCheckedAt = this.now()
      this.fail(error, previous)
    }
  }

  private async performDownload(): Promise<void> {
    const status = this.statusValue
    if (status.phase !== 'available' || !this.activeManifest) {
      throw new Error('没有可下载的可信更新。')
    }
    try {
      if (this.executorVersion !== status.availableVersion) {
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
    } catch (error) {
      this.fail(error, status)
    } finally {
      this.downloadCompletion = undefined
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
      this.downloadCompletion?.reject(new Error(event.message))
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
      target: this.support.target,
      currentVersion: this.options.currentVersion
    })
    if (!cached) return
    this.activeManifest = cached.manifest
    this.publish(reduceUpdateState(
      reduceUpdateState(this.statusValue, { type: 'check', manual: false }),
      {
        type: 'available',
        version: cached.manifest.version,
        required: true,
        manual: false
      }
    ))
  }

  private fail(error: unknown, previous: UpdateStatus): void {
    const message = error instanceof Error ? error.message : String(error)
    const context = versionContext(previous)
    const manual = this.statusValue.phase === 'checking'
      ? this.statusValue.manual
      : context.manual
    this.publish(reduceUpdateState(this.statusValue, {
      type: 'error',
      version: context.version,
      required: context.required,
      message,
      retryable: true,
      manual
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

  private skippedVersionPath(): string {
    return join(this.options.userData, 'updates', 'skipped-version.json')
  }

  private requiredPolicyPath(): string {
    return join(this.options.userData, 'updates', 'required-policy.json')
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
  manifest: SignedReleaseManifest,
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

function deferred(): DownloadCompletion {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}
