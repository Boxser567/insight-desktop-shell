import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertReleaseIndexMatchesTargets,
  verifyReleaseIndex,
  verifyRolloutEnvelope,
  verifyTargetManifest
} from '../src/main/update/v2-release-contract'
import type {
  ReleaseArtifact,
  RolloutPayload,
  SignedReleaseIndex,
  SignedTargetManifest,
  UpdateTargetId
} from '../src/shared/update-contracts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const artifactSha512 = Buffer.alloc(64, 7).toString('base64')

const targets = {
  'darwin-arm64': { platform: 'darwin', arch: 'arm64' },
  'darwin-x64': { platform: 'darwin', arch: 'x64' },
  'win32-x64': { platform: 'win32', arch: 'x64' }
} as const

function targetManifest(id: UpdateTargetId): SignedTargetManifest {
  const target = targets[id]
  const prefix = `insight-1.0.0-${id}`
  const artifacts: ReleaseArtifact[] = target.platform === 'darwin'
    ? [
        artifact(target.platform, target.arch, 'dmg', `${prefix}.dmg`),
        artifact(target.platform, target.arch, 'zip', `${prefix}.zip`),
        artifact(target.platform, target.arch, 'blockmap', `${prefix}.zip.blockmap`),
        artifact(target.platform, target.arch, 'updater-metadata', 'latest-mac.yml')
      ]
    : [
        artifact(target.platform, target.arch, 'nsis', `${prefix}-setup.exe`),
        artifact(target.platform, target.arch, 'blockmap', `${prefix}-setup.exe.blockmap`),
        artifact(target.platform, target.arch, 'updater-metadata', 'latest.yml')
      ]
  return {
    schema: 'insight-desktop-target/v2',
    version: '1.0.0',
    target,
    shellCommit: 'a'.repeat(40),
    coreRuntime: { tag: 'insight-runtime-v0.1.6-alpha.2-insight.2', commit: 'b'.repeat(40) },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      readsDataSchema: { minimum: 1, maximum: 1 },
      writesDataSchema: 1
    },
    artifacts
  }
}

function artifact(
  platform: ReleaseArtifact['platform'],
  arch: ReleaseArtifact['arch'],
  kind: ReleaseArtifact['kind'],
  name: string
): ReleaseArtifact {
  return { platform, arch, kind, name, size: 128, sha512: artifactSha512 }
}

function signedJson(value: unknown): { bytes: Buffer; signatureBytes: Buffer } {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  return { bytes, signatureBytes: sign(null, bytes, privateKey) }
}

function authenticatedManifest(id: UpdateTargetId, value = targetManifest(id)) {
  const authenticated = signedJson(value)
  return {
    manifest: value,
    manifestBytes: authenticated.bytes,
    signatureBytes: authenticated.signatureBytes
  }
}

function releaseIndex(
  manifests = allAuthenticatedManifests()
): SignedReleaseIndex {
  return {
    schema: 'insight-desktop-release/v2',
    version: '1.0.0',
    shellCommit: 'a'.repeat(40),
    coreRuntime: { tag: 'insight-runtime-v0.1.6-alpha.2-insight.2', commit: 'b'.repeat(40) },
    targets: manifests.map(({ manifest, manifestBytes }) => ({
      id: `${manifest.target.platform}-${manifest.target.arch}` as UpdateTargetId,
      manifestSha512: sha512(manifestBytes)
    }))
  }
}

function allAuthenticatedManifests() {
  return [
    authenticatedManifest('darwin-arm64'),
    authenticatedManifest('darwin-x64'),
    authenticatedManifest('win32-x64')
  ]
}

function rolloutPayload(overrides: Partial<RolloutPayload> = {}): RolloutPayload {
  return {
    schema: 'insight-desktop-rollout/v2',
    track: 'candidate',
    version: '1.0.0',
    target: 'darwin-arm64',
    referencedSha512: Buffer.alloc(64, 8).toString('base64'),
    policy: { mode: 'optional', minimumSupportedVersion: '1.0.0-rc.18' },
    publishedAt: '2026-09-22T08:00:00.000Z',
    ...overrides
  }
}

function signedRollout(
  payload: RolloutPayload,
  payloadBytes = Buffer.from(JSON.stringify(payload))
): Buffer {
  const envelope = {
    schema: 'insight-desktop-rollout-envelope/v2',
    payloadBase64: payloadBytes.toString('base64'),
    signatureBase64: sign(null, payloadBytes, privateKey).toString('base64')
  }
  return Buffer.from(JSON.stringify(envelope))
}

function sha512(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64')
}

