import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import semver from 'semver'
import { z } from 'zod'
import type { UpdateTargetId, UpdateTrack } from '../../shared/update-contracts'

const historyEntrySchema = z.object({
  version: z.string(),
  envelopeSha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u),
  state: z.enum(['active', 'rejected']).default('active')
}).strict()

const rolloutHistorySchema = z.object({
  schema: z.literal(1),
  pointers: z.record(z.string(), historyEntrySchema)
}).strict()

type RolloutHistory = z.infer<typeof rolloutHistorySchema>

export interface RolloutHistoryService {
  hasSeen(input: {
    track: UpdateTrack
    target?: UpdateTargetId
  }): Promise<boolean>
  assertAndRecord(input: {
    track: UpdateTrack
    target?: UpdateTargetId
    version: string
    state: 'active' | 'rejected'
    envelopeBytes: Uint8Array
  }): Promise<void>
}

export function rolloutHistoryPath(userData: string): string {
  return join(userData, 'updates', 'rollout-history.json')
}

export function createRolloutHistoryService(path: string): RolloutHistoryService {
  return {
    async hasSeen(input) {
      const history = await readHistory(path)
      return history.pointers[pointerKey(input.track, input.target)] !== undefined
    },
    async assertAndRecord(input) {
      const key = pointerKey(input.track, input.target)
      const next = {
        version: input.version,
        envelopeSha512: createHash('sha512').update(input.envelopeBytes).digest('base64'),
        state: input.state
      }
      const history = await readHistory(path)
      const current = history.pointers[key]
      if (current && semver.gt(current.version, next.version)) {
        throw new Error('更新投放版本低于此设备已验证的版本，已拒绝可能的回放。')
      }
      if (current?.version === next.version) {
        if (current.state === 'rejected' && next.state === 'active') {
          throw new Error('已撤回的更新版本不能重新激活。')
        }
        if (current.state === 'active' && next.state === 'rejected') {
          history.pointers[key] = next
          await atomicWrite(path, `${JSON.stringify(history)}\n`)
          return
        }
        if (current.envelopeSha512 !== next.envelopeSha512) {
          throw new Error('同一更新版本的投放内容发生变化，已拒绝不一致的指针。')
        }
        return
      }
      history.pointers[key] = next
      await atomicWrite(path, `${JSON.stringify(history)}\n`)
    }
  }
}

function pointerKey(track: UpdateTrack, target?: UpdateTargetId): string {
  if (track === 'stable') {
    if (target !== undefined) throw new Error('Stable 投放记录不能指定目标。')
    return 'stable'
  }
  if (!target) throw new Error('Candidate 投放记录必须指定目标。')
  return `candidate/${target}`
}

async function readHistory(path: string): Promise<RolloutHistory> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return { schema: 1, pointers: {} }
    throw error
  }
  const history = rolloutHistorySchema.parse(JSON.parse(raw))
  for (const entry of Object.values(history.pointers)) {
    if (semver.valid(entry.version) !== entry.version) {
      throw new Error('本地更新投放记录无效。')
    }
  }
  return history
}

async function atomicWrite(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temporaryPath, value, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
