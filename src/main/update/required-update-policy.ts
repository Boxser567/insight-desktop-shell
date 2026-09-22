import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import semver from 'semver'
import { z } from 'zod'
import { verifyReleaseManifest } from './release-manifest'
import {
  updateTargetId,
  verifyReleaseIndex,
  verifyRolloutEnvelope,
  verifyTargetManifest
} from './v2-release-contract'
import type {
  RolloutPayload,
  SignedReleaseIndex,
  SignedReleaseManifest,
  SignedTargetManifest,
  UpdateTarget
} from '../../shared/update-contracts'

const cachedPolicyV1Schema = z.object({
  schema: z.literal(1),
  manifestBase64: z.string().min(1),
  signatureBase64: z.string().min(1)
}).strict()

const cachedPolicyV2Schema = z.object({
  schema: z.literal(2),
  rolloutEnvelopeBase64: z.string().min(1),
  releaseIndexBase64: z.string().min(1),
  releaseIndexSignatureBase64: z.string().min(1),
  targetManifestBase64: z.string().min(1),
  targetManifestSignatureBase64: z.string().min(1)
}).strict()

const cachedPolicySchema = z.discriminatedUnion('schema', [
  cachedPolicyV1Schema,
  cachedPolicyV2Schema
])

interface RequiredPolicyInput {
  path: string
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
  publicKeyPem: string
  target: UpdateTarget
}

export interface RequiredPolicyV2Input {
  path: string
  rolloutEnvelopeBytes: Uint8Array
  releaseIndexBytes: Uint8Array
  releaseIndexSignatureBytes: Uint8Array
  targetManifestBytes: Uint8Array
  targetManifestSignatureBytes: Uint8Array
  publicKeyPem: string
  target: UpdateTarget
}

export interface ReadRequiredPolicyInput {
  path: string
  publicKeyPem: string
  target: UpdateTarget
  currentVersion: string
  warn?: (message: string, error: unknown) => void
}

export interface AuthenticatedRequiredPolicyV1 {
  schema: 1
  manifest: SignedReleaseManifest
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
}

export interface AuthenticatedRequiredPolicyV2 {
  schema: 2
  rollout: RolloutPayload
  rolloutEnvelopeBytes: Uint8Array
  releaseIndex: SignedReleaseIndex
  releaseIndexBytes: Uint8Array
  releaseIndexSignatureBytes: Uint8Array
  manifest: SignedTargetManifest
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
}

export type AuthenticatedRequiredPolicy =
  | AuthenticatedRequiredPolicyV1
  | AuthenticatedRequiredPolicyV2

export function requiredUpdatePolicyPath(userData: string): string {
  return join(userData, 'updates', 'required-policy.json')
}

export async function writeRequiredUpdatePolicy(input: RequiredPolicyInput): Promise<void> {
  const manifest = verifyReleaseManifest(input)
  if (manifest.policy.mode !== 'required') {
    throw new Error('只有强制更新才能写入强制策略缓存。')
  }
  await atomicWrite(input.path, `${JSON.stringify({
    schema: 1,
    manifestBase64: Buffer.from(input.manifestBytes).toString('base64'),
    signatureBase64: Buffer.from(input.signatureBytes).toString('base64')
  })}\n`)
}

export async function writeRequiredUpdatePolicyV2(
  input: RequiredPolicyV2Input
): Promise<void> {
  const authenticated = verifyV2RequiredPolicy(input)
  if (authenticated.rollout.policy.mode !== 'required') {
    throw new Error('只有 Stable 强制更新才能写入强制策略缓存。')
  }
  await atomicWrite(input.path, `${JSON.stringify({
    schema: 2,
    rolloutEnvelopeBase64: Buffer.from(input.rolloutEnvelopeBytes).toString('base64'),
    releaseIndexBase64: Buffer.from(input.releaseIndexBytes).toString('base64'),
    releaseIndexSignatureBase64: Buffer.from(input.releaseIndexSignatureBytes).toString('base64'),
    targetManifestBase64: Buffer.from(input.targetManifestBytes).toString('base64'),
    targetManifestSignatureBase64: Buffer.from(input.targetManifestSignatureBytes).toString('base64')
  })}\n`)
}