describe('desktop update v2 trust contracts', () => {
  it('verifies canonical Candidate and Stable rollout envelopes', () => {
    const candidate = verifyRolloutEnvelope(signedRollout(rolloutPayload()), publicKeyPem)
    expect(candidate.payload.track).toBe('candidate')
    expect(candidate.payload.target).toBe('darwin-arm64')

    const stablePayload = rolloutPayload({ track: 'stable', target: undefined })
    expect(verifyRolloutEnvelope(signedRollout(stablePayload), publicKeyPem).payload)
      .toEqual(stablePayload)
  })

  it('rejects a required Candidate rollout', () => {
    const payload = rolloutPayload({
      policy: { mode: 'required', minimumSupportedVersion: '1.0.0-rc.18' }
    })
    expect(() => verifyRolloutEnvelope(signedRollout(payload), publicKeyPem))
      .toThrow('Candidate rollout must be optional')
  })

  it('rejects malformed rollout identity and non-canonical encodings', () => {
    const prerelease = rolloutPayload({ version: '1.0.1-rc.1' })
    expect(() => verifyRolloutEnvelope(signedRollout(prerelease), publicKeyPem))
      .toThrow('最终语义版本')

    const prettyPayload = Buffer.from(`${JSON.stringify(rolloutPayload(), null, 2)}\n`)
    expect(() => verifyRolloutEnvelope(
      signedRollout(rolloutPayload(), prettyPayload),
      publicKeyPem
    )).toThrow('不是规范 JSON')

    const valid = JSON.parse(signedRollout(rolloutPayload()).toString('utf8')) as {
      schema: string
      payloadBase64: string
      signatureBase64: string
      unexpected?: boolean
    }
    valid.unexpected = true
    expect(() => verifyRolloutEnvelope(Buffer.from(JSON.stringify(valid)), publicKeyPem))
      .toThrow()

    valid.unexpected = undefined
    valid.signatureBase64 = '*'
    expect(() => verifyRolloutEnvelope(Buffer.from(JSON.stringify(valid)), publicKeyPem))
      .toThrow('Base64')
  })

  it('verifies target signatures, expected hashes and target identity', () => {
    const authenticated = authenticatedManifest('darwin-arm64')
    expect(verifyTargetManifest({
      manifestBytes: authenticated.manifestBytes,
      signatureBytes: authenticated.signatureBytes,
      publicKeyPem,
      expectedSha512: sha512(authenticated.manifestBytes),
      expectedTarget: 'darwin-arm64',
      expectedVersion: '1.0.0'
    })).toEqual(authenticated.manifest)

    expect(() => verifyTargetManifest({
      manifestBytes: authenticated.manifestBytes,
      signatureBytes: authenticated.signatureBytes,
      publicKeyPem,
      expectedSha512: Buffer.alloc(64).toString('base64')
    })).toThrow('摘要不匹配')
    expect(() => verifyTargetManifest({
      manifestBytes: authenticated.manifestBytes,
      signatureBytes: Buffer.alloc(64),
      publicKeyPem
    })).toThrow('签名无效')
    expect(() => verifyTargetManifest({
      manifestBytes: authenticated.manifestBytes,
      signatureBytes: authenticated.signatureBytes,
      publicKeyPem,
      expectedTarget: 'darwin-x64'
    })).toThrow('请求目标不一致')
  })

  it.each([
    ['pre-release version', { ...targetManifest('darwin-arm64'), version: '1.0.0-rc.18' }],
    ['unknown field', { ...targetManifest('darwin-arm64'), unexpected: true }],
    ['inverted data range', {
      ...targetManifest('darwin-arm64'),
      compatibility: {
        ...targetManifest('darwin-arm64').compatibility,
        readsDataSchema: { minimum: 2, maximum: 1 }
      }
    }],
    ['other target artifact', {
      ...targetManifest('darwin-arm64'),
      artifacts: targetManifest('darwin-arm64').artifacts.map((entry, index) =>
        index === 0 ? { ...entry, arch: 'x64' as const } : entry)
    }],
    ['missing artifact', {
      ...targetManifest('darwin-arm64'),
      artifacts: targetManifest('darwin-arm64').artifacts.filter(({ kind }) => kind !== 'zip')
    }],
    ['duplicate artifact', {
      ...targetManifest('darwin-arm64'),
      artifacts: [
        ...targetManifest('darwin-arm64').artifacts,
        targetManifest('darwin-arm64').artifacts[0]
      ]
    }]
  ])('rejects a Target Manifest with %s', (_label, manifest) => {
    const authenticated = signedJson(manifest)
    expect(() => verifyTargetManifest({
      manifestBytes: authenticated.bytes,
      signatureBytes: authenticated.signatureBytes,
      publicKeyPem
    })).toThrow()
  })

  it('requires all three targets in a Stable Release Index', () => {
    const manifests = allAuthenticatedManifests()
    const complete = releaseIndex(manifests)
    const authenticated = signedJson(complete)
    expect(verifyReleaseIndex({
      indexBytes: authenticated.bytes,
      signatureBytes: authenticated.signatureBytes,
      publicKeyPem,
      expectedSha512: sha512(authenticated.bytes),
      expectedVersion: '1.0.0'
    })).toEqual(complete)

    const incomplete = { ...complete, targets: complete.targets.slice(0, 2) }
    const signedIncomplete = signedJson(incomplete)
    expect(() => verifyReleaseIndex({
      indexBytes: signedIncomplete.bytes,
      signatureBytes: signedIncomplete.signatureBytes,
      publicKeyPem
    })).toThrow('完整目标集合')
  })

  it('binds a Release Index to matching target bytes and release identity', () => {
    const manifests = allAuthenticatedManifests()
    const index = releaseIndex(manifests)
    expect(() => assertReleaseIndexMatchesTargets(index, manifests)).not.toThrow()

    const wrongCommit = authenticatedManifest('darwin-x64', {
      ...targetManifest('darwin-x64'),
      shellCommit: 'c'.repeat(40)
    })
    const mismatchedIdentity = [manifests[0]!, wrongCommit, manifests[2]!]
    expect(() => assertReleaseIndexMatchesTargets(index, mismatchedIdentity))
      .toThrow(/摘要不匹配|发布身份不一致/)

    const wrongCompatibility = authenticatedManifest('darwin-x64', {
      ...targetManifest('darwin-x64'),
      compatibility: {
        ...targetManifest('darwin-x64').compatibility,
        writesDataSchema: 2
      }
    })
    const compatibilityIndex = releaseIndex([manifests[0]!, wrongCompatibility, manifests[2]!])
    expect(() => assertReleaseIndexMatchesTargets(
      compatibilityIndex,
      [manifests[0]!, wrongCompatibility, manifests[2]!]
    )).toThrow('兼容声明不一致')
  })
})
