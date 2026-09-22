import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
// @ts-expect-error ali-oss is an untyped runtime dependency of the publisher.
import OSS from 'ali-oss'
// @ts-expect-error Diagnostic scripts are plain ESM.
import { runUploadProbe } from '../scripts/diagnose-oss-upload.mjs'

describe('isolated OSS upload probe', () => {
  it('real SDK consumes complete file/Buffer bodies and multipart streams on loopback', async () => {
    const received: number[] = []
    const server = createServer((req, res) => {
      let bytes = 0
      req.on('data', (chunk) => { bytes += chunk.length })
      req.on('end', () => {
        res.setHeader('x-oss-request-id', 'local-request')
        res.setHeader('etag', '"test-etag"')
        const url = new URL(req.url!, 'http://localhost')
        if (req.method === 'PUT') { received.push(bytes); res.end() }
        else if (url.searchParams.has('uploads')) {
          res.setHeader('content-type', 'application/xml')
          res.end('<InitiateMultipartUploadResult><UploadId>local-upload</UploadId></InitiateMultipartUploadResult>')
        } else {
          res.setHeader('content-type', 'application/xml')
          res.end('<CompleteMultipartUploadResult><ETag>test-etag</ETag></CompleteMultipartUploadResult>')
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const client = new OSS({ accessKeyId: 'dummy', accessKeySecret: 'dummy', bucket: 'probe-bucket',
      region: 'oss-cn-guangzhou', endpoint: `http://127.0.0.1:${address.port}`, secure: false,
      authorizationV4: true, retryMax: 0, timeout: 3000 })
    try {
      const report = await runUploadProbe(client, 'desktop/diagnostics/loopback/', {
        send: async () => ({ res: { status: 200, headers: {} } }), note: vi.fn()
      })
      expect(report.results.every((row: { ok: boolean }) => row.ok)).toBe(true)
      expect(received.sort((a, b) => a - b)).toEqual([65536, 65536, ...Array(6).fill(4194304)])
      for (const row of report.results.filter((row: { mode: string }) => row.mode.includes('file') || row.mode === 'multipart-buffer')) {
        expect(row.sourceBytesRead).toBe(row.size)
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 15000)

  it('compares transports, continues after failure and never reports signed URLs', async () => {
    const ok = { res: { status: 200, headers: { 'x-oss-request-id': 'request-123' } } }
    const put = vi.fn(async (_key, source, options) => {
      expect(options.timeout).toBe(60000)
      expect(options.headers['x-oss-forbid-overwrite']).toBe('true')
      if (typeof source === 'string') {
        expect((await readFile(source)).length).toBeGreaterThan(0)
        throw Object.assign(new Error('secret-token'), { name: 'ResponseTimeoutError' })
      }
      return ok
    })
    const multipartUpload = vi.fn(async (_key, _source, options) => {
      expect(options).toMatchObject({ parallel: 1, partSize: 4194304, timeout: 60000 })
      await options.progress(1, { doneParts: [1, 2] })
      return ok
    })
    const send = vi.fn(async () => ok)
    const client = { put, multipartUpload, signatureUrlV4: vi.fn(async () => 'https://example.com/?secret-token') }
    const report = await runUploadProbe(client, 'desktop/diagnostics/test-123/', { send, note: vi.fn() })
    expect(report.results).toHaveLength(8)
    expect(report.results.filter((row: { ok: boolean }) => row.ok)).toHaveLength(6)
    expect(new Set(report.results.map((row: { key: string }) => row.key)).size).toBe(8)
    expect(report.results.every((row: { key: string }) => row.key.startsWith('desktop/diagnostics/test-123/'))).toBe(true)
    expect(JSON.stringify(report)).not.toContain('secret-token')
    expect(send).toHaveBeenCalledTimes(2)
    expect(multipartUpload).toHaveBeenCalledTimes(2)
  })

  it('rejects release and traversal prefixes before issuing requests', async () => {
    for (const prefix of ['desktop/releases/v1.0.0/', 'desktop/diagnostics/../', 'desktop/candidate/']) {
      await expect(runUploadProbe({}, prefix)).rejects.toThrow('Invalid diagnostic prefix')
    }
  })

  it('keeps diagnostic workflow separate from promotion', async () => {
    const workflow = await readFile(new URL('../.github/workflows/publish-update.yml', import.meta.url), 'utf8')
    expect(workflow).toContain("if: inputs.command == 'diagnose'")
    expect(workflow).toContain("- name: Publish verified update assets\n        if: inputs.command != 'diagnose'")
  })
})
