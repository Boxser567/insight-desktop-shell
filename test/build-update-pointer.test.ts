import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []
const script = path.join(process.cwd(), 'scripts', 'build-update-pointer.mjs')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function paths() {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-update-pointer-'))
  temporaryDirectories.push(root)
  return {
    output: path.join(root, 'next.json'),
    current: path.join(root, 'current.json')
  }
}

function run(input: {
  output: string
  channel: string
  version: string
  current?: string
  extra?: string[]
}) {
  return spawnSync(process.execPath, [
    script,
    '--channel', input.channel,
    '--version', input.version,
    '--output', input.output,
    ...(input.current ? ['--current', input.current] : []),
    ...(input.extra ?? [])
  ], { encoding: 'utf8' })
}

describe('update channel pointer builder', () => {
  it('writes only the stable schema, channel, and version', async () => {
    const value = await paths()
    const result = run({ ...value, channel: 'stable', version: '0.1.2' })

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(await readFile(value.output, 'utf8'))).toEqual({
      schemaVersion: 1,
      channel: 'stable',
      version: '0.1.2'
    })
  })

  it('allows a missing current pointer for a first release', async () => {
    const value = await paths()
    const result = run({ ...value, channel: 'candidate', version: '0.1.2-rc.1' })

    expect(result.status, result.stderr).toBe(0)
  })

  it('requires a strictly newer version in the same channel', async () => {
    const value = await paths()
    await writeFile(value.current, JSON.stringify({
      schemaVersion: 1,
      channel: 'candidate',
      version: '0.1.2-rc.2'
    }))

    expect(run({ ...value, channel: 'candidate', version: '0.1.2-rc.3' }).status).toBe(0)
    expect(run({ ...value, channel: 'candidate', version: '0.1.2-rc.2' }).status).not.toBe(0)
    expect(run({ ...value, channel: 'candidate', version: '0.1.2-rc.1' }).status).not.toBe(0)
  })

  it('rejects channel/version mixing, unknown fields, and unknown arguments', async () => {
    const value = await paths()
    expect(run({ ...value, channel: 'stable', version: '0.1.2-rc.1' }).status).not.toBe(0)
    await writeFile(value.current, JSON.stringify({
      schemaVersion: 1,
      channel: 'stable',
      version: '0.1.1',
      url: 'https://attacker.example/update'
    }))
    expect(run({ ...value, channel: 'stable', version: '0.1.2' }).status).not.toBe(0)
    expect(run({
      ...value,
      channel: 'stable',
      version: '0.1.2',
      extra: ['--url', 'https://attacker.example']
    }).status).not.toBe(0)
  })
})
