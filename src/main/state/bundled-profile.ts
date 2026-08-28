import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { profilePackageJsonPath } from './plugin-recovery'
import { clearProfileInstallMarker, markProfileInstallComplete } from './profile-install-marker'
import { DESKTOP_INTEGRATION_PACKAGE } from './installation-owned-bundles'

const PROFILE = 'web'
const DEFAULT_PROFILE_VERSION = 3
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

async function copyDesktopIntegration(source: string, destination: string): Promise<void> {
  const relativePackage = join('packages', 'insight-desktop-integration')
  const sourcePackage = join(source, relativePackage)
  if (!existsSync(join(sourcePackage, 'package.json'))) {
    throw new Error('The bundled desktop integration package was not found.')
  }
  const destinationPackage = join(destination, relativePackage)
  await mkdir(dirname(destinationPackage), { recursive: true })
  await rm(destinationPackage, { recursive: true, force: true })
  await cp(sourcePackage, destinationPackage, { recursive: true, verbatimSymlinks: true })
}

async function ensureWorkspacePackagePattern(profileDirectory: string): Promise<void> {
  const path = join(profileDirectory, 'pnpm-workspace.yaml')
  let workspace: { packages?: unknown; [key: string]: unknown } = {}
  try {
    workspace = parse(await readFile(path, 'utf8')) as typeof workspace
  } catch {
    // A missing workspace file is repaired from the minimum required fields.
  }
  const packages = Array.isArray(workspace.packages)
    ? workspace.packages.filter((value): value is string => typeof value === 'string')
    : []
  if (!packages.includes('.')) packages.unshift('.')
  if (!packages.includes('packages/*')) packages.push('packages/*')
  workspace.packages = packages
  await writeFile(path, stringify(workspace), 'utf8')
}

async function addDesktopIntegrationToManifest(profileDirectory: string): Promise<void> {
  const manifestPath = join(profileDirectory, 'package.json')
  const manifest = await readProfileManifest(manifestPath)
  if (manifest === undefined) throw new Error('The web profile manifest could not be read.')
  manifest.dependencies ??= {}
  manifest.dependencies[DESKTOP_INTEGRATION_PACKAGE] = 'workspace:*'
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const bundles = manifest.dsh.profile.bundles ?? []
  if (!bundles.includes(DESKTOP_INTEGRATION_PACKAGE)) bundles.push(DESKTOP_INTEGRATION_PACKAGE)
  manifest.dsh.profile.bundles = bundles
  manifest.insightDesktop = { defaultProfileVersion: DEFAULT_PROFILE_VERSION }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
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
    await markProfileInstallComplete(dshHome)
    return true
  }

  if (current.insightDesktop?.defaultProfileVersion === 2) {
    await copyDesktopIntegration(source, destination)
    await addDesktopIntegrationToManifest(destination)
    await ensureWorkspacePackagePattern(destination)
    await clearProfileInstallMarker(dshHome)
    return true
  }

  if (current.insightDesktop?.defaultProfileVersion === DEFAULT_PROFILE_VERSION) {
    await copyDesktopIntegration(source, destination)
    await addDesktopIntegrationToManifest(destination)
    await ensureWorkspacePackagePattern(destination)
    return true
  }

  if (
    current.insightDesktop?.defaultProfileVersion !== DEFAULT_PROFILE_VERSION &&
    isLegacyDefaultProfile(current)
  ) {
    await copyProfile(source, destination)
    await markProfileInstallComplete(dshHome)
    return true
  }

  return false
}
