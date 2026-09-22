import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { UpdateChannel } from '../../shared/update-contracts'

const updatePreferencesSchema = z.object({
  schema: z.literal(1),
  candidateOptIn: z.boolean()
}).strict()

export interface UpdatePreferences {
  candidateOptIn: boolean
}

export interface UpdatePreferenceService {
  read(): Promise<UpdatePreferences>
  setCandidateOptIn(value: boolean): Promise<void>
}

export function updatePreferencesPath(userData: string): string {
  return join(userData, 'updates', 'preferences.json')
}

export function createUpdatePreferenceService(path: string): UpdatePreferenceService {
  return {
    read: () => readUpdatePreferences(path),
    setCandidateOptIn: (value) => writeCandidateOptIn(path, value)
  }
}

export async function readUpdatePreferences(path: string): Promise<UpdatePreferences> {
  const stored = await readStoredPreferences(path)
  if (stored.kind === 'valid') return stored.preferences
  if (stored.kind === 'invalid') await writeCandidateOptIn(path, false)
  return { candidateOptIn: false }
}

export async function writeCandidateOptIn(path: string, value: boolean): Promise<void> {
  await atomicWrite(path, `${JSON.stringify({ schema: 1, candidateOptIn: value })}\n`)
}

export async function migrateLegacyCandidatePreference(input: {
  path: string
  packagedChannel: UpdateChannel
  currentVersion: string
}): Promise<boolean> {
  const stored = await readStoredPreferences(input.path)
  if (stored.kind === 'valid') return stored.preferences.candidateOptIn
  if (stored.kind === 'invalid') {
    await writeCandidateOptIn(input.path, false)
    return false
  }

  const candidateOptIn = input.packagedChannel === 'candidate' &&
    input.currentVersion === '1.0.0-rc.18'
  if (candidateOptIn) await writeCandidateOptIn(input.path, true)
  return candidateOptIn
}

type StoredPreferences =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'valid'; preferences: UpdatePreferences }

async function readStoredPreferences(path: string): Promise<StoredPreferences> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return { kind: 'missing' }
    console.warn('[desktop] 无法读取更新偏好，已安全关闭内测更新。')
    return { kind: 'invalid' }
  }

  try {
    const parsed = updatePreferencesSchema.parse(JSON.parse(raw))
    return { kind: 'valid', preferences: { candidateOptIn: parsed.candidateOptIn } }
  } catch {
    console.warn('[desktop] 更新偏好无效，已安全关闭内测更新。')
    return { kind: 'invalid' }
  }
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
