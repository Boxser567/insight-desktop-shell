import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error Production scripts are plain ESM and expose runtime-tested helpers.
import * as githubOss from '../scripts/github-oss-client.mjs'

const {
  assertGithubPublisherEnvironment,
  createGithubOssClient,
  validateStsResponse
} = githubOss

const baseEnvironment = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'Boxser567/insight-desktop-shell',
  GITHUB_REPOSITORY_ID: '1344679131',
  GITHUB_RUN_ID: '987654321',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW_REF: 'Boxser567/insight-desktop-shell/.github/workflows/publish-update.yml@refs/heads/main',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com/oidc?job=publish',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-secret'
}

function stsPayload(overrides: Record<string, unknown> = {}) {
  return {
    code: 'SUCCESS',
    data: {
      accessKeyId: 'STS.access-key-id',
      accessKeySecret: 'sts-access-key-secret',
      securityToken: 'sts-security-token',
      expiration: '2099-01-01T00:00:00Z',
      durationSeconds: 900,
      bucket: 'insight-desktop-updates',
      region: 'oss-cn-guangzhou',
      endPoint: 'oss-cn-guangzhou.aliyuncs.com',
      dir: '',
      fileType: 'file',
      url: null,
      repositoryId: '1344679131',
      runId: '987654321',
      ...overrides
    }
  }
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function createFetch(sts = stsPayload()) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.hostname === 'token.actions.githubusercontent.com') {
      expect(url.searchParams.get('audience')).toBe('insight-harness-oss-upload')
      expect(init).toMatchObject({ redirect: 'error' })
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer github-request-secret'
      )
      return response({ value: 'github-oidc-secret' })
    }
    expect(url.href).toBe(
      'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/upload/sts/token'
    )
    expect(init).toMatchObject({ method: 'POST', body: '{}' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer github-oidc-secret')
    return response(sts)
  })
}

