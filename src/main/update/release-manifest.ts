import { createPublicKey, verify } from 'node:crypto'
import semver from 'semver'
import { z } from 'zod'
import type {
  ReleaseArtifact,
  ReleaseArtifactKind,
  SignedReleaseManifest,
  UpdatePlatform,
  UpdateTarget
} from '../../shared/update-contracts'

const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const commitSchema = z.string().regex(/^[0-9a-f]{40}$/)
const sha512Schema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/)

const releaseArtifactSchema = z.object({
  platform: z.enum(['darwin', 'win32']),
  arch: z.enum(['arm64', 'x64']),
  kind: z.enum(['dmg', 'zip', 'nsis', 'blockmap', 'updater-metadata']),
  name: z.string().min(1),
  size: safeIntegerSchema,
  sha512: sha512Schema
}).strict()

const releaseManifestSchema = z.object({
  schema: z.literal('insight-desktop-update/v1'),
  version: z.string().min(1),
  channel: z.enum(['candidate', 'stable']),
  publishedAt: z.iso.datetime({ offset: true }),
  shellCommit: commitSchema,
  coreRuntime: z.object({
    tag: z.string().min(1),
    commit: commitSchema
  }).strict(),
  policy: z.object({
    mode: z.enum(['optional', 'required']),
    minimumSupportedVersion: z.string().min(1)
  }).strict(),
  compatibility: z.object({
    profileSchema: safeIntegerSchema,
    accountStorageSchema: safeIntegerSchema,
    minimumReadableDataSchema: safeIntegerSchema,
    maximumReadableDataSchema: safeIntegerSchema
  }).strict(),
  artifacts: z.array(releaseArtifactSchema)
}).strict()

export interface VerifyReleaseManifestInput {
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
  publicKeyPem: string
  target: UpdateTarget
}

export function verifyReleaseManifest(
  input: VerifyReleaseManifestInput
): SignedReleaseManifest {
  const publicKey = createPublicKey(input.publicKeyPem)
  if (!verify(null, input.manifestBytes, publicKey, input.signatureBytes)) {
    throw new Error('更新 Manifest 签名无效。')
  }

  const value: unknown = JSON.parse(Buffer.from(input.manifestBytes).toString('utf8'))
  const manifest = releaseManifestSchema.parse(value)
  validateManifest(manifest)

  if (manifest.channel !== input.target.channel) {
    throw new Error('更新渠道与当前客户端不一致。')
  }

  selectTargetArtifacts(manifest, input.target)
  return manifest
}

export function selectTargetArtifacts(
  manifest: SignedReleaseManifest,
  target: UpdateTarget
): ReleaseArtifact[] {
  const requiredKinds = requiredArtifactKinds(target.platform, target.arch)
  const artifacts = manifest.artifacts.filter(
    ({ platform, arch }) => platform === target.platform && arch === target.arch
  )
  const missingKinds = requiredKinds.filter(
    (kind) => !artifacts.some((artifact) => artifact.kind === kind)
  )

  if (missingKinds.length > 0) {
    throw new Error(`更新 Manifest 缺少目标产物：${missingKinds.join(', ')}。`)
  }

  return artifacts
}

function validateManifest(manifest: SignedReleaseManifest): void {
  if (semver.valid(manifest.version) !== manifest.version) {
    throw new Error('更新版本不是合法语义版本。')
  }
  if (
    semver.valid(manifest.policy.minimumSupportedVersion) !==
    manifest.policy.minimumSupportedVersion
  ) {
    throw new Error('最低支持版本不是合法语义版本。')
  }
  if (semver.gt(manifest.policy.minimumSupportedVersion, manifest.version)) {
    throw new Error('最低支持版本不能高于更新版本。')
  }
  if (
    manifest.compatibility.minimumReadableDataSchema >
    manifest.compatibility.maximumReadableDataSchema
  ) {
    throw new Error('可读取数据 Schema 范围无效。')
  }

  const identities = new Set<string>()
  const assetsByName = new Map<string, ReleaseArtifact>()
  for (const artifact of manifest.artifacts) {
    requiredArtifactKinds(artifact.platform, artifact.arch)
    const identity = [
      artifact.platform,
      artifact.arch,
      artifact.kind,
      artifact.name
    ].join('\0')
    if (identities.has(identity)) {
      throw new Error(`更新 Manifest 包含重复产物：${artifact.name}。`)
    }
    identities.add(identity)

    const existing = assetsByName.get(artifact.name)
    if (
      existing &&
      (
        existing.kind !== artifact.kind ||
        existing.size !== artifact.size ||
        existing.sha512 !== artifact.sha512
      )
    ) {
      throw new Error(`更新 Manifest 的共享资产信息不一致：${artifact.name}。`)
    }
    assetsByName.set(artifact.name, artifact)
  }
}

function requiredArtifactKinds(
  platform: UpdatePlatform,
  arch: UpdateTarget['arch']
): readonly ReleaseArtifactKind[] {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return ['dmg', 'zip', 'blockmap', 'updater-metadata']
  }
  if (platform === 'win32' && arch === 'x64') {
    return ['nsis', 'blockmap', 'updater-metadata']
  }
  throw new Error(`不支持更新目标：${platform}-${arch}。`)
}
