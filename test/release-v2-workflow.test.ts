import { createHash } from 'node:crypto'
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
  await Promise.all([
    writeFile(packagePath, JSON.stringify({ version })),
    writeFile(publicKeyPath, 'unused for a legacy floor pointer')
  ])
  return { root, packagePath, publicKeyPath }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(status === 404 ? '' : JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('release v2 workflow contract', () => {
  it('pins a final version, builds only fixed targets, and appends signed assets', async () => {
    const workflow = await readFile(workflowPath, 'utf8')
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
        return jsonResponse({ schemaVersion: 1, channel: 'candidate', version: '1.0.0-rc.18' })
      }
      if (url.endsWith('/git/ref/tags/v1.0.1')) return jsonResponse({}, 404)
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
      versionFloor: '1.0.0-rc.18',
      createdTag: true,
      createdDraft: true
    })
    const tagRequest = fetch.mock.calls.find(([url]) => String(url).endsWith('/git/refs'))
    expect(JSON.parse(String(tagRequest?.[1]?.body))).toEqual({
      ref: 'refs/tags/v1.0.1', sha: commit
    })
  })

  it('rejects a reused version or a Tag on another commit', async () => {
    const files = await fixture()
    const floorFetch = vi.fn(async () =>
      jsonResponse({ schemaVersion: 1, channel: 'stable', version: '1.0.1' }))
    await expect(prepareV2Draft({
      version: '1.0.1',
      commit: 'a'.repeat(40),
      repository: 'Boxser567/insight-desktop-shell',
      token: 'token',
      packagePath: files.packagePath,
      publicKeyPath: files.publicKeyPath,
      floorUrls: ['https://updates.insight-aigc.com/desktop/stable/current.json'],
      fetch: floorFetch
    })).rejects.toThrow('greater than authoritative floor')

    const wrongTagFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://updates.insight-aigc.com/')) {
        return jsonResponse({ schemaVersion: 1, channel: 'candidate', version: '1.0.0-rc.18' })
      }
      return jsonResponse({ object: { sha: 'b'.repeat(40) } })
    })
    await expect(prepareV2Draft({
      version: '1.0.1',
      commit: 'a'.repeat(40),
      repository: 'Boxser567/insight-desktop-shell',
      token: 'token',
      packagePath: files.packagePath,
      publicKeyPath: files.publicKeyPath,
      floorUrls: ['https://updates.insight-aigc.com/desktop/candidate/current.json'],
      fetch: wrongTagFetch
    })).rejects.toThrow('points to another commit')
  })

  it('prefixes assets by target and never replaces conflicting Draft bytes', async () => {
    const files = await fixture()
    const bytes = Buffer.from('verified target bytes')
    const assetDirectory = path.join(files.root, 'target-assets')
    await mkdir(assetDirectory)
    await writeFile(path.join(assetDirectory, 'insight-target.json'), bytes)
    const uploadFetch = vi.fn(async (input: RequestInfo | URL) => {
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