export async function readRequiredUpdatePolicy(
  input: ReadRequiredPolicyInput
): Promise<AuthenticatedRequiredPolicy | undefined> {
  const warn = input.warn ?? defaultWarning
  let raw: string
  try {
    raw = await readFile(input.path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return undefined
    await discardInvalidPolicy(input.path, warn, error)
    return undefined
  }

  try {
    const cached = cachedPolicySchema.parse(JSON.parse(raw))
    if (semver.valid(input.currentVersion) !== input.currentVersion) {
      throw new Error('当前客户端版本不是合法语义版本。')
    }

    const authenticated = cached.schema === 1
      ? readV1Policy(cached, input)
      : readV2Policy(cached, input)
    const minimumSupportedVersion = authenticated.schema === 1
      ? authenticated.manifest.policy.minimumSupportedVersion
      : authenticated.rollout.policy.minimumSupportedVersion
    if (semver.gte(input.currentVersion, minimumSupportedVersion)) {
      await rm(input.path, { force: true })
      return undefined
    }
    return authenticated
  } catch (error) {
    await discardInvalidPolicy(input.path, warn, error)
    return undefined
  }
}

function readV1Policy(
  cached: z.infer<typeof cachedPolicyV1Schema>,
  input: ReadRequiredPolicyInput
): AuthenticatedRequiredPolicyV1 {
  const manifestBytes = decodeCanonicalBase64(cached.manifestBase64)
  const signatureBytes = decodeCanonicalBase64(cached.signatureBase64)
  const manifest = verifyReleaseManifest({
    manifestBytes,
    signatureBytes,
    publicKeyPem: input.publicKeyPem,
    target: input.target
  })
  if (manifest.policy.mode !== 'required') {
    throw new Error('缓存的更新策略不是强制更新。')
  }
  return { schema: 1, manifest, manifestBytes, signatureBytes }
}

function readV2Policy(
  cached: z.infer<typeof cachedPolicyV2Schema>,
  input: ReadRequiredPolicyInput
): AuthenticatedRequiredPolicyV2 {
  return verifyV2RequiredPolicy({
    path: input.path,
    rolloutEnvelopeBytes: decodeCanonicalBase64(cached.rolloutEnvelopeBase64),
    releaseIndexBytes: decodeCanonicalBase64(cached.releaseIndexBase64),
    releaseIndexSignatureBytes: decodeCanonicalBase64(cached.releaseIndexSignatureBase64),
    targetManifestBytes: decodeCanonicalBase64(cached.targetManifestBase64),
    targetManifestSignatureBytes: decodeCanonicalBase64(cached.targetManifestSignatureBase64),
    publicKeyPem: input.publicKeyPem,
    target: input.target
  })
}

function verifyV2RequiredPolicy(
  input: RequiredPolicyV2Input
): AuthenticatedRequiredPolicyV2 {
  if (input.target.channel !== 'stable') {
    throw new Error('v2 强制更新缓存只接受 Stable 目标。')
  }
  const verifiedRollout = verifyRolloutEnvelope(
    input.rolloutEnvelopeBytes,
    input.publicKeyPem
  )
  if (
    verifiedRollout.payload.track !== 'stable' ||
    verifiedRollout.payload.policy.mode !== 'required'
  ) {
    throw new Error('缓存的 v2 更新策略不是 Stable 强制更新。')
  }
  const releaseIndex = verifyReleaseIndex({
    indexBytes: input.releaseIndexBytes,
    signatureBytes: input.releaseIndexSignatureBytes,
    publicKeyPem: input.publicKeyPem,
    expectedSha512: verifiedRollout.payload.referencedSha512,
    expectedVersion: verifiedRollout.payload.version
  })
  const targetId = updateTargetId(input.target.platform, input.target.arch)
  const reference = releaseIndex.targets.find(({ id }) => id === targetId)
  if (!reference) throw new Error('缓存的 Release Index 缺少当前目标。')
  const manifest = verifyTargetManifest({
    manifestBytes: input.targetManifestBytes,
    signatureBytes: input.targetManifestSignatureBytes,
    publicKeyPem: input.publicKeyPem,
    expectedSha512: reference.manifestSha512,
    expectedTarget: targetId,
    expectedVersion: releaseIndex.version
  })
  if (
    manifest.shellCommit !== releaseIndex.shellCommit ||
    manifest.coreRuntime.tag !== releaseIndex.coreRuntime.tag ||
    manifest.coreRuntime.commit !== releaseIndex.coreRuntime.commit
  ) {
    throw new Error('缓存的 Release Index 与目标 Manifest 身份不一致。')
  }
  return {
    schema: 2,
    rollout: verifiedRollout.payload,
    rolloutEnvelopeBytes: input.rolloutEnvelopeBytes,
    releaseIndex,
    releaseIndexBytes: input.releaseIndexBytes,
    releaseIndexSignatureBytes: input.releaseIndexSignatureBytes,
    manifest,
    manifestBytes: input.targetManifestBytes,
    signatureBytes: input.targetManifestSignatureBytes
  }
}

async function discardInvalidPolicy(
  path: string,
  warn: (message: string, error: unknown) => void,
  error: unknown
): Promise<void> {
  warn('已忽略无效的强制更新策略缓存。', error)
  await rm(path, { force: true }).catch((removalError: unknown) => {
    warn('无法删除无效的强制更新策略缓存。', removalError)
  })
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('缓存字段不是合法 Base64。')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    throw new Error('缓存字段不是规范 Base64。')
  }
  return bytes
}

async function atomicWrite(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temporaryPath, value, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function defaultWarning(message: string, error: unknown): void {
  console.warn(`[desktop] ${message}`, error)
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
