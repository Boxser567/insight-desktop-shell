import { createHash, createPublicKey, verify } from 'node:crypto'
import semver from 'semver'
import { z } from 'zod'
import type {
  ReleaseArtifactKind,
  RolloutPayload,
  SignedReleaseIndex,
  SignedRolloutEnvelope,
  SignedTargetManifest,
  UpdateTargetId
} from '../../shared/update-contracts'

export const UPDATE_V2_TARGET_IDS = [
  'darwin-arm64',
  'darwin-x64',
  'win32-x64'
] as const satisfies readonly UpdateTargetId[]

const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const commitSchema = z.string().regex(/^[0-9a-f]{40}$/)
const sha512Schema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/)
const artifactNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/)
const targetIdSchema = z.enum(UPDATE_V2_TARGET_IDS)

const artifactSchema = z.object({
  platform: z.enum(['darwin', 'win32']),
  arch: z.enum(['arm64', 'x64']),
  kind: z.enum(['dmg', 'zip', 'nsis', 'blockmap', 'updater-metadata']),
  name: artifactNameSchema,
  size: safeIntegerSchema,
  sha512: sha512Schema
}).strict()

const coreRuntimeSchema = z.object({
  tag: z.string().min(1),
  commit: commitSchema
}).strict()

const compatibilitySchema = z.object({
  profileSchema: safeIntegerSchema,
  accountStorageSchema: safeIntegerSchema,
  readsDataSchema: z.object({
    minimum: safeIntegerSchema,
    maximum: safeIntegerSchema
  }).strict(),
  writesDataSchema: safeIntegerSchema
}).strict()

const targetManifestSchema = z.object({
  schema: z.literal('insight-desktop-target/v2'),
  version: z.string().min(1),
  target: z.object({
    platform: z.enum(['darwin', 'win32']),
    arch: z.enum(['arm64', 'x64'])
  }).strict(),
  shellCommit: commitSchema,
  coreRuntime: coreRuntimeSchema,
  compatibility: compatibilitySchema,
  artifacts: z.array(artifactSchema)
}).strict()

const releaseIndexSchema = z.object({
  schema: z.literal('insight-desktop-release/v2'),
  version: z.string().min(1),
  shellCommit: commitSchema,
  coreRuntime: coreRuntimeSchema,
  targets: z.array(z.object({
    id: targetIdSchema,
    manifestSha512: sha512Schema
  }).strict())
}).strict()

const rolloutPayloadSchema = z.object({
  schema: z.literal('insight-desktop-rollout/v2'),
  track: z.enum(['stable', 'candidate']),
  version: z.string().min(1),
  target: targetIdSchema.optional(),
  referencedSha512: sha512Schema,
  policy: z.object({
    mode: z.enum(['optional', 'required']),
    minimumSupportedVersion: z.string().min(1)
  }).strict(),
  publishedAt: z.iso.datetime({ offset: true })
}).strict()

const rolloutEnvelopeSchema = z.object({
  schema: z.literal('insight-desktop-rollout-envelope/v2'),
  payloadBase64: z.string().min(1),
  signatureBase64: z.string().min(1)
}).strict()

export interface VerifiedRollout {
  envelope: SignedRolloutEnvelope
  payload: RolloutPayload
  payloadBytes: Uint8Array
  signatureBytes: Uint8Array
}

export interface VerifyTargetManifestInput {
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
  publicKeyPem: string
  expectedSha512?: string
  expectedTarget?: UpdateTargetId
  expectedVersion?: string
}

export interface VerifyReleaseIndexInput {
  indexBytes: Uint8Array
  signatureBytes: Uint8Array
  publicKeyPem: string
  expectedSha512?: string
  expectedVersion?: string
}

export interface AuthenticatedTargetManifest {
  manifest: SignedTargetManifest
  manifestBytes: Uint8Array
}

