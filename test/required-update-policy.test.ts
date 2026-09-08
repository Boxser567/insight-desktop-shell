import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readRequiredUpdatePolicy,
  requiredUpdatePolicyPath,
  writeRequiredUpdatePolicy
} from '../src/main/update/required-update-policy'
import type {
  SignedReleaseManifest,
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
})
