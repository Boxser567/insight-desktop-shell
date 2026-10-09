import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { historyExportText, readHistoryExport, saveHistoryExport, type HistoryDecoder } from '../src/main/session-history-export'

let root: string
const header = { type: 'session', version: 3, id: 'history', createdAt: 1 }
const message = { role: 'user', content: [{ type: 'text', text: '保存的历史问题' }] }
const event = { type: 'user/message', seq: 0, time: 2, data: message }
const jsonl = [header, event].map(row => JSON.stringify(row) + '\n').join('')
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'history-export-test-')) })
afterEach(async () => { await rm(root, { force: true, recursive: true }) })

describe('detached session history export', () => {
  it.each([false, true])('reads all frames without changing the selected log (compressed=%s)', async compressed => {
    const path = join(root, compressed ? 'session.v3.jsonl.zstd' : 'session.v3.jsonl')
    const bytes = compressed ? Buffer.concat(jsonl.split(/(?<=\n)/).filter(Boolean).map(line => zstdCompressSync(line))) : Buffer.from(jsonl)
    await writeFile(path, bytes)
    const history = await readHistoryExport(path)
    expect(history.rows).toEqual([event])
    expect(history.jsonl).toBe(jsonl)
    const decoder: HistoryDecoder = {
      createRestore(h, options) {
        expect(h).toEqual(header)
        expect(options).toEqual({ recovery: 'strict', validation: 'transformed' })
        return { decodeRow: row => { expect(row).toEqual(event) }, finish: () => ({ events: [event] }) }
      },
    }
    const text = historyExportText(history, decoder)
    expect(text).toContain('只读历史导出')
    expect(text).toContain('保存的历史问题')
    const destination = join(root, 'history-export.txt')
    await saveHistoryExport(path, destination, text)
    expect(await readFile(destination, 'utf8')).toBe(text)
    expect(await readFile(path)).toEqual(bytes)
  })

  it('refuses to replace a source generation, existing export, or symlink target', async () => {
    const source = join(root, 'session.v3.jsonl')
    await writeFile(source, jsonl)
    for (const destination of [source, join(root, 'session.v4.jsonl.zstd')]) {
      await expect(saveHistoryExport(source, destination, 'overwrite')).rejects.toThrow('不能覆盖')
    }
    const existing = join(root, 'existing.txt')
    await writeFile(existing, 'original')
    await expect(saveHistoryExport(source, existing, 'overwrite')).rejects.toMatchObject({ code: 'EEXIST' })
    // Windows symlink privileges are not available on all CI runners.
    if (process.platform !== 'win32') {
      const linked = join(root, 'linked.txt')
      await symlink(source, linked)
      await expect(saveHistoryExport(source, linked, 'overwrite')).rejects.toMatchObject({ code: 'EEXIST' })
    }
    expect(await readFile(source, 'utf8')).toBe(jsonl)
    expect(await readFile(existing, 'utf8')).toBe('original')
  })

  it.each([jsonl.trimEnd(), '{broken}\n', JSON.stringify({ ...header, version: 99 }) + '\n'])('refuses incomplete, malformed, or unsupported logs', async contents => {
    const source = join(root, 'session.jsonl')
    await writeFile(source, contents)
    await expect(readHistoryExport(source)).rejects.toThrow()
    expect(await readFile(source, 'utf8')).toBe(contents)
  })

  it('bounds both compressed input and total decompressed output', async () => {
    const source = join(root, 'session.v3.jsonl.zstd')
    await writeFile(source, '')
    await truncate(source, 32 * 1024 * 1024 + 1)
    await expect(readHistoryExport(source)).rejects.toThrow('32 MiB')
    const frame = zstdCompressSync(Buffer.alloc(17 * 1024 * 1024, 32))
    await writeFile(source, Buffer.concat([frame, frame]))
    await expect(readHistoryExport(source)).rejects.toThrow()
  })
})
