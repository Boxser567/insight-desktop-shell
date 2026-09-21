import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { profilePackageJsonPath, pluginDeclaredEntryIds } from './plugin-recovery'
import { prunePatchLayer } from './patch-layer'
import { removeTree } from './remove-tree'
import { clearProfileInstallMarker, markProfileInstallComplete } from './profile-install-marker'
import { DESKTOP_INTEGRATION_PACKAGE } from './installation-owned-bundles'

const PROFILE = 'web'
const DEFAULT_PROFILE_VERSION = 8
const PRE_MARKET_PROFILE_VERSION = 3
const CORE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const SIDEBAR_PACKAGE = 'dsh-better-sidebar'
const MARKET_UNINSTALLED_MARKER = '.insight-market-uninstalled'
const RETIRED_MARKET_PACKAGE = 'dshmarket'
const RETIRED_GENUI_PACKAGE = '@changfenhuang/dsh-genui'
const RETIRED_PACKAGES = [RETIRED_MARKET_PACKAGE, RETIRED_GENUI_PACKAGE, 'dsh-genui']
const COMMUNITY_PLUGIN_SPECS = {
  memory: {
    packageName: 'dsh-memory-evolve',
    current: 'file:.insight-bundled-plugins/dsh-memory-evolve-0.1.0.tgz',
    managedVersions: ['0.1.0']
  },
  prompt: {
    packageName: 'dsh-prompt-enhance',
    current: 'file:.insight-bundled-plugins/dsh-prompt-enhance-0.2.1.tgz',
    legacy: 'file:.insight-bundled-plugins/dsh-prompt-enhance-0.1.9.tgz',
    managedVersions: ['0.1.9', '0.2.1']
  }
} as const

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
    [SIDEBAR_PACKAGE]: '0.16.1',
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
  await removeTree(destinationPackage)
  await cp(sourcePackage, destinationPackage, { recursive: true, verbatimSymlinks: true })
}

export async function refreshPromptEnhanceCompatibility(source: string, destination: string): Promise<void> {
  const packagePath = join('node_modules', 'dsh-prompt-enhance')
  const installed = await readPackageManifest(join(destination, packagePath, 'package.json'))
  // Optional plugins stay removed, and user-upgraded versions retain their own client.
  if (
    installed?.version === undefined ||
    !(COMMUNITY_PLUGIN_SPECS.prompt.managedVersions as readonly string[]).includes(installed.version)
  ) return
  const bundled = await readPackageManifest(join(source, packagePath, 'package.json'))
  if (bundled?.version !== '0.2.1') throw new Error('The bundled prompt-enhance compatibility version is invalid.')
  const clientPath = join(packagePath, 'lib', 'client.js')
  const client = await readFile(join(source, clientPath), 'utf8')
  if (
    !client.includes('const imageCount = useInput((state) => state.attachmentIds.length);') ||
    !client.includes('body:not([data-ds-dark-theme]) .dsh-pe-panel')
  ) {
    throw new Error('The bundled prompt-enhance composer compatibility patch is missing.')
  }
  await mkdir(dirname(join(destination, clientPath)), { recursive: true })
  await writeFile(join(destination, clientPath), client, 'utf8')
}

async function refreshBundledCommunityPackages(
  source: string,
  destination: string,
  refreshSameVersion = false
): Promise<boolean> {
  let changed = false
  for (const plugin of [COMMUNITY_PLUGIN_SPECS.memory, COMMUNITY_PLUGIN_SPECS.prompt]) {
    const packagePath = join('node_modules', plugin.packageName)
    const installed = await readPackageManifest(join(destination, packagePath, 'package.json'))
    if (
      installed?.version === undefined ||
      !(plugin.managedVersions as readonly string[]).includes(installed.version)
    ) continue
    const bundled = await readPackageManifest(join(source, packagePath, 'package.json'))
    if (!bundled?.version || !existsSync(join(source, packagePath))) {
      throw new Error(`The bundled ${plugin.packageName} package was not found.`)
    }
    if (
      installed.version !== bundled.version ||
      (refreshSameVersion && plugin.packageName === COMMUNITY_PLUGIN_SPECS.memory.packageName)
    ) {
      await removeTree(join(destination, packagePath))
      await mkdir(dirname(join(destination, packagePath)), { recursive: true })
      await cp(join(source, packagePath), join(destination, packagePath), {
        recursive: true,
        verbatimSymlinks: true
      })
      changed = true
    }
  }
  await refreshPromptEnhanceCompatibility(source, destination)
  return changed
}

