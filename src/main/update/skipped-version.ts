import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import semver from 'semver'
import { z } from 'zod'

const skippedVersionSchema = z.object({
  schema: z.literal(1),
  version: z.string()
}).strict()

export function skippedVersionPath(userData: string): string {
  return join(userData, 'updates', 'skipped-version.json')
}

export async function readSkippedVersion(path: string): Promise<string | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return undefined
    await rm(path, { force: true }).catch(() => undefined)
    return undefined
  }

  try {
    const parsed = skippedVersionSchema.parse(JSON.parse(raw))
    if (semver.valid(parsed.version) !== parsed.version) throw new Error('Invalid semver')
    return parsed.version
  } catch {
    await rm(path, { force: true }).catch(() => undefined)
    return undefined
  }
}

export async function writeSkippedVersion(path: string, version: string): Promise<void> {
  if (semver.valid(version) !== version) {
    throw new Error('跳过版本必须是合法语义版本。')
  }
  await atomicWrite(path, `${JSON.stringify({ schema: 1, version })}\n`)
}

export async function clearSkippedVersion(path: string): Promise<void> {
  await rm(path, { force: true })
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
