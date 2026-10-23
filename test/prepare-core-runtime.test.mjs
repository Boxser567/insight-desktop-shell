import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractRuntimeArchive,
  prepareLockedCoreRuntime,
  moveRuntimeDirectory,
  removeInvalidBundledNodeShim
} from '../scripts/prepare-core-runtime.mjs'

const directories = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function runtimeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'insight-core-runtime-test-'))
  directories.push(directory)
  const source = join(directory, 'source')
  const metadata = {
    schemaVersion: 1, core: { repository: 'Boxser567/insight-harness-core', version: '0.1.6-alpha.2', commit: 'a'.repeat(40) },
    entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js', node: { version: '24.9.0' }, pnpm: { version: '11.7.0' },
    target: { platform: process.platform, arch: process.arch }
  }
  for (const file of [metadata.entry, `node_modules/node/bin/${process.platform === 'win32' ? 'node.exe' : 'node'}`, 'node_modules/pnpm/bin/pnpm.cjs']) {
    const path = join(source, file)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'fixture')
  }
  await writeFile(join(source, 'runtime.json'), JSON.stringify(metadata))
  await promisify(execFile)('tar', ['-czf', 'runtime.tar.gz', '-C', source, '.'], { cwd: directory })
  const archive = await readFile(join(directory, 'runtime.tar.gz'))
  const runtime = { url: 'https://example.test/previous-runtime.tar.gz', sha256: createHash('sha256').update(archive).digest('hex'),
    core: metadata.core, node: metadata.node, pnpm: metadata.pnpm }
  const lock = join(directory, 'previous.lock.json')
  const lockValue = { schemaVersion: 1, releaseTag: 'old-runtime', targets: { [`${process.platform}-${process.arch}`]: runtime } }
  await writeFile(lock, JSON.stringify(lockValue))
  const destination = join(directory, 'previous')
  const fetch = vi.fn(async () => new Response(archive))
  vi.stubGlobal('fetch', fetch)
  const prepare = () => prepareLockedCoreRuntime({ runtimeLockPath: lock, destination })
  return { directory, source, metadata, archive, runtime, lock, lockValue, destination, fetch, prepare }
}

