import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
// @ts-expect-error Packaging entry is JavaScript.
import { prepareInternalRuntime } from '../scripts/prepare-internal-runtime.mjs'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), 'insight-internal-test-'))
  directories.push(project)
  const source = join(project, 'source')
  const metadata = {
    schemaVersion: 1,
    core: { repository: 'Boxser567/insight-harness-core', version: '0.2.1-alpha.1', commit: 'a'.repeat(40) },
    target: { platform: process.platform, arch: process.arch }, node: { version: '24.9.0' }, pnpm: { version: '11.7.0' },
    entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js'
  }
  const input = 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/input.d.ts'
  for (const file of [input, metadata.entry, 'node_modules/pnpm/bin/pnpm.cjs', `node_modules/node/bin/${process.platform === 'win32' ? 'node.exe' : 'node'}`]) {
    await mkdir(join(source, file, '..'), { recursive: true })
    await writeFile(join(source, file), file === input ? 'toggleSkill(name: string): void;' : '')
  }
  await writeFile(join(source, 'runtime.json'), JSON.stringify(metadata))
  const target = `${process.platform}-${process.arch}`
  const archive = join(project, `insight-harness-runtime-${metadata.core.version}-${target}.tar.gz`)
  const packed = spawnSync('tar', ['-czf', archive, '-C', source, '.'], { encoding: 'utf8' })
  expect(packed.status, packed.stderr).toBe(0)
  const lock = {
    schemaVersion: 1, source: { repository: metadata.core.repository, workflowRun: 123 }, core: { ...metadata.core },
    targets: { [target]: { sha256: createHash('sha256').update(await readFile(archive)).digest('hex'), node: metadata.node, pnpm: metadata.pnpm } }
  }
  const lockPath = join(project, 'core-runtime.internal.lock.json')
  await writeFile(lockPath, JSON.stringify(lock))
  await mkdir(join(project, 'build/core-runtime'), { recursive: true })
  const sentinel = join(project, 'build/core-runtime/previous-runtime')
  await writeFile(sentinel, 'retain-on-rejection')
  await writeFile(join(project, 'core-runtime.lock.json'), 'public-lock-unchanged')
  return { project, metadata, target, archive, lock, lockPath, sentinel }
}

it('prepares verified bytes with the CI source identity and leaves the public release lock intact', async () => {
  const f = await fixture()
  expect(await prepareInternalRuntime(f.project, f.project)).toEqual(f.metadata)
  const manifest = JSON.parse(await readFile(join(f.project, 'build/runtime-manifest.json'), 'utf8'))
  expect(manifest.core).toEqual({ ...f.metadata.core, source: 'local', releaseTag: 'internal-run-123' })
  expect(manifest.checksums.archiveSha256).toBe(f.lock.targets[f.target]?.sha256)
  expect(await readFile(join(f.project, 'core-runtime.lock.json'), 'utf8')).toBe('public-lock-unchanged')
})

it('rejects corrupted archives before replacing the existing runtime cache', async () => {
  const f = await fixture()
  await writeFile(f.archive, 'corrupt')
  await expect(prepareInternalRuntime(f.project, f.project)).rejects.toThrow('SHA-256 mismatch')
  expect(await readFile(f.sentinel, 'utf8')).toBe('retain-on-rejection')
})

it('rejects a different Core commit even when the archive digest is correct', async () => {
  const f = await fixture()
  f.lock.core.commit = 'b'.repeat(40)
  await writeFile(f.lockPath, JSON.stringify(f.lock))
  await expect(prepareInternalRuntime(f.project, f.project)).rejects.toThrow('does not match the pinned Core')
  expect(await readFile(f.sentinel, 'utf8')).toBe('retain-on-rejection')
})
