import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { moveRuntimeDirectory } from '../scripts/prepare-core-runtime.mjs'

const directories = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Core Runtime preparation', () => {
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
})
