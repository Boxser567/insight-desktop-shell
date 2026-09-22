import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import semver from 'semver'
import { z } from 'zod'

const candidateInstallSchema = z.object({
  schema: z.literal(1),
  version: z.string()
}).strict()

export function candidateInstallPath(userData: string): string {
  return join(userData, 'updates', 'candidate-install.json')
}

export async function readCandidateInstall(path: string): Promise<string | undefined> {
  try {
    const value = candidateInstallSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    if (semver.valid(value.version) !== value.version) throw new Error('Invalid semver')
    return value.version
  } catch (error) {
    if (isMissingFile(error)) return undefined
    await rm(path, { force: true }).catch(() => undefined)
    return undefined
  }
}

export async function writeCandidateInstall(path: string, version: string): Promise<void> {
  if (semver.valid(version) !== version) throw new Error('Candidate 安装版本无效。')
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ schema: 1, version })}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function clearCandidateInstall(path: string): Promise<void> {
  await rm(path, { force: true })
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
