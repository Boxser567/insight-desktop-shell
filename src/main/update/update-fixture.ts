import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import semver from 'semver'
import type { ExecutorEvent, UpdateExecutor } from './update-executor'
import type { UpdateSource } from './update-source'
import type {
  ReleaseArtifact,
  SignedReleaseManifest,
  UpdateTarget
} from '../../shared/update-contracts'

export type UpdateFixtureName =
  | 'available'
  | 'required'
  | 'required-error'
  | 'up-to-date'
  | 'error'

const fixtureNames = new Set<UpdateFixtureName>([
  'available',
  'required',
  'required-error',
  'up-to-date',
  'error'
])

/** Accept update fixtures only in an unpackaged development process. */
export function resolveUpdateFixture(input: {
  packaged: boolean
  name: string | undefined
}): UpdateFixtureName | undefined {
  if (input.packaged || !input.name) return undefined
  return fixtureNames.has(input.name as UpdateFixtureName)
    ? input.name as UpdateFixtureName
    : undefined
}

export function createUpdateFixture(input: {
  name: UpdateFixtureName
  currentVersion: string
  userData: string
}): {
  source: UpdateSource
  executor: UpdateExecutor
  publicKeyPem: string
} {
  const version = input.name === 'up-to-date'
    ? input.currentVersion
    : semver.inc(input.currentVersion, 'patch')
  if (!version) throw new Error('Fixture current version must be valid semver.')
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const downloadedBytes = Buffer.from('insight desktop update fixture')
  let release: ReturnType<typeof fixtureRelease> | undefined
  const source: UpdateSource = {
    async resolve(_channel, target) {
      if (input.name === 'error') throw new Error('Fixture：模拟更新服务暂时不可用。')
      release ??= fixtureRelease({
        version,
        required: input.name === 'required' || input.name === 'required-error',
        target,
        downloadedBytes,
        privateKey
      })
      return release
    }
  }
  return {
    source,
    executor: new FixtureUpdateExecutor(
      version,
      join(input.userData, 'updates', 'fixture-update.bin'),
      downloadedBytes,
      input.name === 'required-error'
    ),
    publicKeyPem
  }
}

class FixtureUpdateExecutor implements UpdateExecutor {
  private readonly listeners = new Set<(event: ExecutorEvent) => void>()

  constructor(
    private readonly version: string,
    private readonly downloadedFile: string,
    private readonly downloadedBytes: Uint8Array,
    private readonly failDownload: boolean
  ) {}

  configure(): void {}

  async check(): Promise<{ version: string }> {
    return { version: this.version }
  }

  async download(): Promise<void> {
    if (this.failDownload) {
      this.emit({ type: 'error', message: 'Fixture：模拟强制更新下载失败。' })
      return
    }
    this.emit({ type: 'progress', percent: 20 })
    await delay(180)
    this.emit({ type: 'progress', percent: 70 })
    await mkdir(dirname(this.downloadedFile), { recursive: true })
    await writeFile(this.downloadedFile, this.downloadedBytes)
    await delay(180)
    this.emit({
      type: 'downloaded',
      version: this.version,
      downloadedFile: this.downloadedFile
    })
  }

  quitAndInstall(): void {}

  on(listener: (event: ExecutorEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: ExecutorEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function fixtureRelease(input: {
  version: string
  required: boolean
  target: UpdateTarget
  downloadedBytes: Uint8Array
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
}) {
  const artifacts = fixtureArtifacts(input.target, input.downloadedBytes)
  const manifest: SignedReleaseManifest = {
    schema: 'insight-desktop-update/v1',
    version: input.version,
    channel: input.target.channel,
    publishedAt: '2026-09-04T00:00:00.000Z',
    shellCommit: 'a'.repeat(40),
    coreRuntime: {
      tag: 'insight-runtime-fixture',
      commit: 'b'.repeat(40)
    },
    policy: {
      mode: input.required ? 'required' : 'optional',
      minimumSupportedVersion: input.required ? input.version : '0.0.0'
    },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      minimumReadableDataSchema: 1,
      maximumReadableDataSchema: 1
    },
    artifacts
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
  return {
    manifest,
    manifestBytes,
    signatureBytes: sign(null, manifestBytes, input.privateKey),
    artifactUrls: new Map(artifacts.map((artifact) => [
      artifact.name,
      new URL(`https://github.com/fixture/${artifact.name}`)
    ]))
  }
}

function fixtureArtifacts(
  target: UpdateTarget,
  downloadedBytes: Uint8Array
): ReleaseArtifact[] {
  const artifact = (
    kind: ReleaseArtifact['kind'],
    name: string,
    bytes: Uint8Array
  ): ReleaseArtifact => ({
    platform: target.platform,
    arch: target.arch,
    kind,
    name,
    size: bytes.byteLength,
    sha512: createHash('sha512').update(bytes).digest('base64')
  })
  const metadata = Buffer.from('fixture')
  return target.platform === 'darwin'
    ? [
        artifact('dmg', 'fixture.dmg', metadata),
        artifact('zip', 'fixture.zip', downloadedBytes),
        artifact('blockmap', 'fixture.zip.blockmap', metadata),
        artifact('updater-metadata', 'latest-mac.yml', metadata)
      ]
    : [
        artifact('nsis', 'fixture.exe', downloadedBytes),
        artifact('blockmap', 'fixture.exe.blockmap', metadata),
        artifact('updater-metadata', 'latest.yml', metadata)
      ]
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