describe('Core Runtime preparation', () => {
  it('prepares a verified historical Runtime separately and preserves existing files on checksum failure', async () => {
    const fixture = await runtimeFixture()
    const { directory, destination, metadata, runtime, lock, lockValue, fetch, prepare } = fixture
    const current = join(directory, 'current/runtime.json')
    await mkdir(join(current, '..'), { recursive: true })
    await writeFile(current, 'keep-current-runtime')
    await prepare()
    expect(JSON.parse(await readFile(join(destination, 'runtime.json'), 'utf8'))).toEqual(metadata)
    expect(await readFile(current, 'utf8')).toBe('keep-current-runtime')
    runtime.sha256 = 'b'.repeat(64)
    await writeFile(lock, JSON.stringify(lockValue))
    fetch.mockImplementation(async () => new Response(Buffer.from('corrupt')))
    await expect(prepare()).rejects.toThrow('SHA-256')
    expect(JSON.parse(await readFile(join(destination, 'runtime.json'), 'utf8'))).toEqual(metadata)
  })

  it('reuses a matching verified Runtime without fetching and logs its URL and directory', async () => {
    const { destination, runtime, fetch, prepare } = await runtimeFixture()
    await prepare()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    fetch.mockClear()
    await prepare()
    expect(fetch).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(`Core Runtime URL: ${runtime.url}`)
    expect(log).toHaveBeenCalledWith(`Core Runtime directory: ${destination}`)
    expect(log).toHaveBeenCalledWith(`Using cached Core Runtime: ${process.platform}-${process.arch}`)
  })

  it.each(['core', 'node', 'pnpm', 'target', 'entry', 'invalid metadata', 'missing checksum', 'changed checksum'])(
    'downloads again when the cached Runtime has %s mismatch or damage', async (change) => {
      const { destination, metadata, fetch, prepare } = await runtimeFixture()
      await prepare()
      if (change === 'entry') await rm(join(destination, metadata.entry))
      else if (change === 'missing checksum') await rm(join(destination, '.archive-sha256'))
      else if (change === 'changed checksum') await writeFile(join(destination, '.archive-sha256'), 'b'.repeat(64))
      else {
        const invalid = structuredClone(metadata)
        if (change === 'core') invalid.core.commit = 'b'.repeat(40)
        if (change === 'node') invalid.node.version = '0.0.0'
        if (change === 'pnpm') invalid.pnpm.version = '0.0.0'
        if (change === 'target') invalid.target.arch = 'invalid'
        await writeFile(join(destination, 'runtime.json'), change === 'invalid metadata' ? '{' : JSON.stringify(invalid))
      }
      fetch.mockClear()
      await prepare()
      expect(fetch).toHaveBeenCalledOnce()
      expect(JSON.parse(await readFile(join(destination, 'runtime.json'), 'utf8'))).toEqual(metadata)
      expect(await readFile(join(destination, metadata.entry), 'utf8')).toBe('fixture')
    }
  )

  it.each([true, false])('reports streaming download progress with content length: %s', async (hasTotal) => {
    const { archive, fetch, prepare } = await runtimeFixture()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now += 1000)
    fetch.mockImplementation(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(archive.subarray(0, Math.floor(archive.length / 2)))
        controller.enqueue(archive.subarray(Math.floor(archive.length / 2)))
        controller.close()
      }
    }), { headers: hasTotal ? { 'content-length': String(archive.length) } : {} }))
    await prepare()
    const progress = write.mock.calls.map(([message]) => message).filter(message => message.startsWith('\rCore Runtime download:'))
    expect(progress.length).toBeGreaterThanOrEqual(3)
    expect(progress.every(message => !message.includes('\n'))).toBe(true)
    expect(write.mock.calls.filter(([message]) => message === '\n')).toHaveLength(1)
    expect(write).toHaveBeenLastCalledWith('\n')
    expect(log.mock.calls.some(([message]) => message.startsWith('Core Runtime download:'))).toBe(false)
    if (hasTotal) {
      expect(progress[0]).toContain('0%')
      expect(progress.some(message => /(?:49|50)%/.test(message))).toBe(true)
      expect(progress.at(-1)).toContain('100%')
    } else {
      expect(progress.every(message => message.endsWith('MiB') && !message.includes('%'))).toBe(true)
    }
  })

  it('preserves the existing Runtime when the download stream fails', async () => {
    const { source, destination, metadata, fetch, prepare } = await runtimeFixture()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await cp(source, destination, { recursive: true })
    fetch.mockImplementation(async () => ({ ok: true, headers: new Headers(), body: (async function* () {
      yield Buffer.from('partial archive')
      throw new Error('connection lost')
    })() }))
    await expect(prepare()).rejects.toThrow('connection lost')
    expect(write).toHaveBeenLastCalledWith('\n')
    expect(JSON.parse(await readFile(join(destination, 'runtime.json'), 'utf8'))).toEqual(metadata)
    expect(await readFile(join(destination, metadata.entry), 'utf8')).toBe('fixture')
  })

  it('extracts the actual tar archive without changing its content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'insight-core-runtime-test-'))
    directories.push(directory)
    const source = join(directory, 'source')
    const destination = join(directory, 'extracted')
    await mkdir(source)
    await mkdir(destination)
    await writeFile(join(source, 'runtime.json'), '{"core":"recovery-fixture"}\n')
    await promisify(execFile)('tar', ['-czf', 'runtime.tar.gz', '-C', source, '.'], { cwd: directory })
    await extractRuntimeArchive(join(directory, 'runtime.tar.gz'), destination)
    expect(await readFile(join(destination, 'runtime.json'), 'utf8')).toBe('{"core":"recovery-fixture"}\n')
  })

  it('extracts a local archive with a relative name so GNU tar never interprets a Windows drive as a host', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'insight-core-runtime-test-'))
    directories.push(directory)
    const archive = join(directory, 'runtime.tar.gz')
    const destination = join(directory, 'extracted')
    const calls = []
    await extractRuntimeArchive(archive, destination, async (...args) => { calls.push(args) })
    expect(calls).toEqual([['tar', ['-xzf', 'runtime.tar.gz', '-C', destination], directory]])
  })

  it('copies the Runtime when moving across volumes raises EXDEV', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'insight-core-runtime-test-'))
    directories.push(directory)
    const source = join(directory, 'source')
    const destination = join(directory, 'destination')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'runtime.json'), '{"schemaVersion":1}\n', 'utf8')

    await moveRuntimeDirectory(source, destination, {
      renameDirectory: async () => {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
      },
      copyDirectory: cp
    })

    await expect(readFile(join(destination, 'runtime.json'), 'utf8')).resolves.toBe('{"schemaVersion":1}\n')
  })

  it('removes host-bound Node shims while preserving a valid relative shim', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'insight-core-runtime-test-'))
    directories.push(directory)
    const bin = join(directory, 'node_modules', '.bin')
    const node = join(directory, 'node_modules', 'node', 'bin', 'node')
    await mkdir(bin, { recursive: true })
    await mkdir(join(directory, 'node_modules', 'node', 'bin'), { recursive: true })
    await writeFile(node, 'node')

    await symlink('/Users/runner/work/core/runtime/node', join(bin, 'node'))
    await expect(removeInvalidBundledNodeShim(directory, 'darwin')).resolves.toBe(true)
    await expect(readFile(join(bin, 'node'))).rejects.toMatchObject({ code: 'ENOENT' })

    await symlink('../node/bin/node', join(bin, 'node'))
    await expect(removeInvalidBundledNodeShim(directory, 'darwin')).resolves.toBe(false)
    await expect(readFile(join(bin, 'node'), 'utf8')).resolves.toBe('node')
  })
})
