import { createHash } from 'node:crypto'
import semver from 'semver'
import { z } from 'zod'

export const UPDATE_V2_TARGET_IDS = Object.freeze([
  'darwin-arm64',
  'darwin-x64',
  'win32-x64'
])

export const UPDATE_V2_SCHEMAS = Object.freeze({
  target: 'insight-desktop-target/v2',
  release: 'insight-desktop-release/v2',
  rollout: 'insight-desktop-rollout/v2',
  envelope: 'insight-desktop-rollout-envelope/v2'
})

const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const commitSchema = z.string().regex(/^[0-9a-f]{40}$/u)
const sha512Schema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/u)
const artifactNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u)
const targetIdSchema = z.enum(UPDATE_V2_TARGET_IDS)

const artifactSchema = z.object({
  platform: z.enum(['darwin', 'win32']),
  arch: z.enum(['arm64', 'x64']),
  kind: z.enum(['dmg', 'zip', 'nsis', 'blockmap', 'updater-metadata']),
  name: artifactNameSchema,
  size: safeIntegerSchema,
  sha512: sha512Schema
}).strict()

const runtimeSchema = z.object({
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

export const v2TargetManifestSchema = z.object({
  schema: z.literal(UPDATE_V2_SCHEMAS.target),
  version: z.string().min(1),
  target: z.object({
    platform: z.enum(['darwin', 'win32']),
    arch: z.enum(['arm64', 'x64'])
  }).strict(),
  shellCommit: commitSchema,
  coreRuntime: runtimeSchema,
  compatibility: compatibilitySchema,
  artifacts: z.array(artifactSchema)
}).strict()

export const v2ReleaseIndexSchema = z.object({
  schema: z.literal(UPDATE_V2_SCHEMAS.release),
  version: z.string().min(1),
  shellCommit: commitSchema,
  coreRuntime: runtimeSchema,
  targets: z.array(z.object({
    id: targetIdSchema,
    manifestSha512: sha512Schema
  }).strict())
}).strict()

export const v2RolloutPayloadSchema = z.object({
  schema: z.literal(UPDATE_V2_SCHEMAS.rollout),
  state: z.enum(['active', 'rejected']),
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

export const v2RolloutEnvelopeSchema = z.object({
  schema: z.literal(UPDATE_V2_SCHEMAS.envelope),
  payloadBase64: z.string().min(1),
  signatureBase64: z.string().min(1)
}).strict()

export function parseV2TargetManifest(value) {
  const manifest = v2TargetManifestSchema.parse(value)
  assertFinalVersion(manifest.version)
  const targetId = updateTargetId(manifest.target.platform, manifest.target.arch)
  if (manifest.compatibility.readsDataSchema.minimum > manifest.compatibility.readsDataSchema.maximum) {
    throw new Error('Target Manifest readable data schema range is invalid.')
  }
  const requiredKinds = targetId.startsWith('darwin-')
    ? ['dmg', 'zip', 'blockmap', 'updater-metadata']
    : ['nsis', 'blockmap', 'updater-metadata']
  const identities = new Set()
  const names = new Set()
  for (const artifact of manifest.artifacts) {
    if (artifact.platform !== manifest.target.platform || artifact.arch !== manifest.target.arch) {
      throw new Error('Target Manifest contains an artifact for another target.')
    }
    const identity = `${artifact.platform}\0${artifact.arch}\0${artifact.kind}`
    if (identities.has(identity) || names.has(artifact.name)) {
      throw new Error(`Target Manifest contains a duplicate artifact: ${artifact.name}`)
    }
    identities.add(identity)
    names.add(artifact.name)
  }
  const missing = requiredKinds.filter((kind) =>
    !manifest.artifacts.some((artifact) => artifact.kind === kind))
  if (missing.length > 0) {
    throw new Error(`Target Manifest is missing artifacts: ${missing.join(', ')}`)
  }
  return manifest
}

export function parseV2ReleaseIndex(value) {
  const index = v2ReleaseIndexSchema.parse(value)
  assertFinalVersion(index.version)
  const ids = index.targets.map(({ id }) => id)
  if (
    ids.length !== UPDATE_V2_TARGET_IDS.length ||
    ids.some((id, position) => id !== UPDATE_V2_TARGET_IDS[position])
  ) {
    throw new Error('Release Index must contain the complete ordered target set.')
  }
  return index
}

export function parseV2RolloutPayload(value) {
  const payload = v2RolloutPayloadSchema.parse(value)
  assertFinalVersion(payload.version)
  assertSemver(payload.policy.minimumSupportedVersion, 'minimum supported version')
  if (semver.gt(payload.policy.minimumSupportedVersion, payload.version)) {
    throw new Error('Minimum supported version cannot exceed rollout version.')
  }
  if (payload.track === 'candidate') {
    if (payload.target === undefined) throw new Error('Candidate rollout must name a target.')
    if (payload.policy.mode !== 'optional') throw new Error('Candidate rollout must be optional.')
  } else {
    if (payload.target !== undefined) throw new Error('Stable rollout cannot name one target.')
    if (payload.state !== 'active') throw new Error('Stable rollout cannot be rejected.')
  }
  return payload
}

export function parseCanonicalV2Envelope(bytes) {
  const envelope = parseCanonicalJson(bytes, v2RolloutEnvelopeSchema, 'rollout envelope')
  const payloadBytes = decodeCanonicalBase64(envelope.payloadBase64, 'rollout payload')
  const signatureBytes = decodeCanonicalBase64(envelope.signatureBase64, 'rollout signature')
  const payload = parseCanonicalJson(payloadBytes, v2RolloutPayloadSchema, 'rollout payload')
  parseV2RolloutPayload(payload)
  return { envelope, payload, payloadBytes, signatureBytes }
}

export function assertReleaseIndexMatchesTargets(index, authenticatedTargets) {
  if (authenticatedTargets.length !== UPDATE_V2_TARGET_IDS.length) {
    throw new Error('Release Index verification requires the complete target set.')
  }
  const compatibility = JSON.stringify(authenticatedTargets[0]?.manifest.compatibility)
  const seen = new Set()
  for (const { manifest, manifestBytes } of authenticatedTargets) {
    const id = updateTargetId(manifest.target.platform, manifest.target.arch)
    if (seen.has(id)) throw new Error(`Release Index contains duplicate target: ${id}`)
    seen.add(id)
    const reference = index.targets.find((target) => target.id === id)
    if (!reference || reference.manifestSha512 !== sha512(manifestBytes)) {
      throw new Error(`Release Index target digest does not match: ${id}`)
    }
    if (
      manifest.version !== index.version ||
      manifest.shellCommit !== index.shellCommit ||
      manifest.coreRuntime.tag !== index.coreRuntime.tag ||
      manifest.coreRuntime.commit !== index.coreRuntime.commit
    ) {
      throw new Error(`Release Index target identity does not match: ${id}`)
    }
    if (JSON.stringify(manifest.compatibility) !== compatibility) {
      throw new Error('Release Index target compatibility declarations do not match.')
    }
  }
  if (UPDATE_V2_TARGET_IDS.some((id) => !seen.has(id))) {
    throw new Error('Release Index verification requires the complete target set.')
  }
}

export function updateTargetId(platform, arch) {
  const id = `${platform}-${arch}`
  if (!UPDATE_V2_TARGET_IDS.includes(id)) throw new Error(`Unsupported update target: ${id}`)
  return id
}

export function canonicalJsonBytes(value) {
  return Buffer.from(JSON.stringify(value))
}

export function decodeCanonicalBase64(value, label = 'value') {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error(`${label} is not valid Base64.`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    throw new Error(`${label} is not canonical Base64.`)
  }
  return bytes
}

export function sha512(bytes) {
  return createHash('sha512').update(bytes).digest('base64')
}

export function assertCandidateRecoveryCompatible(input) {
  if (
    !Number.isSafeInteger(input?.candidateWrites) || input.candidateWrites < 0 ||
    !Number.isSafeInteger(input?.recoveryReads?.minimum) || input.recoveryReads.minimum < 0 ||
    !Number.isSafeInteger(input?.recoveryReads?.maximum) || input.recoveryReads.maximum < 0 ||
    input.recoveryReads.minimum > input.recoveryReads.maximum ||
    input.candidateWrites < input.recoveryReads.minimum ||
    input.candidateWrites > input.recoveryReads.maximum
  ) {
    throw new Error('Candidate data cannot be recovered by the current Stable baseline.')
  }
}

function assertFinalVersion(version) {
  assertSemver(version, 'update version')
  const parsed = semver.parse(version)
  if (!parsed || parsed.prerelease.length > 0 || parsed.build.length > 0) {
    throw new Error('v2 update version must be a final semantic version.')
  }
}

function assertSemver(version, label) {
  if (semver.valid(version) !== version) throw new Error(`${label} must be valid semver.`)
}

function parseCanonicalJson(bytes, schema, label) {
  const value = schema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
  if (!canonicalJsonBytes(value).equals(Buffer.from(bytes))) {
    throw new Error(`${label} is not canonical JSON.`)
  }
  return value
}