export function verifyRolloutEnvelope(
  bytes: Uint8Array,
  publicKeyPem: string
): VerifiedRollout {
  const envelope = parseCanonicalJson(bytes, rolloutEnvelopeSchema, '更新投放信封')
  const payloadBytes = decodeCanonicalBase64(envelope.payloadBase64, '更新投放 Payload')
  const signatureBytes = decodeCanonicalBase64(envelope.signatureBase64, '更新投放签名')
  verifySignature(payloadBytes, signatureBytes, publicKeyPem, '更新投放')

  const payload = parseCanonicalJson(
    payloadBytes,
    rolloutPayloadSchema,
    '更新投放 Payload'
  )
  validateRolloutPayload(payload)
  return { envelope, payload, payloadBytes, signatureBytes }
}

export function verifyTargetManifest(
  input: VerifyTargetManifestInput
): SignedTargetManifest {
  verifyExpectedSha512(input.manifestBytes, input.expectedSha512, '目标 Manifest')
  verifySignature(
    input.manifestBytes,
    input.signatureBytes,
    input.publicKeyPem,
    '目标 Manifest'
  )
  const manifest = targetManifestSchema.parse(
    JSON.parse(Buffer.from(input.manifestBytes).toString('utf8'))
  )
  validateTargetManifest(manifest)

  const targetId = updateTargetId(manifest.target.platform, manifest.target.arch)
  if (input.expectedTarget !== undefined && targetId !== input.expectedTarget) {
    throw new Error('目标 Manifest 与请求目标不一致。')
  }
  if (input.expectedVersion !== undefined && manifest.version !== input.expectedVersion) {
    throw new Error('目标 Manifest 与投放版本不一致。')
  }
  return manifest
}

export function verifyReleaseIndex(input: VerifyReleaseIndexInput): SignedReleaseIndex {
  verifyExpectedSha512(input.indexBytes, input.expectedSha512, 'Release Index')
  verifySignature(
    input.indexBytes,
    input.signatureBytes,
    input.publicKeyPem,
    'Release Index'
  )
  const index = releaseIndexSchema.parse(
    JSON.parse(Buffer.from(input.indexBytes).toString('utf8'))
  )
  assertFinalVersion(index.version)
  if (input.expectedVersion !== undefined && index.version !== input.expectedVersion) {
    throw new Error('Release Index 与投放版本不一致。')
  }

  const ids = index.targets.map(({ id }) => id)
  if (
    ids.length !== UPDATE_V2_TARGET_IDS.length ||
    ids.some((id, position) => id !== UPDATE_V2_TARGET_IDS[position])
  ) {
    throw new Error('Release Index 必须包含按固定顺序排列的完整目标集合。')
  }
  return index
}

export function assertReleaseIndexMatchesTargets(
  index: SignedReleaseIndex,
  targets: readonly AuthenticatedTargetManifest[]
): void {
  if (targets.length !== UPDATE_V2_TARGET_IDS.length) {
    throw new Error('Release Index 校验需要完整目标集合。')
  }

  const compatibility = JSON.stringify(targets[0]?.manifest.compatibility)
  const seen = new Set<UpdateTargetId>()
  for (const authenticated of targets) {
    const { manifest, manifestBytes } = authenticated
    const id = updateTargetId(manifest.target.platform, manifest.target.arch)
    if (seen.has(id)) throw new Error(`Release Index 包含重复目标：${id}。`)
    seen.add(id)

    const reference = index.targets.find((target) => target.id === id)
    if (!reference || reference.manifestSha512 !== sha512(manifestBytes)) {
      throw new Error(`Release Index 的目标摘要不匹配：${id}。`)
    }
    if (
      manifest.version !== index.version ||
      manifest.shellCommit !== index.shellCommit ||
      manifest.coreRuntime.tag !== index.coreRuntime.tag ||
      manifest.coreRuntime.commit !== index.coreRuntime.commit
    ) {
      throw new Error(`Release Index 的目标发布身份不一致：${id}。`)
    }
    if (JSON.stringify(manifest.compatibility) !== compatibility) {
      throw new Error('Release Index 的目标数据兼容声明不一致。')
    }
  }

  if (UPDATE_V2_TARGET_IDS.some((id) => !seen.has(id))) {
    throw new Error('Release Index 校验需要完整目标集合。')
  }
}

