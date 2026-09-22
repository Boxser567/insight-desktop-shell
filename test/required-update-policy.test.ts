import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readRequiredUpdatePolicy,
  requiredUpdatePolicyPath,
  writeRequiredUpdatePolicy,
  writeRequiredUpdatePolicyV2
} from '../src/main/update/required-update-policy'
import type {
  RolloutPayload,
  SignedReleaseIndex,
  SignedReleaseManifest,
  SignedTargetManifest,
  UpdateTarget
} from '../src/shared/update-contracts'

const temporaryDirectories: string[] = []
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const target: UpdateTarget = {
  channel: 'stable',
  platform: 'darwin',
  arch: 'arm64'
}
const sha512 = Buffer.alloc(64, 5).toString('base64')

function manifest(mode: 'optional' | 'required' = 'required'): SignedReleaseManifest {
  return {
    schema: 'insight-desktop-update/v1',
    version: '1.2.0',
    channel: 'stable',
    publishedAt: '2026-09-04T03:00:00.000Z',
    shellCommit: 'a'.repeat(40),
    coreRuntime: {
      tag: 'insight-runtime-v0.1.1-rc.10',
      commit: 'b'.repeat(40)
    },
    policy: { mode, minimumSupportedVersion: '1.1.0' },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      minimumReadableDataSchema: 1,
      maximumReadableDataSchema: 1
    },
    artifacts: [
      { platform: 'darwin', arch: 'arm64', kind: 'dmg', name: 'app.dmg', size: 1, sha512 },
      { platform: 'darwin', arch: 'arm64', kind: 'zip', name: 'app.zip', size: 1, sha512 },
      { platform: 'darwin', arch: 'arm64', kind: 'blockmap', name: 'app.zip.blockmap', size: 1, sha512 },
      { platform: 'darwin', arch: 'arm64', kind: 'updater-metadata', name: 'latest-mac.yml', size: 1, sha512 }
    ]
  }
}

function signed(value: SignedReleaseManifest = manifest()) {
  const manifestBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  return {
    manifestBytes,
    signatureBytes: sign(null, manifestBytes, privateKey)
  }
}

function v2Policy(mode: 'optional' | 'required' = 'required') {
  const targetManifest: SignedTargetManifest = {
    schema: 'insight-desktop-target/v2',
    version: '1.2.0',
    target: { platform: 'darwin', arch: 'arm64' },
    shellCommit: 'a'.repeat(40),
    coreRuntime: { tag: 'runtime-v2', commit: 'b'.repeat(40) },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      readsDataSchema: { minimum: 1, maximum: 1 },
      writesDataSchema: 1
    },
    artifacts: [
      { platform: 'darwin', arch: 'arm64', kind: 'dmg', name: 'app.dmg', size: 1, sha512 },
      { platform: 'darwin', arch: 'arm64', kind: 'zip', name: 'app.zip', size: 1, sha512 },
      { platform: 'darwin', arch: 'arm64', kind: 'blockmap', name: 'app.zip.blockmap', size: 1, sha512 },
      { platform: 'darwin', arch: 'arm64', kind: 'updater-metadata', name: 'latest-mac.yml', size: 1, sha512 }
    ]
  }
  const targetAuthenticated = signedV2Json(targetManifest)
  const index: SignedReleaseIndex = {
    schema: 'insight-desktop-release/v2',
    version: '1.2.0',
    shellCommit: targetManifest.shellCommit,
    coreRuntime: targetManifest.coreRuntime,
    targets: [
      { id: 'darwin-arm64', manifestSha512: digest(targetAuthenticated.bytes) },
      { id: 'darwin-x64', manifestSha512: Buffer.alloc(64, 6).toString('base64') },
      { id: 'win32-x64', manifestSha512: Buffer.alloc(64, 7).toString('base64') }
    ]
  }
  const indexAuthenticated = signedV2Json(index)
  const payload: RolloutPayload = {
    schema: 'insight-desktop-rollout/v2',
    state: 'active',
    track: 'stable',
    version: '1.2.0',
    referencedSha512: digest(indexAuthenticated.bytes),
    policy: { mode, minimumSupportedVersion: '1.1.0' },
    publishedAt: '2026-09-22T08:00:00.000Z'
  }
  const payloadBytes = Buffer.from(JSON.stringify(payload))
  const rolloutEnvelopeBytes = Buffer.from(JSON.stringify({
    schema: 'insight-desktop-rollout-envelope/v2',
    payloadBase64: payloadBytes.toString('base64'),
    signatureBase64: sign(null, payloadBytes, privateKey).toString('base64')
  }))
  return {
    rolloutEnvelopeBytes,
    releaseIndexBytes: indexAuthenticated.bytes,
    releaseIndexSignatureBytes: indexAuthenticated.signature,
    targetManifestBytes: targetAuthenticated.bytes,
    targetManifestSignatureBytes: targetAuthenticated.signature
  }
}

