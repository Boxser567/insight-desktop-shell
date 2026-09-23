import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import { parseUpdateDistribution } from '../src/main/update/update-environment'
import { V2ReleaseSource } from '../src/main/update/v2-release-source'
import type { RolloutHistoryService } from '../src/main/update/rollout-history'
import type {
  ReleaseArtifact,
  RolloutPayload,
  SignedReleaseIndex,
  SignedTargetManifest,
  UpdateTargetId,
  UpdateTrack
} from '../src/shared/update-contracts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const distribution = parseUpdateDistribution({
  schema: 1,
  updateOrigin: 'https://updates.example.test'
})
const targetValues = {
  'darwin-arm64': { platform: 'darwin', arch: 'arm64' },
  'darwin-x64': { platform: 'darwin', arch: 'x64' },
  'win32-x64': { platform: 'win32', arch: 'x64' }
} as const

function response(url: string, body: BodyInit, status = 200, finalUrl = url): Response {
  const value = new Response(body, { status })
  Object.defineProperty(value, 'url', { value: finalUrl })
  return value
}

function sha512(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64')
}

function signedJson(value: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  return { bytes, signature: sign(null, bytes, privateKey) }
}

function artifact(
  target: typeof targetValues[UpdateTargetId],
  kind: ReleaseArtifact['kind'],
  name: string,
  bytes: Uint8Array = Buffer.from(name)
): ReleaseArtifact {
  return {
    ...target,
    kind,
    name,
    size: bytes.byteLength,
    sha512: sha512(bytes)
  }
}

function manifest(id: UpdateTargetId, metadata: Uint8Array): SignedTargetManifest {
  const target = targetValues[id]
  const prefix = `insight-1.0.0-${id}`
  return {
    schema: 'insight-desktop-target/v2',
    version: '1.0.0',
    target,
    shellCommit: 'a'.repeat(40),
    coreRuntime: { tag: 'runtime-v1', commit: 'b'.repeat(40) },
    compatibility: {
      profileSchema: 1,
      accountStorageSchema: 1,
      readsDataSchema: { minimum: 1, maximum: 1 },
      writesDataSchema: 1
    },
    artifacts: target.platform === 'darwin'
      ? [
          artifact(target, 'dmg', `${prefix}.dmg`),
          artifact(target, 'zip', `${prefix}.zip`),
          artifact(target, 'blockmap', `${prefix}.zip.blockmap`),
          artifact(target, 'updater-metadata', 'latest-mac.yml', metadata)
        ]
      : [
          artifact(target, 'nsis', `${prefix}-setup.exe`),
          artifact(target, 'blockmap', `${prefix}-setup.exe.blockmap`),
          artifact(target, 'updater-metadata', 'latest.yml', metadata)
        ]
  }
}

function rolloutEnvelope(payload: RolloutPayload, corrupt = false): Buffer {
  const payloadBytes = Buffer.from(JSON.stringify(payload))
  const signature = corrupt ? Buffer.alloc(64) : sign(null, payloadBytes, privateKey)
  return Buffer.from(JSON.stringify({
    schema: 'insight-desktop-rollout-envelope/v2',
    payloadBase64: payloadBytes.toString('base64'),
    signatureBase64: signature.toString('base64')
  }))
}