export function updateTargetId(
  platform: SignedTargetManifest['target']['platform'],
  arch: SignedTargetManifest['target']['arch']
): UpdateTargetId {
  const id = `${platform}-${arch}`
  if ((UPDATE_V2_TARGET_IDS as readonly string[]).includes(id)) {
    return id as UpdateTargetId
  }
  throw new Error(`不支持更新目标：${id}。`)
}

function validateRolloutPayload(payload: RolloutPayload): void {
  assertFinalVersion(payload.version)
  assertSemver(payload.policy.minimumSupportedVersion, '最低支持版本')
  if (semver.gt(payload.policy.minimumSupportedVersion, payload.version)) {
    throw new Error('最低支持版本不能高于投放版本。')
  }
  if (payload.track === 'candidate') {
    if (payload.target === undefined) throw new Error('Candidate 投放缺少目标。')
    if (payload.policy.mode !== 'optional') {
      throw new Error('Candidate rollout must be optional.')
    }
  } else if (payload.target !== undefined) {
    throw new Error('Stable 投放不能指定单一目标。')
  }
}

function validateTargetManifest(manifest: SignedTargetManifest): void {
  assertFinalVersion(manifest.version)
  const targetId = updateTargetId(manifest.target.platform, manifest.target.arch)
  if (manifest.compatibility.readsDataSchema.minimum > manifest.compatibility.readsDataSchema.maximum) {
    throw new Error('可读取数据 Schema 范围无效。')
  }

  const requiredKinds = requiredArtifactKinds(targetId)
  const identities = new Set<string>()
  const names = new Set<string>()
  for (const artifact of manifest.artifacts) {
    if (
      artifact.platform !== manifest.target.platform ||
      artifact.arch !== manifest.target.arch
    ) {
      throw new Error('目标 Manifest 包含其他目标的产物。')
    }
    const identity = `${artifact.platform}\0${artifact.arch}\0${artifact.kind}`
    if (identities.has(identity) || names.has(artifact.name)) {
      throw new Error(`目标 Manifest 包含重复产物：${artifact.name}。`)
    }
    identities.add(identity)
    names.add(artifact.name)
  }

  const missing = requiredKinds.filter(
    (kind) => !manifest.artifacts.some((artifact) => artifact.kind === kind)
  )
  if (missing.length > 0) {
    throw new Error(`目标 Manifest 缺少目标产物：${missing.join(', ')}。`)
  }
}

function requiredArtifactKinds(target: UpdateTargetId): readonly ReleaseArtifactKind[] {
  return target.startsWith('darwin-')
    ? ['dmg', 'zip', 'blockmap', 'updater-metadata']
    : ['nsis', 'blockmap', 'updater-metadata']
}

function assertFinalVersion(version: string): void {
  assertSemver(version, '更新版本')
  const parsed = semver.parse(version)
  if (!parsed || parsed.prerelease.length > 0 || parsed.build.length > 0) {
    throw new Error('v2 更新版本必须是最终语义版本。')
  }
}

function assertSemver(version: string, label: string): void {
  if (semver.valid(version) !== version) {
    throw new Error(`${label}不是合法语义版本。`)
  }
}

function parseCanonicalJson<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
  label: string
): T {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'))
  const value = schema.parse(parsed)
  if (!Buffer.from(JSON.stringify(value)).equals(Buffer.from(bytes))) {
    throw new Error(`${label}不是规范 JSON。`)
  }
  return value
}

function decodeCanonicalBase64(value: string, label: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label}不是合法 Base64。`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    throw new Error(`${label}不是规范 Base64。`)
  }
  return bytes
}

function verifySignature(
  bytes: Uint8Array,
  signatureBytes: Uint8Array,
  publicKeyPem: string,
  label: string
): void {
  const publicKey = createPublicKey(publicKeyPem)
  if (!verify(null, bytes, publicKey, signatureBytes)) {
    throw new Error(`${label}签名无效。`)
  }
}

function verifyExpectedSha512(
  bytes: Uint8Array,
  expected: string | undefined,
  label: string
): void {
  if (expected !== undefined && sha512(bytes) !== expected) {
    throw new Error(`${label}摘要不匹配。`)
  }
}

function sha512(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64')
}
