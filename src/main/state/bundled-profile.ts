import { existsSync } from 'node:fs'
import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { profilePackageJsonPath } from './plugin-recovery'

const PROFILE = 'web'

/** Copy the packaged default web profile exactly once for a user data directory. */
export async function initializeBundledProfile(
  templateRoot: string,
  dshHome: string
): Promise<boolean> {
  const destinationManifest = profilePackageJsonPath(dshHome)
  if (existsSync(destinationManifest)) return false

  const source = join(templateRoot, PROFILE)
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error('The bundled web profile was not found.')
  }

  const destination = dirname(destinationManifest)
  const profilesDirectory = dirname(destination)
  await mkdir(profilesDirectory, { recursive: true })
  const staging = join(profilesDirectory, `.${PROFILE}-initializing-${randomUUID()}`)
  try {
    await cp(source, staging, { recursive: true, verbatimSymlinks: true })
    try {
      await rename(staging, destination)
      return true
    } catch (error) {
      if (existsSync(destinationManifest)) return false
      throw error
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