describe('GitHub OIDC OSS client', () => {
  it('resumes multipart uploads with bounded retries and immutable headers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oss-upload-test-'))
    const source = join(dir, 'asset.dmg')
    const file = await open(source, 'w')
    await file.truncate(8 * 1024 * 1024)
    await file.close()
    const checkpoint = { uploadId: 'private-upload-id', doneParts: [{ number: 1 }] }
    const calls: any[] = []
    const logs: string[] = []
    const multipartUpload = vi.fn(async (_key, _source, options) => {
      calls.push(options)
      await options.progress(0.5, checkpoint)
      if (calls.length === 1) throw Object.assign(new Error('secret'), { name: 'ResponseTimeoutError' })
      return { res: { status: 200 } }
    })
    try {
      const client = createGithubOssClient({ environment: baseEnvironment, fetch: createFetch(),
        ossClientFactory: () => ({ multipartUpload }), wait: async () => {}, note: (line: string) => logs.push(line) })
      await client.uploadReleaseObject('desktop/releases/v1/asset.dmg', source, { 'x-oss-forbid-overwrite': 'true' })
      expect(calls).toHaveLength(2)
      expect(calls[1]).toMatchObject({ checkpoint, partSize: 4 * 1024 * 1024, parallel: 1, timeout: 120_000,
        headers: { 'x-oss-forbid-overwrite': 'true' } })
      expect(logs.join('\n')).not.toMatch(/secret|private-upload-id/)
      calls.length = 0
      multipartUpload.mockImplementation(async () => { throw Object.assign(new Error('secret'), { status: 403, code: 'AccessDenied' }) })
      await expect(client.uploadReleaseObject('desktop/releases/v1/asset.dmg', source, {})).rejects.toThrow('AccessDenied')
      expect(multipartUpload).toHaveBeenCalledTimes(3)
      multipartUpload.mockClear()
      let tokenAttempt = 0
      multipartUpload.mockImplementation(async (_key, _source, options) => {
        if (++tokenAttempt === 1) {
          await options.progress(0.5, checkpoint)
          throw Object.assign(new Error('secret'), { code: 'SecurityTokenExpired', status: 403 })
        }
        expect(options.checkpoint).toBe(checkpoint)
        return { res: { status: 200 } }
      })
      await client.uploadReleaseObject('desktop/releases/v1/asset.dmg', source, {})
      expect(multipartUpload).toHaveBeenCalledTimes(2)
      multipartUpload.mockClear().mockImplementation(async () => { throw Object.assign(new Error('secret'), { name: 'ResponseTimeoutError' }) })
      await expect(client.uploadReleaseObject('desktop/releases/v1/asset.dmg', source, {})).rejects.toThrow('ResponseTimeoutError')
      expect(multipartUpload).toHaveBeenCalledTimes(3)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('requests new credentials from the SDK refresh callback', async () => {
    let configuration: any
    const fetch = createFetch()
    const client = createGithubOssClient({ environment: baseEnvironment, fetch,
      ossClientFactory: (value: any) => { configuration = value; return { listV2: async () => ({ objects: [] }) } } })
    await client.listObjects('desktop/')
    await configuration.refreshSTSToken()
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('uses a bounded ordinary upload for small release files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oss-small-test-'))
    const source = join(dir, 'asset')
    const file = await open(source, 'w')
    await file.write('small')
    await file.close()
    const put = vi.fn(async () => ({ res: { status: 200 } }))
    const multipartUpload = vi.fn()
    try {
      const client = createGithubOssClient({ environment: baseEnvironment, fetch: createFetch(),
        ossClientFactory: () => ({ put, multipartUpload }) })
      await client.uploadReleaseObject('desktop/asset', source, { 'x-oss-forbid-overwrite': 'true' })
      expect(put).toHaveBeenCalledWith('desktop/asset', source, { timeout: 120_000, headers: { 'x-oss-forbid-overwrite': 'true' } })
      expect(multipartUpload).not.toHaveBeenCalled()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('accepts only the approved GitHub Actions publisher identity', () => {
    expect(assertGithubPublisherEnvironment(baseEnvironment)).toMatchObject({
      repositoryId: '1344679131',
      runId: '987654321'
    })

    const invalidEnvironment: Array<[string, string]> = [
      ['GITHUB_ACTIONS', 'false'],
      ['GITHUB_REPOSITORY', 'attacker/repository'],
      ['GITHUB_REPOSITORY_ID', '1362006344'],
      ['GITHUB_RUN_ID', 'not-a-run'],
      ['GITHUB_REF', 'refs/heads/feature'],
      ['GITHUB_EVENT_NAME', 'pull_request'],
      ['GITHUB_WORKFLOW_REF', 'Boxser567/insight-desktop-shell/.github/workflows/other.yml@refs/heads/main'],
      ['ACTIONS_ID_TOKEN_REQUEST_URL', 'http://token.example.test/oidc'],
      ['ACTIONS_ID_TOKEN_REQUEST_URL', 'https://user:password@token.example.test/oidc'],
      ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', '']
    ]
    for (const [name, value] of invalidEnvironment) {
      expect(() => assertGithubPublisherEnvironment({
        ...baseEnvironment,
        [name]: value
      })).toThrow()
    }
  })

  it('validates the complete directory-level STS response', () => {
    expect(validateStsResponse(stsPayload(), baseEnvironment)).toMatchObject({
      bucket: 'insight-desktop-updates',
      region: 'oss-cn-guangzhou',
      endPoint: 'oss-cn-guangzhou.aliyuncs.com',
      dir: ''
    })

    for (const invalid of [
      { code: 'INVALID_FILE_NAME', data: {} },
      stsPayload({ accessKeySecret: '' }),
      stsPayload({ expiration: 'invalid' }),
      stsPayload({ bucket: 'another-bucket' }),
      stsPayload({ region: 'oss-cn-hangzhou' }),
      stsPayload({ endPoint: 'oss-cn-hangzhou.aliyuncs.com' }),
      stsPayload({ dir: 'unexpected-prefix' }),
      stsPayload({ repositoryId: '1362006344' }),
      stsPayload({ runId: '123' })
    ]) {
      expect(() => validateStsResponse(invalid, baseEnvironment)).toThrow()
    }
  })

  it('uses the server-issued scope and refreshes credentials before they become too old', async () => {
    let now = Date.parse('2026-09-09T00:00:00Z')
    let issued = 0
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'token.actions.githubusercontent.com') {
        return response({ value: `oidc-${issued + 1}` })
      }
      issued += 1
      return response(stsPayload({
        accessKeyId: `STS.${issued}`,
        expiration: new Date(now + 900_000).toISOString()
      }))
    })
    const clients: Array<{ listV2: ReturnType<typeof vi.fn> }> = []
    const client = createGithubOssClient({
      environment: baseEnvironment,
      fetch,
      now: () => now,
      ossClientFactory: (configuration: Record<string, unknown>) => {
        expect(configuration).toMatchObject({
          bucket: 'insight-desktop-updates',
          region: 'oss-cn-guangzhou',
          endpoint: 'https://oss-cn-guangzhou.aliyuncs.com',
          authorizationV4: true
        })
        const value = { listV2: vi.fn(async () => ({ objects: [], isTruncated: false })) }
        clients.push(value)
        return value
      }
    })

    await client.listObjects('desktop/releases/v1.0.0/')
    now += 721_000
    await client.listObjects('desktop/releases/v1.0.0/')

    expect(issued).toBe(2)
    expect(clients).toHaveLength(2)
  })

  it('retries one whole PutObject after a token error and preserves immutable headers', async () => {
    const puts: Array<{ key: string, source: string, options: unknown }> = []
    let session = 0
    const ossClientFactory = vi.fn(() => {
      session += 1
      return {
        put: vi.fn(async (key: string, source: string, options: unknown) => {
          puts.push({ key, source, options })
          if (session === 1) {
            throw Object.assign(new Error('must stay hidden: sts-security-token'), {
              status: 403,
              code: 'SecurityTokenExpired',
              requestId: 'request-1'
            })
          }
          return { res: { status: 200, headers: { 'x-oss-request-id': 'request-2' } } }
        })
      }
    })
    const client = createGithubOssClient({
      environment: baseEnvironment,
      fetch: createFetch(),
      ossClientFactory
    })

    await expect(client.putObject(
      'desktop/releases/v1.0.0/insight.dmg',
      '/tmp/insight.dmg',
      {
        'x-oss-forbid-overwrite': 'true',
        'cache-control': 'public,max-age=31536000,immutable'
      }
    )).resolves.toMatchObject({ status: 200, requestId: 'request-2' })

    expect(ossClientFactory).toHaveBeenCalledTimes(2)
    expect(puts).toHaveLength(2)
    expect(puts[1]).toMatchObject({
      key: 'desktop/releases/v1.0.0/insight.dmg',
      source: '/tmp/insight.dmg',
      options: {
        headers: {
          'x-oss-forbid-overwrite': 'true',
          'cache-control': 'public,max-age=31536000,immutable'
        }
      }
    })
  })

  it('does not retry unrelated errors and only exposes safe OSS diagnostics', async () => {
    const put = vi.fn(async () => {
      throw Object.assign(new Error('leaked sts-access-key-secret'), {
        status: 403,
        code: 'AccessDenied',
        requestId: 'safe-request-id',
        details: { securityToken: 'leaked-token' }
      })
    })
    const client = createGithubOssClient({
      environment: baseEnvironment,
      fetch: createFetch(),
      ossClientFactory: () => ({ put })
    })

    await expect(client.putObject('desktop/file', '/tmp/file', {})).rejects.toThrow(
      'OSS request failed: status=403; code=AccessDenied; requestId=safe-request-id.'
    )
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('fails closed on Gateway HTTP errors without exposing response bodies', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'token.actions.githubusercontent.com') {
        return response({ value: 'private-oidc' })
      }
      return response({
        code: 'INVALID_FILE_NAME',
        message: 'fileName 不能为空; private-oidc'
      }, 400)
    })
    const client = createGithubOssClient({
      environment: baseEnvironment,
      fetch,
      ossClientFactory: () => ({ listV2: vi.fn() })
    })

    await expect(client.listObjects('desktop/')).rejects.toThrow(
      'STS request failed: HTTP 400; code=INVALID_FILE_NAME.'
    )
  })
})
