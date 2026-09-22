import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { parseUpdateDistribution } from '../src/main/update/update-environment'
import { V2ReleaseSource } from '../src/main/update/v2-release-source'
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
} = {}) {
  const track = options.track ?? 'candidate'
  const targetId = options.target ?? 'darwin-x64'
  const metadata = Buffer.from('version: 1.0.0\nminimumSystemVersion: 22.0.0\n')
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
    track,
    version: '1.0.0',
    ...(track === 'candidate' ? { target: options.rolloutTarget ?? targetId } : {}),
    referencedSha512,
    policy: {
      mode: options.requiredCandidate ? 'required' : 'optional',
      minimumSupportedVersion: '1.0.0-rc.18'
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
    source: new V2ReleaseSource({ distribution, publicKeyPem, fetch: fetchMock }),
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

    expect(release.rollout.track).toBe('stable')
    expect(release.releaseIndex?.targets.map(({ id }) => id)).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'win32-x64'
    ])
    expect(release.releaseIndexBytes).toBeDefined()
    expect(release.releaseIndexSignatureBytes).toBeDefined()
  })

  it.each([
    ['wrong target', { rolloutTarget: 'win32-x64' as const }, '目标'],
    ['manifest hash mismatch', { corruptManifestReference: true }, '摘要'],
    ['envelope signature mismatch', { corruptEnvelopeSignature: true }, '签名'],
    ['required Candidate', { requiredCandidate: true }, 'optional'],
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
      const reply = response(pointerUrl, '')
      reply.arrayBuffer = () => new Promise<ArrayBuffer>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
      return reply
    })
    try {
      const source = new V2ReleaseSource({ distribution, publicKeyPem, fetch: fetchMock })
      const checking = expect(source.resolve('candidate', targetValues['darwin-x64']))
        .rejects.toThrow('请求超时')
      await vi.advanceTimersByTimeAsync(30_000)
      await checking
      expect(signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
