import { open, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

// Inspection must not exhaust the desktop process on an accidentally selected file.
const MAX_HISTORY_BYTES = 32 * 1024 * 1024

export interface HistoryDecoder {
  createRestore(header: unknown, options: { recovery: 'strict'; validation: 'transformed' }): {
    decodeRow(row: unknown): unknown
    finish(): { events: readonly { seq: number; type: string; data: unknown }[] }
  }
}

export interface HistoryExport {
  header: Record<string, unknown>
  rows: unknown[]
  jsonl: string
}

/** Read only the selected physical generation, including concatenated Zstandard frames. */
export async function readHistoryExport(path: string): Promise<HistoryExport> {
  if (!/^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(basename(path))) throw new Error('请选择 session 历史日志文件。')
  const file = await open(path, 'r')
  let bytes: Buffer
  try {
    if ((await file.stat()).size > MAX_HISTORY_BYTES) throw new Error('历史日志超过 32 MiB，只读导出暂不支持此文件。')
    // Read a bounded prefix even if the file grows after stat.
    bytes = Buffer.alloc(MAX_HISTORY_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < bytes.length) {
      const read = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead)
      if (read.bytesRead === 0) break
      bytesRead += read.bytesRead
    }
    if (bytesRead > MAX_HISTORY_BYTES) throw new Error('历史日志超过 32 MiB。')
    bytes = bytes.subarray(0, bytesRead)
  } finally { await file.close() }
  if (path.endsWith('.zstd')) {
    const frames: Buffer[] = []
    let total = 0
    while (bytes.length > 0) {
      // Node returns { buffer, engine } with info:true; the Node 24 type declarations omit that overload.
      const frame: unknown = zstdDecompressSync(bytes, { info: true, maxOutputLength: MAX_HISTORY_BYTES - total + 1 })
      if (!isObject(frame) || !Buffer.isBuffer(frame['buffer']) || !isObject(frame['engine'])
        || typeof frame['engine']['bytesWritten'] !== 'number' || frame['engine']['bytesWritten'] <= 0
        || frame['engine']['bytesWritten'] > bytes.length) throw new Error('无法读取 Zstandard 历史日志。')
      total += frame['buffer'].length
      if (total > MAX_HISTORY_BYTES) throw new Error('解压后的历史日志超过 32 MiB。')
      frames.push(frame['buffer'])
      bytes = bytes.subarray(frame['engine']['bytesWritten'])
    }
    bytes = Buffer.concat(frames, total)
  }
  const jsonl = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (!jsonl.endsWith('\n')) throw new Error('历史日志末尾不完整；原始文件未改动。')
  const rows: unknown[] = jsonl.trimEnd().split('\n').map(line => JSON.parse(line))
  const header = rows.shift()
  if (!isObject(header) || header['type'] !== 'session' || !Number.isInteger(header['version'])
    || Number(header['version']) < 0 || Number(header['version']) > 4) throw new Error('不支持的历史日志版本。')
  return { header, rows, jsonl }
}

/** Historical decoding is detached from Agent state and never executes or adopts logged tools. */
export function historyExportText(history: HistoryExport, decoder: HistoryDecoder): string {
  const restore = decoder.createRestore(history.header, { recovery: 'strict', validation: 'transformed' })
  for (const row of history.rows) restore.decodeRow(row)
  const artifact = restore.finish()
  const messages: string[] = [
    `会话 ${String(history.header['id'])} · 只读历史导出`,
    '仅用于查看保存的消息，不表示工具执行成功，也不会执行工具。',
  ]
  for (const event of artifact.events) {
    if (!isObject(event.data)) continue
    const message = isObject(event.data['message']) ? event.data['message'] : event.data
    if (typeof message['role'] !== 'string' || !Array.isArray(message['content'])) continue
    messages.push(`[${event.seq}] ${message['role']} (${event.type})\n${JSON.stringify(message, null, 2)}`)
  }
  return messages.join('\n\n') + '\n'
}

/** Never replace a committed generation or an existing export, including through a symlink. */
export async function saveHistoryExport(sourcePath: string, destination: string, contents: string): Promise<void> {
  if (resolve(sourcePath) === resolve(destination) || /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(basename(destination))) {
    throw new Error('导出不能覆盖原始会话日志，请另选文件名。')
  }
  await writeFile(destination, contents, { encoding: 'utf8', flag: 'wx' })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
