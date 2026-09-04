import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  selectTargetArtifacts,
  verifyReleaseManifest
} from '../src/main/update/release-manifest'
import type {
  SignedReleaseManifest,
  UpdateTarget
} from '../src/shared/update-contracts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const sha512 = Buffer.alloc(64, 7).toString('base64')

const stableTarget: UpdateTarget = {
  channel: 'stable',
  platform: 'darwin',
  arch: 'arm64'
}

const baseManifest: SignedReleaseManifest = {
  schema: 'insight-desktop-update/v1',
  version: '0.1.2',
  channel: 'stable',
  publishedAt: '2026-09-04T03:00:00.000Z',
  shellCommit: 'a'.repeat(40),
  coreRuntime: {
    tag: 'insight-runtime-v0.1.1-rc.10',
    commit: 'b'.repeat(40)
  },
  policy: {
    mode: 'optional',
    minimumSupportedVersion: '0.1.1'
  },
  compatibility: {
    profileSchema: 1,
    accountStorageSchema: 1,
    minimumReadableDataSchema: 1,
    maximumReadableDataSchema: 1
  },
  artifacts: [
    artifact('darwin', 'arm64', 'dmg', 'insight-mac-arm64.dmg'),
    artifact('darwin', 'arm64', 'zip', 'insight-mac-arm64.zip'),
    artifact('darwin', 'arm64', 'blockmap', 'insight-mac-arm64.zip.blockmap'),
    artifact('darwin', 'arm64', 'updater-metadata', 'latest-mac.yml'),
    artifact('win32', 'x64', 'nsis', 'insight-windows-x64-setup.exe'),
    artifact('win32', 'x64', 'blockmap', 'insight-windows-x64-setup.exe.blockmap'),
    artifact('win32', 'x64', 'updater-metadata', 'latest.yml')
  ]
}

function artifact(
  platform: 'darwin' | 'win32',
  arch: 'arm64' | 'x64',
  kind: 'dmg' | 'zip' | 'nsis' | 'blockmap' | 'updater-metadata',
  name: string
) {
  return { platform, arch, kind, name, size: 128, sha512 }
}

function signed(value: unknown): { manifestBytes: Buffer; signatureBytes: Buffer } {
  const manifestBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  return {
    manifestBytes,
    signatureBytes: sign(null, manifestBytes, privateKey)
  }
}

function verify(value: unknown, target: UpdateTarget = stableTarget) {
  return verifyReleaseManifest({
    ...signed(value),
    publicKeyPem,
    target
  })
}

describe('authenticated release manifest', () => {
  it('verifies the original signed bytes and returns the parsed manifest', () => {
    const manifest = verify(baseManifest)

    expect(manifest).toEqual(baseManifest)
    expect(selectTargetArtifacts(manifest, stableTarget).map(({ kind }) => kind)).toEqual([
      'dmg',
      'zip',
      'blockmap',
      'updater-metadata'
    ])
  })

  it('rejects any byte change after signing', () => {
    const authenticated = signed(baseManifest)
    const changedBytes = Buffer.concat([authenticated.manifestBytes, Buffer.from(' ')])

    expect(() => verifyReleaseManifest({
      ...authenticated,
      manifestBytes: changedBytes,
      publicKeyPem,
      target: stableTarget
    })).toThrow('签名无效')
  })

  it('strictly rejects signed manifests with unknown fields', () => {
    expect(() => verify({ ...baseManifest, unexpected: true })).toThrow()
    expect(() => verify({
      ...baseManifest,
      policy: { ...baseManifest.policy, unexpected: true }
    })).toThrow()
  })

  it('rejects a manifest from another release channel', () => {
    expect(() => verify({ ...baseManifest, channel: 'candidate' })).toThrow('渠道')
  })

  it.each([
    ['darwin zip', 'zip'],
    ['darwin zip blockmap', 'blockmap'],
    ['darwin dmg', 'dmg'],
    ['darwin updater metadata', 'updater-metadata']
  ] as const)('requires %s for a macOS target', (_label, missingKind) => {
    expect(() => verify({
      ...baseManifest,
      artifacts: baseManifest.artifacts.filter((entry) =>
        entry.platform !== 'darwin' || entry.arch !== 'arm64' || entry.kind !== missingKind
      )
    })).toThrow('缺少')
  })

  it.each([
    ['Windows installer', 'nsis'],
    ['Windows blockmap', 'blockmap'],
    ['Windows updater metadata', 'updater-metadata']
  ] as const)('requires %s for a Windows target', (_label, missingKind) => {
    expect(() => verify({
      ...baseManifest,
      artifacts: baseManifest.artifacts.filter((entry) =>
        entry.platform !== 'win32' || entry.arch !== 'x64' || entry.kind !== missingKind
      )
    }, { channel: 'stable', platform: 'win32', arch: 'x64' })).toThrow('缺少')
  })

  it('rejects unsupported platform and architecture values', () => {
    const invalidArtifact = {
      ...baseManifest,
      artifacts: [{ ...baseManifest.artifacts[0], platform: 'linux' }]
    }
    const unsupportedArtifactPair = {
      ...baseManifest,
      artifacts: [
        ...baseManifest.artifacts,
        artifact('win32', 'arm64', 'nsis', 'insight-windows-arm64-setup.exe')
      ]
    }

    expect(() => verify(invalidArtifact)).toThrow()
    expect(() => verify(unsupportedArtifactPair)).toThrow('不支持')
    expect(() => verify(baseManifest, {
      channel: 'stable',
      platform: 'win32',
      arch: 'arm64'
    })).toThrow('不支持')
  })

  it.each([
    ['invalid version', { ...baseManifest, version: 'next' }],
    ['invalid date', { ...baseManifest, publishedAt: 'today' }],
    ['duplicate artifact', {
      ...baseManifest,
      artifacts: [...baseManifest.artifacts, baseManifest.artifacts[0]]
    }],
    ['negative size', {
      ...baseManifest,
      artifacts: [{ ...baseManifest.artifacts[0], size: -1 }, ...baseManifest.artifacts.slice(1)]
    }],
    ['unsafe size', {
      ...baseManifest,
      artifacts: [
        { ...baseManifest.artifacts[0], size: Number.MAX_SAFE_INTEGER + 1 },
        ...baseManifest.artifacts.slice(1)
      ]
    }],
    ['invalid sha512', {
      ...baseManifest,
      artifacts: [{ ...baseManifest.artifacts[0], sha512: 'invalid' }, ...baseManifest.artifacts.slice(1)]
    }],
    ['invalid minimum version', {
      ...baseManifest,
      policy: { ...baseManifest.policy, minimumSupportedVersion: 'old' }
    }],
    ['minimum version above release', {
      ...baseManifest,
      policy: { ...baseManifest.policy, minimumSupportedVersion: '0.1.3' }
    }],
    ['inverted readable schema range', {
      ...baseManifest,
      compatibility: {
        ...baseManifest.compatibility,
        minimumReadableDataSchema: 2,
        maximumReadableDataSchema: 1
      }
    }],
    ['negative compatibility schema', {
      ...baseManifest,
      compatibility: { ...baseManifest.compatibility, profileSchema: -1 }
    }]
  ])('rejects %s', (_label, value) => {
    expect(() => verify(value)).toThrow()
  })
})