async function refreshBundledCommunityArchives(source: string, destination: string): Promise<boolean> {
  const manifest = await readProfileManifest(join(destination, 'package.json'))
  const archiveDirectory = join(destination, '.insight-bundled-plugins')
  let changed = false

  for (const plugin of [COMMUNITY_PLUGIN_SPECS.memory, COMMUNITY_PLUGIN_SPECS.prompt]) {
    const packagePath = join('node_modules', plugin.packageName)
    const installed = await readPackageManifest(join(destination, packagePath, 'package.json'))
    const dependency = manifest?.dependencies?.[plugin.packageName]
    const managed = (installed?.version !== undefined &&
      (plugin.managedVersions as readonly string[]).includes(installed.version)) ||
      dependency === plugin.current ||
      ('legacy' in plugin && dependency === plugin.legacy)
    if (!managed) continue

    const archiveName = basename(plugin.current)
    const sourceArchive = join(source, '.insight-bundled-plugins', archiveName)
    const destinationArchive = join(archiveDirectory, archiveName)
    if (!existsSync(sourceArchive)) {
      throw new Error(`The bundled archive for ${plugin.packageName} was not found.`)
    }
    const sourceContents = await readFile(sourceArchive)
    let archiveNeedsRefresh = true
    try {
      archiveNeedsRefresh = !sourceContents.equals(await readFile(destinationArchive))
    } catch {
      // A missing or unreadable archive is repaired from the shipped copy.
    }
    if (archiveNeedsRefresh) {
      await mkdir(archiveDirectory, { recursive: true })
      await cp(sourceArchive, destinationArchive)
      changed = true
    }
  }

  return changed
}

async function removeRetiredBundledPackages(destination: string): Promise<void> {
  for (const name of RETIRED_PACKAGES) {
    await removeTree(join(destination, 'node_modules', name))
  }
  const archives = join(destination, '.insight-bundled-plugins')
  if (!existsSync(archives)) return
  for (const name of await readdir(archives)) {
    if (/^(?:changfenhuang-dsh-genui|dsh-genui|dshmarket)-.*\.tgz$/u.test(name)) {
      await rm(join(archives, name), { force: true })
    }
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
  if (SIDEBAR_PACKAGE in manifest.dependencies) {
    delete manifest.dependencies[SIDEBAR_PACKAGE]
    changed = true
  }
  for (const name of RETIRED_PACKAGES) {
    if (name in manifest.dependencies) {
      delete manifest.dependencies[name]
      changed = true
    }
  }
  const promptDependency = manifest.dependencies[COMMUNITY_PLUGIN_SPECS.prompt.packageName]
  if (promptDependency === COMMUNITY_PLUGIN_SPECS.prompt.legacy) {
    manifest.dependencies[COMMUNITY_PLUGIN_SPECS.prompt.packageName] = COMMUNITY_PLUGIN_SPECS.prompt.current
    changed = true
  }
  if (manifest.dependencies[DESKTOP_INTEGRATION_PACKAGE] !== 'workspace:*') {
    manifest.dependencies[DESKTOP_INTEGRATION_PACKAGE] = 'workspace:*'
    changed = true
  }
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const remaining = (manifest.dsh.profile.bundles ?? []).filter(bundle =>
    bundle !== SIDEBAR_PACKAGE &&
    !RETIRED_PACKAGES.includes(bundle) &&
    bundle !== DESKTOP_INTEGRATION_PACKAGE
  )
  const bundles = [
    ...remaining,
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
  forceInstall: boolean,
  refreshSameVersion = false
): Promise<void> {
  const manifest = await readProfileManifest(join(destination, 'package.json'))
  const needsRetirement = manifest?.insightDesktop?.defaultProfileVersion !== DEFAULT_PROFILE_VERSION ||
    RETIRED_PACKAGES.some(name => name in (manifest?.dependencies ?? {}) ||
      manifest?.dsh?.profile?.bundles?.includes(name))
  if (needsRetirement) {
    // Invalidate before mutating: an interrupted migration must reinstall on retry.
    await clearProfileInstallMarker(dshHome)
    await rm(join(destination, 'pnpm-lock.yaml'), { force: true })
    await rm(join(destination, 'node_modules', '.pnpm', 'lock.yaml'), { force: true })
  }
  for (const name of RETIRED_PACKAGES) {
    const entryIds = await pluginDeclaredEntryIds(destination, name)
    for (const path of [join(destination, 'cordis.patch.yml'), join(dshHome, 'cordis.patch.yml')]) {
      if (!existsSync(path)) continue
      const text = await readFile(path, 'utf8')
      const pruned = prunePatchLayer(text, name, entryIds)
      if (pruned.removed.length > 0) {
        await clearProfileInstallMarker(dshHome)
        await writeFile(path, pruned.text, 'utf8')
      }
    }
  }
  await copyDesktopIntegration(source, destination)
  // Retire the installation-owned sidebar; the Core web app supplies the native UI.
  await removeTree(join(destination, 'node_modules', SIDEBAR_PACKAGE))
  await removeRetiredBundledPackages(destination)
  const communityPackagesRestored = await refreshBundledCommunityPackages(source, destination, refreshSameVersion)
  const communityArchivesRestored = await refreshBundledCommunityArchives(source, destination)
  const manifestRestored = await restoreManagedProfileManifest(destination)
  await ensureWorkspacePackagePattern(destination)
  if (forceInstall || communityPackagesRestored || communityArchivesRestored || manifestRestored) {
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
    await restoreManagedProfile(source, destination, dshHome, true, true)
    return true
  }

  if (current.insightDesktop?.defaultProfileVersion === PRE_MARKET_PROFILE_VERSION) {
    await restoreManagedProfile(source, destination, dshHome, false, true)
    return true
  }

  if ([4, 5, 6, 7, DEFAULT_PROFILE_VERSION].includes(current.insightDesktop?.defaultProfileVersion ?? 0)) {
    await restoreManagedProfile(
      source,
      destination,
      dshHome,
      false,
      current.insightDesktop?.defaultProfileVersion !== DEFAULT_PROFILE_VERSION
    )
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
