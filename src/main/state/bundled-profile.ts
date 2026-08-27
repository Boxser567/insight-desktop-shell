import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { profilePackageJsonPath } from './plugin-recovery'

const PROFILE = 'web'
const DEFAULT_PROFILE_VERSION = 2
const CORE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
  insightDesktop?: { defaultProfileVersion?: number }
}

async function readProfileManifest(path: string): Promise<ProfileManifest | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ProfileManifest
  } catch {
    return undefined
  }
}

function isLegacyDefaultProfile(manifest: ProfileManifest): boolean {
  const bundles = manifest.dsh?.profile?.bundles ?? []
  return Object.keys(manifest.dependencies ?? {}).length === 0 &&
    bundles.length === CORE_BUNDLES.length &&
    CORE_BUNDLES.every(bundle => bundles.includes(bundle))
}

async function copyProfile(source: string, destination: string): Promise<void> {
  const profilesDirectory = dirname(destination)
  await mkdir(profilesDirectory, { recursive: true })
  const staging = join(profilesDirectory, `.${PROFILE}-initializing-${randomUUID()}`)
  try {
    await cp(source, staging, { recursive: true, verbatimSymlinks: true })
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Copy the packaged default web profile exactly once for a user data directory. */
export async function initializeBundledProfile(
  templateRoot: string,
  dshHome: string
): Promise<boolean> {
  const destinationManifest = profilePackageJsonPath(dshHome)
  const source = join(templateRoot, PROFILE)
  const sourceManifest = await readProfileManifest(join(source, 'package.json'))
  if (sourceManifest === undefined) {
    throw new Error('The bundled web profile was not found.')
  }

  const destination = dirname(destinationManifest)
  const current = await readProfileManifest(destinationManifest)
  if (current === undefined) {
    await copyProfile(source, destination)
    return true
  }

  if (
    current.insightDesktop?.defaultProfileVersion !== DEFAULT_PROFILE_VERSION &&
    isLegacyDefaultProfile(current)
  ) {
    await copyProfile(source, destination)
    return true
  }

  return false
}
