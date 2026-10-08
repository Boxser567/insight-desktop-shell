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
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Core Runtime preparation', () => {
  it('prepares a verified historical Runtime separately and leaves the current Runtime untouched', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'insight-core-runtime-test-'))
    directories.push(directory)
    const source = join(directory, 'source')
    const metadata = {
      schemaVersion: 1, core: { repository: 'Boxser567/insight-harness-core', version: '0.1.6-alpha.2', commit: 'a'.repeat(40) },
      entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js', node: { version: '24.9.0' }, pnpm: { version: '11.7.0' },
      target: { platform: process.platform, arch: process.arch }
    }
    for (const file of [metadata.entry, `node_modules/node/bin/${process.platform === 'win32' ? 'node.exe' : 'node'}`, 'node_modules/pnpm/bin/pnpm.cjs']) {
      const destination = join(source, file)
      await mkdir(join(destination, '..'), { recursive: true })
      await writeFile(destination, 'fixture')
    }
    await writeFile(join(source, 'runtime.json'), JSON.stringify(metadata))
    await promisify(execFile)('tar', ['-czf', 'runtime.tar.gz', '-C', source, '.'], { cwd: directory })
    const archive = await readFile(join(directory, 'runtime.tar.gz'))
    const lock = join(directory, 'previous.lock.json')
    await writeFile(lock, JSON.stringify({ schemaVersion: 1, releaseTag: 'old-runtime', targets: {
      [`${process.platform}-${process.arch}`]: { url: 'https://example.test/previous-runtime.tar.gz', sha256: createHash('sha256').update(archive).digest('hex'),
        core: metadata.core, node: metadata.node, pnpm: metadata.pnpm }
    } }))
    const current = join(directory, 'current/runtime.json')
    await mkdir(join(current, '..'), { recursive: true })
    await writeFile(current, 'keep-current-runtime')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(archive)))
    const destination = join(directory, 'previous')
    await prepareLockedCoreRuntime({ runtimeLockPath: lock, destination })
    expect(JSON.parse(await readFile(join(destination, 'runtime.json'), 'utf8'))).toEqual(metadata)
    expect(await readFile(current, 'utf8')).toBe('keep-current-runtime')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('corrupt'))))
    await expect(prepareLockedCoreRuntime({ runtimeLockPath: lock, destination })).rejects.toThrow('SHA-256')
    expect(JSON.parse(await readFile(join(destination, 'runtime.json'), 'utf8'))).toEqual(metadata)
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