function fixture(options: {
  track?: UpdateTrack
  target?: UpdateTargetId
  rolloutTarget?: UpdateTargetId
  requiredCandidate?: boolean
  corruptEnvelopeSignature?: boolean
  corruptManifestReference?: boolean
  incompleteIndex?: boolean
  manifestShellCommit?: string
  redirectPointerTo?: string
  metadataUpdateShaMismatch?: boolean
  rolloutState?: 'active' | 'rejected'
  rolloutHistory?: RolloutHistoryService
} = {}) {
  const track = options.track ?? 'candidate'
  const targetId = options.target ?? 'darwin-x64'
  const updateName = targetId.startsWith('darwin-')
    ? `insight-1.0.0-${targetId}.zip`
    : `insight-1.0.0-${targetId}-setup.exe`
  const updateBytes = Buffer.from(updateName)
  const updateSha512 = options.metadataUpdateShaMismatch
    ? Buffer.alloc(64).toString('base64')
    : sha512(updateBytes)
  const metadata = Buffer.from(stringify({
    version: '1.0.0',
    files: [{ url: updateName, sha512: updateSha512, size: updateBytes.length }],
    path: updateName,
    sha512: updateSha512,
    minimumSystemVersion: '22.0.0'
  }))
  const targetManifest = manifest(targetId, metadata)
  if (options.manifestShellCommit) targetManifest.shellCommit = options.manifestShellCommit
  const authenticatedManifest = signedJson(targetManifest)
  const allIds: UpdateTargetId[] = ['darwin-arm64', 'darwin-x64', 'win32-x64']
  const index: SignedReleaseIndex = {
    schema: 'insight-desktop-release/v2',
    version: '1.0.0',
    shellCommit: 'a'.repeat(40),
    coreRuntime: { tag: 'runtime-v1', commit: 'b'.repeat(40) },
    targets: allIds.map((id) => ({
      id,
      manifestSha512: id === targetId
        ? sha512(authenticatedManifest.bytes)
        : Buffer.alloc(64, id.length).toString('base64')
    }))
  }
  if (options.incompleteIndex) index.targets.pop()
  const authenticatedIndex = signedJson(index)
  const referencedSha512 = track === 'stable'
    ? sha512(authenticatedIndex.bytes)
    : options.corruptManifestReference
      ? Buffer.alloc(64).toString('base64')
      : sha512(authenticatedManifest.bytes)
  const payload: RolloutPayload = {
    schema: 'insight-desktop-rollout/v2',
    state: options.rolloutState ?? 'active',
    track,
    version: '1.0.0',
    ...(track === 'candidate' ? { target: options.rolloutTarget ?? targetId } : {}),
    referencedSha512,
    policy: {
      mode: options.requiredCandidate ? 'required' : 'optional',
      minimumSupportedVersion: '1.0.0-rc.20'
    },
    publishedAt: '2026-09-22T08:00:00.000Z'
  }
  const pointerUrl = distribution.v2PointerUrl(
    track,
    track === 'candidate' ? targetId : undefined
  ).href
  const targetBaseUrl = distribution.v2TargetBaseUrl('1.0.0', targetId)
  const releaseBaseUrl = distribution.v2ReleaseBaseUrl('1.0.0')
  const files = new Map<string, Uint8Array>([
    [pointerUrl, rolloutEnvelope(payload, options.corruptEnvelopeSignature)],
    [new URL('insight-release.json', releaseBaseUrl).href, authenticatedIndex.bytes],
    [new URL('insight-release.json.sig', releaseBaseUrl).href, authenticatedIndex.signature],
    [new URL('insight-target.json', targetBaseUrl).href, authenticatedManifest.bytes],
    [new URL('insight-target.json.sig', targetBaseUrl).href, authenticatedManifest.signature],
    [new URL(targetId.startsWith('darwin-') ? 'latest-mac.yml' : 'latest.yml', targetBaseUrl).href, metadata]
  ])
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString()
    const bytes = files.get(url)
    if (!bytes) return response(url, 'missing', 404)
    return response(
      url,
      Buffer.from(bytes),
      200,
      url === pointerUrl && options.redirectPointerTo ? options.redirectPointerTo : url
    )
  })
  return {
    fetchMock,
    source: new V2ReleaseSource({
      distribution,
      publicKeyPem,
      fetch: fetchMock,
      rolloutHistory: options.rolloutHistory
    }),
    target: targetValues[targetId]
  }
}