function signedV2Json(value: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  return { bytes, signature: sign(null, bytes, privateKey) }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64')
}

async function writeRawPolicy(
  path: string,
  authenticated: ReturnType<typeof signed>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({
    schema: 1,
    manifestBase64: authenticated.manifestBytes.toString('base64'),
    signatureBase64: authenticated.signatureBytes.toString('base64')
  })}\n`, 'utf8')
}

async function temporaryPolicyPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'insight-required-update-'))
  temporaryDirectories.push(directory)
  return requiredUpdatePolicyPath(directory)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('required update policy cache', () => {
  it('stores the exact authenticated bytes and re-verifies them on read', async () => {
    const path = await temporaryPolicyPath()
    const authenticated = signed()
    await writeRequiredUpdatePolicy({
      path,
      ...authenticated,
      publicKeyPem,
      target
    })

    const stored = JSON.parse(await readFile(path, 'utf8')) as {
      manifestBase64: string
      signatureBase64: string
    }
    expect(Buffer.from(stored.manifestBase64, 'base64')).toEqual(authenticated.manifestBytes)
    expect(Buffer.from(stored.signatureBase64, 'base64')).toEqual(authenticated.signatureBytes)
    await expect(readRequiredUpdatePolicy({
      path,
      publicKeyPem,
      target,
      currentVersion: '1.0.0'
    })).resolves.toMatchObject({ manifest: { version: '1.2.0' } })
  })

  it('rejects an invalid signature before writing a cache file', async () => {
    const path = await temporaryPolicyPath()
    const authenticated = signed()
    authenticated.signatureBytes[0] = authenticated.signatureBytes[0]! ^ 1

    await expect(writeRequiredUpdatePolicy({
      path,
      ...authenticated,
      publicKeyPem,
      target
    })).rejects.toThrow('签名无效')
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not cache an optional update as a required policy', async () => {
    const path = await temporaryPolicyPath()
    const authenticated = signed(manifest('optional'))

    await expect(writeRequiredUpdatePolicy({
      path,
      ...authenticated,
      publicKeyPem,
      target
    })).rejects.toThrow('强制')
  })

  it('fails open when a forged cache contains a valid optional policy', async () => {
    const path = await temporaryPolicyPath()
    const warn = vi.fn()
    await writeRawPolicy(path, signed(manifest('optional')))

    await expect(readRequiredUpdatePolicy({
      path,
      publicKeyPem,
      target,
      currentVersion: '1.0.0',
      warn
    })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails open and deletes a valid-format forged cache', async () => {
    const path = await temporaryPolicyPath()
    const authenticated = signed()
    const warn = vi.fn()
    await writeRequiredUpdatePolicy({ path, ...authenticated, publicKeyPem, target })
    const stored = JSON.parse(await readFile(path, 'utf8')) as Record<string, string | number>
    stored.signatureBase64 = Buffer.alloc(64).toString('base64')
    await writeFile(path, `${JSON.stringify(stored)}\n`, 'utf8')

    await expect(readRequiredUpdatePolicy({
      path,
      publicKeyPem,
      target,
      currentVersion: '1.0.0',
      warn
    })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['invalid base64', { schema: 1, manifestBase64: '*', signatureBase64: '*' }],
    ['unknown field', { schema: 1, manifestBase64: 'YQ==', signatureBase64: 'Yg==', extra: true }]
  ])('fails open for %s cache data', async (_label, value) => {
    const path = await temporaryPolicyPath()
    const warn = vi.fn()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8')

    await expect(readRequiredUpdatePolicy({
      path,
      publicKeyPem,
      target,
      currentVersion: '1.0.0',
      warn
    })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('removes a satisfied policy without touching sibling update data', async () => {
    const path = await temporaryPolicyPath()
    const sibling = join(dirname(path), 'keep.txt')
    const authenticated = signed()
    await writeRequiredUpdatePolicy({ path, ...authenticated, publicKeyPem, target })
    await writeFile(sibling, 'keep', 'utf8')

    await expect(readRequiredUpdatePolicy({
      path,
      publicKeyPem,
      target,
      currentVersion: '1.1.0'
    })).resolves.toBeUndefined()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(sibling, 'utf8')).resolves.toBe('keep')
  })

  it.each([
    ['channel', { ...target, channel: 'candidate' }],
    ['architecture', { ...target, arch: 'x64' }]
  ] as const)('fails open when a cached policy targets another %s', async (_label, otherTarget) => {
    const path = await temporaryPolicyPath()
    const authenticated = signed()
    await writeRequiredUpdatePolicy({ path, ...authenticated, publicKeyPem, target })

    await expect(readRequiredUpdatePolicy({
      path,
      publicKeyPem,
      target: otherTarget,
      currentVersion: '1.0.0',
      warn: vi.fn()
    })).resolves.toBeUndefined()
  })

  it('stores and restores the complete authenticated v2 Stable trust chain', async () => {
    const path = await temporaryPolicyPath()
    const authenticated = v2Policy()
    await writeRequiredUpdatePolicyV2({
      path,
      ...authenticated,
      publicKeyPem,
      target
    })

    const stored = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(stored.schema).toBe(2)
    expect(Object.keys(stored).sort()).toEqual([
      'releaseIndexBase64',
      'releaseIndexSignatureBase64',
      'rolloutEnvelopeBase64',
      'schema',
      'targetManifestBase64',
      'targetManifestSignatureBase64'
    ])
    await expect(readRequiredUpdatePolicy({
      path,
      publicKeyPem,
      target,
      currentVersion: '1.0.0'
    })).resolves.toMatchObject({
      schema: 2,
      rollout: { track: 'stable', version: '1.2.0', policy: { mode: 'required' } },
      releaseIndex: { version: '1.2.0' },
      manifest: { version: '1.2.0', target: { platform: 'darwin', arch: 'arm64' } }
    })
  })

  it('rejects optional v2 rollouts and discards a forged cached trust chain', async () => {
    const path = await temporaryPolicyPath()
    await expect(writeRequiredUpdatePolicyV2({
      path,
      ...v2Policy('optional'),
      publicKeyPem,
      target
    })).rejects.toThrow('强制')

    const authenticated = v2Policy()
    await writeRequiredUpdatePolicyV2({ path, ...authenticated, publicKeyPem, target })
    const stored = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    stored.targetManifestSignatureBase64 = Buffer.alloc(64).toString('base64')
    await writeFile(path, `${JSON.stringify(stored)}\n`, 'utf8')
    const warn = vi.fn()

    await expect(readRequiredUpdatePolicy({
      path,
      publicKeyPem,
      target,
      currentVersion: '1.0.0',
      warn
    })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
