import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareV2Draft } from '../scripts/prepare-update-v2-draft.mjs'
import { uploadV2Target } from '../scripts/upload-update-v2-target.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'release-v2.yml')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function fixture(version = '1.0.1') {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-release-v2-workflow-'))
  temporaryDirectories.push(root)
  const packagePath = path.join(root, 'package.json')
  const publicKeyPath = path.join(root, 'update-signing-public.pem')
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const bridgeManifest = Buffer.from(JSON.stringify({
    schema: 'insight-desktop-update/v1',
    version: '1.0.0-rc.19',
    channel: 'candidate'
  }))
  await Promise.all([
    writeFile(packagePath, JSON.stringify({ version })),
    writeFile(publicKeyPath, publicKeyPem)
  ])
  const floorResponses = new Map<string, Buffer>([
    ['https://updates.insight-aigc.com/desktop/candidate/current.json', Buffer.from(JSON.stringify({
      schemaVersion: 1, channel: 'candidate', version: '1.0.0-rc.19'
    }))],
    ['https://updates.insight-aigc.com/desktop/releases/v1.0.0-rc.19/insight-update.json', bridgeManifest],
    ['https://updates.insight-aigc.com/desktop/releases/v1.0.0-rc.19/insight-update.json.sig', sign(null, bridgeManifest, privateKey)]
  ])
  return { root, packagePath, publicKeyPath, privateKey, floorResponses }
}

function signedCandidateFloor(
  files: Awaited<ReturnType<typeof fixture>>,
  version: string,
  target: 'darwin-arm64' | 'darwin-x64' | 'win32-x64'
): Response {
  const payload = Buffer.from(JSON.stringify({
    schema: 'insight-desktop-rollout/v2',
    state: 'active',
    track: 'candidate',
    version,
    target,
    referencedSha512: Buffer.alloc(64, 3).toString('base64'),
    policy: { mode: 'optional', minimumSupportedVersion: '1.0.0-rc.19' },
    publishedAt: '2026-09-22T12:00:00.000Z'
  }))
  return jsonResponse({
    schema: 'insight-desktop-rollout-envelope/v2',
    payloadBase64: payload.toString('base64'),
    signatureBase64: sign(null, payload, files.privateKey).toString('base64')
  })
}

