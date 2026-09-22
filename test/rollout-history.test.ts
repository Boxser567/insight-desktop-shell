import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRolloutHistoryService } from '../src/main/update/rollout-history'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function historyFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'insight-rollout-history-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'updates', 'rollout-history.json')
  return { path, service: createRolloutHistoryService(path) }
}

describe('rollout history', () => {
  it('rejects a lower signed version after a newer pointer was verified', async () => {
    const { service } = await historyFixture()
    await service.assertAndRecord({
      track: 'stable',
      version: '1.0.2',
      state: 'active',
      envelopeBytes: Buffer.from('v1.0.2')
    })

    await expect(service.assertAndRecord({
      track: 'stable',
      version: '1.0.1',
      state: 'active',
      envelopeBytes: Buffer.from('v1.0.1')
    })).rejects.toThrow('拒绝可能的回放')
  })

  it('rejects different envelope bytes for the same pointer version', async () => {
    const { service } = await historyFixture()
    await service.assertAndRecord({
      track: 'candidate',
      target: 'darwin-arm64',
      version: '1.0.1',
      state: 'active',
      envelopeBytes: Buffer.from('first')
    })

    await expect(service.assertAndRecord({
      track: 'candidate',
      target: 'darwin-arm64',
      version: '1.0.1',
      state: 'active',
      envelopeBytes: Buffer.from('changed')
    })).rejects.toThrow('投放内容发生变化')
  })

  it('keeps Stable and per-target Candidate floors independent', async () => {
    const { service } = await historyFixture()
    await service.assertAndRecord({
      track: 'candidate',
      target: 'darwin-arm64',
      version: '1.0.2',
      state: 'active',
      envelopeBytes: Buffer.from('candidate')
    })

    await expect(service.assertAndRecord({
      track: 'stable',
      version: '1.0.1',
      state: 'active',
      envelopeBytes: Buffer.from('stable')
    })).resolves.toBeUndefined()
  })

  it('fails closed when the local history is malformed', async () => {
    const { path, service } = await historyFixture()
    await service.assertAndRecord({
      track: 'stable',
      version: '1.0.1',
      state: 'active',
      envelopeBytes: Buffer.from('valid')
    })
    await writeFile(path, '{"schema":1,"pointers":{"stable":{"version":"invalid"}}}')

    await expect(service.assertAndRecord({
      track: 'stable',
      version: '1.0.1',
      state: 'active',
      envelopeBytes: Buffer.from('stable')
    })).rejects.toBeDefined()
  })

  it('allows a same-version signed rejection and rejects reactivation', async () => {
    const { service } = await historyFixture()
    await service.assertAndRecord({
      track: 'candidate',
      target: 'darwin-arm64',
      version: '1.0.1',
      state: 'active',
      envelopeBytes: Buffer.from('active')
    })
    await expect(service.assertAndRecord({
      track: 'candidate',
      target: 'darwin-arm64',
      version: '1.0.1',
      state: 'rejected',
      envelopeBytes: Buffer.from('rejected')
    })).resolves.toBeUndefined()
    await expect(service.assertAndRecord({
      track: 'candidate',
      target: 'darwin-arm64',
      version: '1.0.1',
      state: 'active',
      envelopeBytes: Buffer.from('active')
    })).rejects.toThrow('不能重新激活')
  })

  it('reports whether a pointer identity has been observed', async () => {
    const { service } = await historyFixture()
    await expect(service.hasSeen({ track: 'stable' })).resolves.toBe(false)
    await service.assertAndRecord({
      track: 'stable',
      version: '1.0.1',
      state: 'active',
      envelopeBytes: Buffer.from('stable')
    })
    await expect(service.hasSeen({ track: 'stable' })).resolves.toBe(true)
  })
})