describe('v2 release source', () => {
  it('resolves only the current platform Candidate pointer', async () => {
    const { source, fetchMock, target } = fixture()

    const release = await source.resolve('candidate', target)

    expect(release.manifest.target).toEqual({ platform: 'darwin', arch: 'x64' })
    expect(release.rollout.track).toBe('candidate')
    expect(release.minimumSystemVersion).toBe('22.0.0')
    expect(release.manualInstallerUrl.href).toBe(
      'https://updates.example.test/desktop/releases/v1.0.0/targets/darwin-x64/insight-1.0.0-darwin-x64.dmg'
    )
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://updates.example.test/desktop/candidate-v2/darwin-x64/current.json'),
      {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        redirect: 'manual',
        signal: expect.any(AbortSignal)
      }
    )
  })

  it('resolves Stable through the complete Release Index trust chain', async () => {
    const { source, target } = fixture({ track: 'stable', target: 'darwin-arm64' })

    const release = await source.resolve('stable', target)
    const recovery = await source.resolveRecoveryBaseline(target)

    expect(release.rollout.track).toBe('stable')
    expect(release.releaseIndex?.targets.map(({ id }) => id)).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'win32-x64'
    ])
    expect(release.releaseIndexBytes).toBeDefined()
    expect(release.releaseIndexSignatureBytes).toBeDefined()
    expect(recovery).toMatchObject({
      version: '1.0.0',
      source: 'stable',
      readsDataSchema: { minimum: 1, maximum: 1 }
    })
  })

  it('uses only the signed rc.20 bridge before the first Stable pointer exists', async () => {
    const target = targetValues['darwin-x64']
    const version = '1.0.0-rc.20'
    const metadata = Buffer.from(`version: ${version}\nminimumSystemVersion: 22.0.0\n`)
    const legacyManifest = {
      schema: 'insight-desktop-update/v1',
      version,
      channel: 'candidate',
      publishedAt: '2026-09-22T08:00:00.000Z',
      shellCommit: 'a'.repeat(40),
      coreRuntime: { tag: 'runtime-v1', commit: 'b'.repeat(40) },
      policy: { mode: 'optional', minimumSupportedVersion: '1.0.0-rc.17' },
      compatibility: {
        profileSchema: 1,
        accountStorageSchema: 1,
        minimumReadableDataSchema: 1,
        maximumReadableDataSchema: 1
      },
      artifacts: [
        artifact(target, 'dmg', 'bridge.dmg'),
        artifact(target, 'zip', 'bridge.zip'),
        artifact(target, 'blockmap', 'bridge.zip.blockmap'),
        artifact(target, 'updater-metadata', 'latest-mac.yml', metadata)
      ]
    }
    const authenticated = signedJson(legacyManifest)
    const stablePointer = distribution.v2PointerUrl('stable').href
    const candidatePointer = distribution.currentPointerUrl('candidate').href
    const releaseBaseUrl = distribution.releaseBaseUrl('candidate', version)
    const files = new Map<string, Uint8Array>([
      [candidatePointer, Buffer.from(JSON.stringify({
        schemaVersion: 1, channel: 'candidate', version
      }))],
      [new URL('insight-update.json', releaseBaseUrl).href, authenticated.bytes],
      [new URL('insight-update.json.sig', releaseBaseUrl).href, authenticated.signature],
      [new URL('latest-mac.yml', releaseBaseUrl).href, metadata]
    ])
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === stablePointer) return response(url, 'missing', 404)
      const bytes = files.get(url)
      return bytes ? response(url, Buffer.from(bytes)) : response(url, 'missing', 404)
    })
    const source = new V2ReleaseSource({ distribution, publicKeyPem, fetch: fetchMock })

    await expect(source.resolveRecoveryBaseline(target)).resolves.toMatchObject({
      version,
      source: 'bridge',
      readsDataSchema: { minimum: 1, maximum: 1 },
      manualInstallerUrl: new URL(`${releaseBaseUrl.href}bridge.dmg`)
    })
  })

  it('does not hide a broken Stable trust chain behind the legacy bridge', async () => {
    const { source, target } = fixture({
      track: 'stable',
      corruptEnvelopeSignature: true
    })
    await expect(source.resolveRecoveryBaseline(target)).rejects.toThrow('签名')
  })

  it('records and rejects a signed Candidate tombstone before fetching release assets', async () => {
    const rolloutHistory: RolloutHistoryService = {
      hasSeen: vi.fn(async () => true),
      assertAndRecord: vi.fn(async () => undefined)
    }
    const { source, target, fetchMock } = fixture({
      rolloutState: 'rejected',
      rolloutHistory
    })

    await expect(source.resolve('candidate', target)).rejects.toThrow('已由发布方撤回')
    expect(rolloutHistory.assertAndRecord).toHaveBeenCalledWith(expect.objectContaining({
      track: 'candidate',
      target: 'darwin-x64',
      version: '1.0.0',
      state: 'rejected'
    }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a previously verified Stable pointer disappears', async () => {
    const pointerUrl = distribution.v2PointerUrl('stable').href
    const rolloutHistory: RolloutHistoryService = {
      hasSeen: vi.fn(async () => true),
      assertAndRecord: vi.fn(async () => undefined)
    }
    const source = new V2ReleaseSource({
      distribution,
      publicKeyPem,
      rolloutHistory,
      fetch: vi.fn(async () => response(pointerUrl, 'missing', 404))
    })

    await expect(source.resolve('stable', targetValues['darwin-arm64']))
      .rejects.toThrow('拒绝可能的回放')
  })

  it.each([
    ['wrong target', { rolloutTarget: 'win32-x64' as const }, '目标'],
    ['manifest hash mismatch', { corruptManifestReference: true }, '摘要'],
    ['envelope signature mismatch', { corruptEnvelopeSignature: true }, '签名'],
    ['required Candidate', { requiredCandidate: true }, 'optional'],
    ['metadata artifact mismatch', { metadataUpdateShaMismatch: true }, '可信安装产物'],
    ['redirect', { redirectPointerTo: 'https://attacker.test/current.json' }, '不受信任']
  ])('rejects %s', async (_label, options, message) => {
    const { source, target } = fixture(options)
    await expect(source.resolve('candidate', target)).rejects.toThrow(message)
  })

  it('rejects an incomplete Stable index', async () => {
    const { source, target } = fixture({ track: 'stable', incompleteIndex: true })
    await expect(source.resolve('stable', target)).rejects.toThrow('完整目标集合')
  })

  it('rejects a target whose signed identity differs from the Stable index', async () => {
    const { source, target } = fixture({
      track: 'stable',
      manifestShellCommit: 'c'.repeat(40)
    })
    await expect(source.resolve('stable', target)).rejects.toThrow('发布身份不一致')
  })

  it('aborts a stalled body at the shared request deadline', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const pointerUrl = distribution.v2PointerUrl('candidate', 'darwin-x64').href
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      const body = new ReadableStream({
        start(controller) {
          signal!.addEventListener('abort', () => controller.error(signal!.reason), { once: true })
        }
      })
      return response(pointerUrl, body)
    })
    try {
      const source = new V2ReleaseSource({ distribution, publicKeyPem, fetch: fetchMock })
      const checking = expect(source.resolve('candidate', targetValues['darwin-x64']))
        .rejects.toThrow('请求超时')
      await Promise.resolve()
      await Promise.resolve()
      expect(signal).toBeDefined()
      vi.advanceTimersByTime(30_000)
      await checking
      expect(signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects oversized metadata before buffering it', async () => {
    const pointerUrl = distribution.v2PointerUrl('candidate', 'darwin-x64').href
    const fetchMock = vi.fn(async () => {
      const reply = response(pointerUrl, '{}')
      reply.headers.set('content-length', String(4 * 1024 * 1024 + 1))
      return reply
    })
    const source = new V2ReleaseSource({ distribution, publicKeyPem, fetch: fetchMock })

    await expect(source.resolve('candidate', targetValues['darwin-x64']))
      .rejects.toThrow('超过允许大小')
  })
})
