import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { profilePackageJsonPath } from './plugin-recovery'
import { clearProfileInstallMarker, markProfileInstallComplete } from './profile-install-marker'
import { DESKTOP_INTEGRATION_PACKAGE } from './installation-owned-bundles'

const PROFILE = 'web'
const DEFAULT_PROFILE_VERSION = 4
const PRE_MARKET_PROFILE_VERSION = 3
const CORE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const SIDEBAR_PACKAGE = 'dsh-better-sidebar'
const SIDEBAR_VERSION = '0.16.1'
const MARKET_PACKAGE = 'dshmarket'
const MARKET_VERSION = '1.44.0'
const MARKET_UNINSTALLED_MARKER = '.insight-market-uninstalled'
const MARKET_POLICY_FILES = [
  {
    path: join('lib', 'patch.js'),
    markers: [
      '// Insight Desktop required capabilities.',
      '/^dshmarket$/u'
    ]
  },
  {
    path: join('lib', 'routes.js'),
    markers: [
      '// Insight Desktop hides required capabilities from market installed.',
      '// Insight Desktop hides required capabilities from market updates.',
      '// Insight Desktop protects required capabilities from market update.',
      '// Insight Desktop protects required capabilities from market uninstall.',
      '// Insight Desktop reports every market mutation as restart-blocking.',
      '// Insight Desktop records an explicit market uninstall.',
      '// Insight Desktop owns the bundled market version.'
    ]
  },
  {
    path: join('client', 'client.js'),
    markers: [
      '// Insight Desktop exposes the shell restart capability.',
      '// Insight Desktop delegates Harness restarts to the desktop shell (v2).'
    ]
  }
] as const

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
  insightDesktop?: { defaultProfileVersion?: number }
}

interface PackageManifest {
  version?: string
}

async function readProfileManifest(path: string): Promise<ProfileManifest | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ProfileManifest
  } catch {
    return undefined
  }
}

async function readPackageManifest(path: string): Promise<PackageManifest | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
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

