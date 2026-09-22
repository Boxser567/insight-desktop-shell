import { request } from 'node:https'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGithubOssClient } from './github-oss-client.mjs'

const timeout = 60_000
const safeCode = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null

// The URL contains a temporary credential. Never include it or raw errors in reports.
export function httpPut(url, body, headers, observation) {
  return new Promise((resolveResult, reject) => {
    const started = Date.now()
    const req = request(url, { method: 'PUT', headers: { ...headers, 'content-length': body.length },
      signal: AbortSignal.timeout(timeout), agent: false }, (res) => {
      observation.responseMs = Date.now() - started
      observation.status = res.statusCode
      observation.requestId = safeCode(res.headers['x-oss-request-id'])
      res.resume()
      res.on('error', reject)
      res.on('end', () => resolveResult({ res: { status: res.statusCode, headers: res.headers } }))
    })
    req.on('socket', (socket) => {
      socket.once('lookup', () => { observation.dnsMs = Date.now() - started })
      socket.once('connect', () => { observation.connectMs = Date.now() - started })
      socket.once('secureConnect', () => { observation.tlsMs = Date.now() - started })
    })
    req.once('finish', () => {
      observation.requestBodyFlushed = true // Handed to the OS, NOT an OSS acknowledgment.
      observation.bodyBytesSubmitted = body.length
    })
    req.on('error', reject)
    req.end(body)
  })
}

export async function runUploadProbe(client, prefix, { send = httpPut, note = console.log } = {}) {
  if (!/^desktop\/diagnostics\/[A-Za-z0-9-]+\/$/u.test(prefix)) throw new Error('Invalid diagnostic prefix')
  const directory = await mkdtemp(join(tmpdir(), 'insight-oss-probe-'))
  const results = []
  // Observe emitted data without adding a data listener (which would start flowing
  // before the HTTP consumer is ready and could itself lose bytes).
  const originalRequest = client.urllib?.request
  let observation
  if (originalRequest) client.urllib.request = function (url, options) {
    const current = observation
    if (options?.stream && current) {
      const emit = options.stream.emit
      options.stream.emit = function (event, ...args) {
        if (event === 'data') current.sourceBytesRead += args[0].length
        return emit.call(this, event, ...args)
      }
    }
    return originalRequest.call(this, url, options)
  }
  try {
    for (const size of [64 * 1024, 4 * 1024 * 1024, 8 * 1024 * 1024]) {
      const body = randomBytes(size)
      const file = join(directory, 'payload.bin')
      await writeFile(file, body)
      const modes = size === 8 * 1024 * 1024
        ? ['multipart-file', 'multipart-buffer'] : ['sdk-file', 'sdk-buffer', 'https-buffer']
      for (const mode of modes) {
        const key = `${prefix}${size}-${mode}.bin`
        const headers = { 'x-oss-forbid-overwrite': 'true', 'content-type': 'application/octet-stream' }
        const row = { mode, size, key, sourceBytesRead: 0, ok: false }
        observation = row
        const started = Date.now()
        note(`[probe] start ${mode} bytes=${size}`)
        try {
          let result
          if (mode === 'https-buffer') {
            // ali-oss 6.x builds the credential query before its refresh callback.
            // Sign with one consistent snapshot, not mixed old/new credentials.
            // Only signing uses this view; normal SDK requests retain STS refresh.
            const signer = Object.create(client)
            signer.options = { ...client.options, refreshSTSToken: undefined }
            const url = await signer.signatureUrlV4('PUT', 120, { headers }, key)
            result = await send(url, body, headers, row)
          } else if (mode.startsWith('multipart-')) {
            result = await client.multipartUpload(key, mode.endsWith('file') ? file : body,
              { headers, timeout, partSize: 4 * 1024 * 1024, parallel: 1,
                progress: async (_, checkpoint) => { row.completedParts = checkpoint?.doneParts?.length ?? 0 } })
          } else {
            result = await client.put(key, mode.endsWith('file') ? file : body, { headers, timeout })
          }
          row.status = result?.res?.status ?? null
          row.requestId = safeCode(result?.res?.headers?.['x-oss-request-id'])
          row.ok = Number.isInteger(row.status) && row.status >= 200 && row.status < 300
        } catch (error) {
          row.error = safeCode(error?.code) ?? safeCode(error?.name) ?? 'UNKNOWN'
          row.status = Number.isInteger(error?.status) ? error.status : row.status ?? null
          row.requestId = safeCode(error?.requestId) ?? row.requestId ?? null
        }
        row.elapsedMs = Date.now() - started
        observation = undefined
        results.push(row)
        note(`[probe] ${JSON.stringify(row)}`)
      }
    }
  } finally {
    if (originalRequest) client.urllib.request = originalRequest
    await rm(directory, { recursive: true, force: true })
  }
  return { schemaVersion: 1, node: process.version, platform: process.platform, prefix, results,
    note: 'sourceBytesRead measures local stream consumption, not remote receipt. Zero can mean a non-stream body. No release or pointer writes. Diagnostic objects and incomplete multipart uploads are retained.' }
}

async function main() {
  const client = createGithubOssClient()
  const report = await client.diagnoseUploads(randomUUID())
  await mkdir('release-reports', { recursive: true })
  await writeFile('release-reports/oss-probe.json', `${JSON.stringify(report, null, 2)}\n`)
  if (report.results.some((row) => !row.ok)) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('[probe] Setup/report failed; no credentials logged.'); process.exitCode = 1 })
}