function recoveryFloorResponse(
  files: Awaited<ReturnType<typeof fixture>>,
  url: string
): Response | undefined {
  const bytes = files.floorResponses.get(url)
  return bytes ? new Response(Uint8Array.from(bytes), { status: 200 }) : undefined
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(status === 404 ? '' : JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('release v2 workflow contract', () => {
  it('pins a final version, builds only fixed targets, and appends signed assets', async () => {
    const workflow = (await readFile(workflowPath, 'utf8')).replace(/\r\n?/gu, '\n')
    expect(workflow).toContain('group: desktop-release-v2-${{ inputs.version }}')
    expect(workflow.match(/ref: refs\/tags\/v\$\{\{ inputs\.version \}\}/gu)).toHaveLength(4)
    expect(workflow).toContain("if: inputs.target == 'darwin-arm64'")
    expect(workflow).toContain("if: inputs.target == 'darwin-x64'")
    expect(workflow).toContain("if: inputs.target == 'win32-x64'")
    expect(workflow).toContain('npm run package:release:mac:arm64')
    expect(workflow).toContain('npm run package:release:mac:x64')
    expect(workflow).toContain('npm run package:release:win')
    expect(workflow).toContain('environment: desktop-release')
    expect(workflow).toContain('secrets.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY')
    expect(workflow).toContain('scripts/upload-update-v2-target.mjs')
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow.match(/permissions:\n      contents: write/gu)).toHaveLength(2)
    expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(5)
    expect(workflow).toContain('npm run typecheck')
    expect(workflow).toContain('npm run prepare:core-runtime')
    expect(workflow).toContain('scripts/verify-publish-v2-workflow.mjs')
    expect(workflow).not.toContain('--clobber')
    expect(workflow).not.toContain('OSS_ACCESS_KEY')
    expect(workflow).not.toContain('package:candidate:')
  })

  it('creates the immutable Tag and Draft once above the authoritative floor', async () => {
    const files = await fixture()
    const commit = 'a'.repeat(40)
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://updates.insight-aigc.com/')) {
        const response = recoveryFloorResponse(files, url)
        if (response) return response
      }
      if (url.endsWith('/git/ref/tags/v1.0.1')) return jsonResponse({}, 404)
      if (url.endsWith('/git/matching-refs/tags/v')) return jsonResponse([])
      if (url.endsWith('/git/refs') && init?.method === 'POST') {
        return jsonResponse({ object: { sha: commit } })
      }
      if (url.endsWith('/releases/tags/v1.0.1')) return jsonResponse({}, 404)
      if (url.endsWith('/releases') && init?.method === 'POST') {
        return jsonResponse({ id: 42, tag_name: 'v1.0.1', draft: true })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(prepareV2Draft({
      version: '1.0.1',
      commit,
      repository: 'Boxser567/insight-desktop-shell',
      token: 'token',
      packagePath: files.packagePath,
      publicKeyPath: files.publicKeyPath,
      floorUrls: ['https://updates.insight-aigc.com/desktop/candidate/current.json'],
      fetch
    })).resolves.toEqual({
      tag: 'v1.0.1',
      commit,
      releaseId: 42,
      versionFloor: '1.0.0-rc.19',
      createdTag: true,
      createdDraft: true
    })
    const tagRequest = fetch.mock.calls.find(([url]) => String(url).endsWith('/git/refs'))
    expect(JSON.parse(String(tagRequest?.[1]?.body))).toEqual({
      ref: 'refs/tags/v1.0.1', sha: commit
    })
  })

  it('rejects a reused version without an allocated Tag', async () => {
    const files = await fixture()
    const floorFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://updates.insight-aigc.com/')) {
        return signedCandidateFloor(files, '1.0.1', 'darwin-arm64')
      }
      if (url.endsWith('/git/ref/tags/v1.0.1')) return jsonResponse({}, 404)
      throw new Error(`Unexpected request: ${url}`)
    })
    await expect(prepareV2Draft({
      version: '1.0.1',
      commit: 'a'.repeat(40),
      repository: 'Boxser567/insight-desktop-shell',
      token: 'token',
      packagePath: files.packagePath,
      publicKeyPath: files.publicKeyPath,
      floorUrls: ['https://updates.insight-aigc.com/desktop/candidate-v2/darwin-arm64/current.json'],
      fetch: floorFetch
    })).rejects.toThrow('greater than authoritative floor')

  })

  it('accepts legacy floors only from the historical Candidate path', async () => {
    const files = await fixture()
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/git/ref/tags/v1.0.1')) return jsonResponse({}, 404)
      if (url.startsWith('https://updates.insight-aigc.com/')) {
        return jsonResponse({ schemaVersion: 1, channel: 'stable', version: '1.0.0' })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(prepareV2Draft({
      version: '1.0.1',
      commit: 'a'.repeat(40),
      repository: 'Boxser567/insight-desktop-shell',
      token: 'token',
      packagePath: files.packagePath,
      publicKeyPath: files.publicKeyPath,
      floorUrls: ['https://updates.insight-aigc.com/desktop/stable/current.json'],
      fetch
    })).rejects.toBeDefined()
  })

  it('rejects an unsigned legacy pointer that tries to raise the global floor', async () => {
    const files = await fixture()
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/git/ref/tags/v1.0.1')) return jsonResponse({}, 404)
      if (url === 'https://updates.insight-aigc.com/desktop/candidate/current.json') {
        return jsonResponse({ schemaVersion: 1, channel: 'candidate', version: '999.0.0' })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(prepareV2Draft({
      version: '1.0.1',
      commit: 'a'.repeat(40),
      repository: 'Boxser567/insight-desktop-shell',
      token: 'token',
      packagePath: files.packagePath,
      publicKeyPath: files.publicKeyPath,
      floorUrls: ['https://updates.insight-aigc.com/desktop/candidate/current.json'],
      fetch
    })).rejects.toThrow('exactly the signed rc.19 bridge')
  })

  it('continues an existing version from its pinned Tag after main advances', async () => {
    const files = await fixture()
    const pinnedCommit = 'b'.repeat(40)
    const currentCommit = 'a'.repeat(40)
    const continuationFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://updates.insight-aigc.com/')) {
        const response = recoveryFloorResponse(files, url)
        if (response) return response
      }
      if (String(input).endsWith('/git/matching-refs/tags/v')) {
        return jsonResponse([{ ref: 'refs/tags/v1.0.1', object: { sha: pinnedCommit } }])
      }
      if (String(input).endsWith('/releases/tags/v1.0.1')) {
        return jsonResponse({ id: 42, tag_name: 'v1.0.1', draft: true })
      }
      return jsonResponse({ object: { sha: pinnedCommit } })
    })

    await writeFile(files.packagePath, JSON.stringify({ version: '1.0.2' }))
    await expect(prepareV2Draft({
      version: '1.0.1',
      commit: currentCommit,
      repository: 'Boxser567/insight-desktop-shell',
      token: 'token',
      packagePath: files.packagePath,
      publicKeyPath: files.publicKeyPath,
      floorUrls: ['https://updates.insight-aigc.com/desktop/candidate/current.json'],
      fetch: continuationFetch
    })).resolves.toEqual({
      tag: 'v1.0.1',
      commit: pinnedCommit,
      releaseId: 42,
      versionFloor: '1.0.0-rc.19',
      createdTag: false,
      createdDraft: false
    })
  })

  it('rejects a version below an allocated Tag floor', async () => {
    const files = await fixture()
    const burnedVersionFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://updates.insight-aigc.com/')) {
        const response = recoveryFloorResponse(files, url)
        if (response) return response
      }
      if (url.endsWith('/git/ref/tags/v1.0.1')) return jsonResponse({}, 404)
      if (url.endsWith('/git/matching-refs/tags/v')) {
        return jsonResponse([{ ref: 'refs/tags/v1.0.2', object: { sha: 'c'.repeat(40) } }])
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    await expect(prepareV2Draft({
      version: '1.0.1',
      commit: 'a'.repeat(40),
      repository: 'Boxser567/insight-desktop-shell',
      token: 'token',
      packagePath: files.packagePath,
      publicKeyPath: files.publicKeyPath,
      floorUrls: ['https://updates.insight-aigc.com/desktop/candidate/current.json'],
      fetch: burnedVersionFetch
    })).rejects.toThrow('allocated Tag floor 1.0.2')
  })

  it('prefixes assets by target and never replaces conflicting Draft bytes', async () => {
    const files = await fixture()
    const bytes = Buffer.from('verified target bytes')
    const assetDirectory = path.join(files.root, 'target-assets')
    await mkdir(assetDirectory)
    await writeFile(path.join(assetDirectory, 'insight-target.json'), bytes)
    const uploadFetch = vi.fn(async (
      input: RequestInfo | URL,
      _init?: RequestInit & { duplex?: string }
    ) => {
      const url = String(input)
      if (url.includes('/releases/tags/')) {
        return jsonResponse({
          id: 42,
          tag_name: 'v1.0.1',
          draft: true,
          upload_url: 'https://uploads.github.com/repos/owner/repo/releases/42/assets{?name,label}'
        })
      }
      if (url.includes('/releases/42/assets?')) return jsonResponse([])
      if (url.startsWith('https://uploads.github.com/')) return jsonResponse({ id: 7 })
      throw new Error(`Unexpected request: ${url}`)
    })
    await expect(uploadV2Target({
      repository: 'owner/repo', token: 'token', tag: 'v1.0.1',
      target: 'darwin-arm64', directory: assetDirectory, fetch: uploadFetch
    })).resolves.toEqual([{
      name: 'darwin-arm64--insight-target.json',
      sha512: createHash('sha512').update(bytes).digest('base64'),
      action: 'uploaded'
    }])
    expect(uploadFetch.mock.calls.some(([url]) =>
      String(url).includes('name=darwin-arm64--insight-target.json'))).toBe(true)
    const uploadRequest = uploadFetch.mock.calls.find(([url]) =>
      String(url).startsWith('https://uploads.github.com/'))?.[1] as RequestInit & {
        duplex?: string
      }
    expect(Buffer.isBuffer(uploadRequest.body)).toBe(false)
    expect(uploadRequest.headers).toMatchObject({ 'Content-Length': String(bytes.length) })
    expect(uploadRequest.duplex).toBe('half')

    const verifyFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/releases/tags/')) {
        return jsonResponse({ id: 42, tag_name: 'v1.0.1', draft: true, upload_url: '' })
      }
      if (url.includes('/releases/42/assets?')) {
        return jsonResponse([{
          name: 'darwin-arm64--insight-target.json', size: bytes.length, url: 'asset-url'
        }])
      }
      if (url === 'asset-url') return new Response(bytes)
      throw new Error(`Unexpected request: ${url}`)
    })
    await expect(uploadV2Target({
      repository: 'owner/repo', token: 'token', tag: 'v1.0.1',
      target: 'darwin-arm64', directory: assetDirectory, fetch: verifyFetch
    })).resolves.toEqual([{
      name: 'darwin-arm64--insight-target.json',
      sha512: createHash('sha512').update(bytes).digest('base64'),
      action: 'verified'
    }])

    const conflictFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/releases/tags/')) {
        return jsonResponse({ id: 42, tag_name: 'v1.0.1', draft: true, upload_url: '' })
      }
      return jsonResponse([{
        name: 'darwin-arm64--insight-target.json', size: bytes.length + 1, url: 'asset-url'
      }])
    })
    await expect(uploadV2Target({
      repository: 'owner/repo', token: 'token', tag: 'v1.0.1',
      target: 'darwin-arm64', directory: assetDirectory, fetch: conflictFetch
    })).rejects.toThrow('conflicts')
  })
})
