import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { createRequire, isBuiltin } from 'node:module'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { profilePackageJsonPath } from './plugin-recovery'
import { hasProfile } from './profile-repair'

interface DependencyManifest {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}
interface InstalledDependency { directory: string; manifest: DependencyManifest }

async function installedDependency(anchor: string, name: string): Promise<InstalledDependency | undefined> {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(name)) return undefined
  for (const modules of createRequire(anchor).resolve.paths(name) ?? []) {
    try {
      const directory = await realpath(join(modules, name))
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as DependencyManifest
      if (manifest.name === name) return { directory, manifest }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return undefined
}

/**
 * A skipped legacy plugin can leave hoisted Core dependencies shadowing the
 * installation's own services. Move only copies owned exclusively by blocked
 * bundles out of resolution, while stopped. Keep recoverable bytes and all
 * declarations; never upgrade a plugin or grant a compatibility exemption.
 */
export async function quarantineBlockedRuntimeDependencies(options: {
  dshHome: string
  runtimeRoot: string
  note: (line: string) => void
}): Promise<string[]> {
  const manifestPath = profilePackageJsonPath(options.dshHome)
  if (!hasProfile(options.dshHome)) return []
  const profile = dirname(manifestPath)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DependencyManifest
  const installation = await realpath(options.runtimeRoot)
  const anchor = join(installation, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const runtimeRequire = createRequire(anchor)
  const boot = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-app-boot')).href) as {
    evaluatePluginCompatibility(manifest: object, exemptions: Record<string, string[]>): { exempted: boolean } | undefined
    readProfileVersionExemptions(profile: string): Record<string, string[]>
  }
  const exemptions = boot.readProfileVersionExemptions(profile)
  const roots = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })
  const installedRoots: { name: string; root: InstalledDependency; blocked: boolean }[] = []
  let complete = true
  for (const name of roots) {
    const root = await installedDependency(manifestPath, name)
    if (!root) { options.note(`[desktop] unresolved profile package: ${name}`); complete = false; continue }
    const issue = boot.evaluatePluginCompatibility(root.manifest, exemptions)
    const blocked = !!manifest.dsh?.profile?.bundles?.includes(name) && !!issue && !issue.exempted
    installedRoots.push({ name, root, blocked })
  }
  if (!complete || !installedRoots.some(root => root.blocked)) return []
  const protectedNames = new Set(roots)
  const ownership = new Map<string, { dependency: InstalledDependency; owners: Set<string>; blocked: boolean }>()
  for (const { name, root, blocked } of installedRoots) {
    const pending = [root]
    const seen = new Set<string>()
    while (pending.length) {
      const current = pending.pop()!
      if (seen.has(current.directory)) continue
      seen.add(current.directory)
      for (const dependencyName of Object.keys({ ...current.manifest.dependencies, ...current.manifest.optionalDependencies, ...current.manifest.peerDependencies })) {
        if (isBuiltin(dependencyName)) continue
        const dependency = await installedDependency(join(current.directory, 'package.json'), dependencyName)
        if (!dependency) {
          if (await installedDependency(anchor, dependencyName)) continue
          if (Object.hasOwn(current.manifest.dependencies ?? {}, dependencyName)) {
            options.note(`[desktop] unresolved dependency ${dependencyName} of ${current.manifest.name}`)
            complete = false
          }
          continue
        }
        const entry = ownership.get(dependency.directory) ?? { dependency, owners: new Set<string>(), blocked: true }
        entry.owners.add(name)
        entry.blocked &&= blocked
        ownership.set(dependency.directory, entry)
        pending.push(dependency)
      }
    }
  }
  // An incomplete graph cannot establish that no active plugin uses a copy.
  if (!complete) { options.note('[desktop] runtime dependency audit incomplete; preserved profile packages'); return [] }
  const moved: string[] = []
  const recovery = join(profile, '.insight-runtime-conflicts', randomUUID())
  for (const { dependency, owners, blocked } of ownership.values()) {
    const { name, version } = dependency.manifest
    if (!blocked || !name?.startsWith('@deepseek-ai/dsh-') || !version || protectedNames.has(name)) continue
    const entry = join(profile, 'node_modules', name)
    if (await realpath(entry).catch(() => undefined) !== dependency.directory) continue
    const shipped = await installedDependency(anchor, name)
    if (!shipped?.manifest.version || shipped.manifest.version === version) continue
    const within = relative(installation, shipped.directory)
    if (isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) continue
    const destination = join(recovery, name)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination + '.recovery.json', JSON.stringify({ source: entry, destination, name, version, runtimeVersion: shipped.manifest.version, owners: [...owners] }, null, 2) + '\n')
    await rename(entry, destination)
    moved.push(destination)
    options.note(`[desktop] isolated ${name}@${version} from blocked bundles ${[...owners].join(', ')}; using shipped ${shipped.manifest.version}; backup: ${destination}`)
  }
  return moved
}
