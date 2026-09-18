import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
// @ts-expect-error Build entry is JavaScript.
import { inspectLocalRuntime } from '../scripts/dev-local.mjs'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'insight-local-runtime-test-'))
  directories.push(root)
  const metadata = {
    schemaVersion: 1, core: { repository: 'test/core', version: '0.1.5', commit: 'a'.repeat(40) },
    target: { platform: process.platform, arch: process.arch }, node: { version: '24.9.0' },
    entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js'
  }
  const input = 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/input.d.ts'
  for (const file of [input, metadata.entry, 'node_modules/pnpm/bin/pnpm.cjs', `node_modules/node/bin/${process.platform === 'win32' ? 'node.exe' : 'node'}`]) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), file === input ? 'setSelectedSkills(names: readonly string[]): void;' : '')
  }
  await writeFile(join(root, 'runtime.json'), JSON.stringify(metadata))
  return { root, metadata, input }
}

it('accepts this host Runtime with the required input API', async () => {
  const { root, metadata } = await fixture()
  expect(await inspectLocalRuntime(root)).toEqual(metadata)
})

it('rejects an old Runtime before replacing the development cache', async () => {
  const { root, input } = await fixture()
  await writeFile(join(root, input), '')
  await expect(inspectLocalRuntime(root)).rejects.toThrow('lacks setSelectedSkills')
})

it('rejects a Runtime assembled for another platform', async () => {
  const { root, metadata } = await fixture()
  metadata.target.arch = process.arch === 'arm64' ? 'x64' : 'arm64'
  await writeFile(join(root, 'runtime.json'), JSON.stringify(metadata))
  await expect(inspectLocalRuntime(root)).rejects.toThrow('different platform')
})