async function isUncustomizedPreMarketProfile(
  manifest: ProfileManifest,
  profileDirectory: string
): Promise<boolean> {
  if (manifest.insightDesktop?.defaultProfileVersion !== PRE_MARKET_PROFILE_VERSION) return false
  if (
    existsSync(join(profileDirectory, '.dsh-market')) ||
    existsSync(join(profileDirectory, '.insight-bundled-plugins')) ||
    existsSync(join(profileDirectory, MARKET_UNINSTALLED_MARKER))
  ) return false

  const dependencies = manifest.dependencies ?? {}
  const expectedDependencies: Record<string, string> = {
    [SIDEBAR_PACKAGE]: SIDEBAR_VERSION,
    [DESKTOP_INTEGRATION_PACKAGE]: 'workspace:*'
  }
  const dependencyNames = Object.keys(dependencies)
  if (
    dependencyNames.length !== Object.keys(expectedDependencies).length ||
    dependencyNames.some(name => dependencies[name] !== expectedDependencies[name])
  ) return false

  const bundles = manifest.dsh?.profile?.bundles ?? []
  const expectedBundles = [...CORE_BUNDLES, SIDEBAR_PACKAGE, DESKTOP_INTEGRATION_PACKAGE]
  if (
    bundles.length !== expectedBundles.length ||
    expectedBundles.some(bundle => !bundles.includes(bundle))
  ) return false

  try {
    const patch = parse(await readFile(join(profileDirectory, 'cordis.patch.yml'), 'utf8'))
    return Array.isArray(patch) && patch.length === 0
  } catch {
    return false
  }
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

async function restoreBundledPackage(
  source: string,
  destination: string,
  packageName: string,
  expectedVersion: string
): Promise<boolean> {
  const sourcePackage = join(source, 'node_modules', packageName)
  const destinationPackage = join(destination, 'node_modules', packageName)
  const sourceManifest = await readPackageManifest(join(sourcePackage, 'package.json'))
  if (sourceManifest?.version !== expectedVersion) {
    throw new Error(`The bundled ${packageName} package does not match ${expectedVersion}.`)
  }
  const destinationManifest = await readPackageManifest(join(destinationPackage, 'package.json'))
  if (destinationManifest?.version === expectedVersion) return false

  await mkdir(dirname(destinationPackage), { recursive: true })
  await rm(destinationPackage, { recursive: true, force: true })
  await cp(sourcePackage, destinationPackage, { recursive: true, verbatimSymlinks: true })
  return true
}

async function refreshBundledMarketPolicy(source: string, destination: string): Promise<void> {
  const sourcePackage = join(source, 'node_modules', MARKET_PACKAGE)
  const destinationPackage = join(destination, 'node_modules', MARKET_PACKAGE)
  const destinationManifest = await readPackageManifest(join(destinationPackage, 'package.json'))
  if (destinationManifest === undefined) return

  const sourceManifest = await readPackageManifest(join(sourcePackage, 'package.json'))
  if (
    sourceManifest?.version === undefined ||
    sourceManifest.version !== destinationManifest.version
  ) return

  for (const policyFile of MARKET_POLICY_FILES) {
    const content = await readFile(join(sourcePackage, policyFile.path), 'utf8')
    if (policyFile.markers.some(marker => !content.includes(marker))) {
      throw new Error(`The bundled market policy is incomplete: ${policyFile.path}`)
    }
    const destinationPath = join(destinationPackage, policyFile.path)
    await mkdir(dirname(destinationPath), { recursive: true })
    await writeFile(destinationPath, content, 'utf8')
  }
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

async function restoreManagedProfileManifest(profileDirectory: string): Promise<boolean> {
  const manifestPath = join(profileDirectory, 'package.json')
  const manifest = await readProfileManifest(manifestPath)
  if (manifest === undefined) throw new Error('The web profile manifest could not be read.')
  manifest.dependencies ??= {}
  let changed = false
  for (const [name, version] of [
    [SIDEBAR_PACKAGE, SIDEBAR_VERSION],
    [MARKET_PACKAGE, MARKET_VERSION],
    [DESKTOP_INTEGRATION_PACKAGE, 'workspace:*']
  ] as const) {
    if (manifest.dependencies[name] === version) continue
    manifest.dependencies[name] = version
    changed = true
  }
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const managed = new Set([SIDEBAR_PACKAGE, MARKET_PACKAGE, DESKTOP_INTEGRATION_PACKAGE])
  const remaining = (manifest.dsh.profile.bundles ?? []).filter(bundle => !managed.has(bundle))
  const coreEnd = remaining.reduce(
    (end, bundle, index) => CORE_BUNDLES.includes(bundle) ? index + 1 : end,
    0
  )
  const bundles = [
    ...remaining.slice(0, coreEnd),
    SIDEBAR_PACKAGE,
    MARKET_PACKAGE,
    ...remaining.slice(coreEnd),
    DESKTOP_INTEGRATION_PACKAGE
  ]
  if (JSON.stringify(manifest.dsh.profile.bundles ?? []) !== JSON.stringify(bundles)) {
    manifest.dsh.profile.bundles = bundles
    changed = true
  }
  if (manifest.insightDesktop?.defaultProfileVersion !== DEFAULT_PROFILE_VERSION) changed = true
  manifest.insightDesktop = {
    ...manifest.insightDesktop,
    defaultProfileVersion: DEFAULT_PROFILE_VERSION
  }
  if (!changed) return false
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return true
}

async function restoreManagedProfile(
  source: string,
  destination: string,
  dshHome: string,
  forceInstall: boolean
): Promise<void> {
  await copyDesktopIntegration(source, destination)
  const sidebarRestored = await restoreBundledPackage(
    source,
    destination,
    SIDEBAR_PACKAGE,
    SIDEBAR_VERSION
  )
  const marketRestored = await restoreBundledPackage(
    source,
    destination,
    MARKET_PACKAGE,
    MARKET_VERSION
  )
  const manifestRestored = await restoreManagedProfileManifest(destination)
  await ensureWorkspacePackagePattern(destination)
  await refreshBundledMarketPolicy(source, destination)
  if (forceInstall || sidebarRestored || marketRestored || manifestRestored) {
    await clearProfileInstallMarker(dshHome)
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
    await markProfileInstallComplete(dshHome)
    return true
  }

  if (await isUncustomizedPreMarketProfile(current, destination)) {
    await copyProfile(source, destination)
    await markProfileInstallComplete(dshHome)
    return true
  }

  if (current.insightDesktop?.defaultProfileVersion === 2) {
    await restoreManagedProfile(source, destination, dshHome, true)
    return true
  }

  if (current.insightDesktop?.defaultProfileVersion === PRE_MARKET_PROFILE_VERSION) {
    await restoreManagedProfile(source, destination, dshHome, false)
    return true
  }

  if (current.insightDesktop?.defaultProfileVersion === DEFAULT_PROFILE_VERSION) {
    await restoreManagedProfile(source, destination, dshHome, false)
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
