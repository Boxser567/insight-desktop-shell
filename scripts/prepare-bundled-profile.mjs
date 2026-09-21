import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse, stringify } from 'yaml'
import { patchBundledPromptEnhance } from './patch-bundled-prompt-enhance.mjs'

const PROFILE = 'web'
const DESKTOP_INTEGRATION_PACKAGE = '@insight-ai/desktop-integration'
const DEFAULT_PROFILE_VERSION = 8
const COMMUNITY_PLUGIN_DIRECTORY = '.insight-bundled-plugins'
const COMMUNITY_PLUGIN_SPEC_PREFIX = 'file:.insight-bundled-plugins/'
const COMMUNITY_PLUGIN_DESCRIPTOR = join(
  'vendor',
  'plugins',
  'bundled-community-plugins.json'
)
const COMMUNITY_PLUGIN_FIELDS = [
  'artifact',
  'packageName',
  'sha256',
  'sourceCommit',
  'sourceRef',
  'sourceRepository',
  'version'
]
const EXPECTED_COMMUNITY_PLUGINS = [
  {
    packageName: 'dsh-memory-evolve',
    version: '0.1.0',
    artifact: 'vendor/plugins/dsh-memory-evolve-0.1.0.tgz',
    sha256: '88fc21d567b7500f8f753fdf88c66241ef7e25541d807a654e96626130940906',
    sourceRepository: 'https://github.com/csyangwen/dsh-memory-evolve',
    sourceRef: 'v26091501',
    sourceCommit: 'c337dc1af7b5c8a5578e03150bf5c4d6133f66f9'
  },
  {
    packageName: 'dsh-prompt-enhance',
    version: '0.2.1',
    artifact: 'vendor/plugins/dsh-prompt-enhance-0.2.1.tgz',
    sha256: '2bd468e243143ee7b5dc86c3d180667743c71dfc1a1cbb2a5de9780f3189c694',
    sourceRepository: 'https://github.com/rongxingda/dsh-prompt-enhance',
    sourceRef: 'v0.2.1',
    sourceCommit: '42c8f137937a406a1035a75f270d895ea5b0d3c1'
  }
]
const projectRoot = process.cwd()
const desktopIntegrationSource = join(projectRoot, 'packages', 'insight-desktop-integration')
const bundledProfileRoot = join(projectRoot, 'build', 'bundled-profile')
const bundledProfileDirectory = join(bundledProfileRoot, PROFILE)
const coreRuntimeRoot = join(projectRoot, 'build', 'core-runtime')
const profileLockPath = join(projectRoot, 'build', 'bundled-profile.pnpm-lock.yaml')
const bundledNode = process.platform === 'win32'
  ? join(coreRuntimeRoot, 'node_modules', 'node', 'bin', 'node.exe')
  : join(coreRuntimeRoot, 'node_modules', 'node', 'bin', 'node')
const nodeExecutable = bundledNode
const dshEntry = join(coreRuntimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpmEntry = join(coreRuntimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')

async function removeHarnessHomeResidue() {
  // `bundled-profile` is a template root, not a DSH home. A diagnostic run
  // with DSH_HOME pointed here can create these directories and symlink the
  // application dependencies into the template, which must never be shipped.
  await rm(join(bundledProfileRoot, 'profiles'), { recursive: true, force: true })
  await rm(join(bundledProfileRoot, 'storages'), { recursive: true, force: true })
}

function hasPinnedDefaultPlugins(manifest, communityPlugins) {
  return manifest.dependencies?.[DESKTOP_INTEGRATION_PACKAGE] === 'workspace:*' &&
    manifest.dsh?.profile?.bundles?.includes(DESKTOP_INTEGRATION_PACKAGE) &&
    !manifest.dependencies?.['dsh-at-file'] &&
    !manifest.dsh?.profile?.bundles?.includes('dsh-at-file') &&
    communityPlugins.every((plugin) =>
      manifest.dependencies?.[plugin.packageName] === plugin.profileSpecifier &&
      manifest.dsh?.profile?.bundles?.includes(plugin.packageName)
    ) &&
    manifest.insightDesktop?.defaultProfileVersion === DEFAULT_PROFILE_VERSION
}

async function readManifest(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function descriptorRecordMatches(record, expected) {
  return COMMUNITY_PLUGIN_FIELDS.every((field) => record[field] === expected[field]) &&
    Object.keys(record).sort().join('\n') === COMMUNITY_PLUGIN_FIELDS.slice().sort().join('\n')
}

async function readCommunityPlugins() {
  const descriptor = JSON.parse(
    await readFile(join(projectRoot, COMMUNITY_PLUGIN_DESCRIPTOR), 'utf8')
  )
  if (
    descriptor?.schemaVersion !== 1 ||
    !Array.isArray(descriptor.plugins) ||
    descriptor.plugins.length !== EXPECTED_COMMUNITY_PLUGINS.length ||
    Object.keys(descriptor).sort().join('\n') !== 'plugins\nschemaVersion'
  ) {
    throw new Error('The bundled community plugin descriptor is invalid.')
  }

  const plugins = []
  for (const [index, expected] of EXPECTED_COMMUNITY_PLUGINS.entries()) {
    const record = descriptor.plugins[index]
    if (!record || !descriptorRecordMatches(record, expected)) {
      throw new Error(`The bundled community plugin descriptor does not match ${expected.packageName}@${expected.version}.`)
    }
    if (!/^[a-f0-9]{64}$/u.test(record.sha256) || isAbsolute(record.artifact)) {
      throw new Error(`${record.packageName} has invalid archive metadata.`)
    }
    const artifactPath = resolve(projectRoot, record.artifact)
    const projectRelativePath = relative(projectRoot, artifactPath)
    if (projectRelativePath === '..' || projectRelativePath.startsWith(`..${sep}`)) {
      throw new Error(`${record.packageName} archive escapes the project root.`)
    }
    const actualHash = await sha256(artifactPath)
    if (actualHash !== record.sha256) {
      throw new Error(
        `${record.packageName} archive SHA-256 mismatch: expected ${record.sha256}, got ${actualHash}.`
      )
    }
    const archiveName = record.artifact.split('/').at(-1)
    if (!archiveName) throw new Error(`${record.packageName} archive name is missing.`)
    plugins.push({
      ...record,
      artifactPath,
      archiveName,
      profileSpecifier: `${COMMUNITY_PLUGIN_SPEC_PREFIX}${archiveName}`
    })
  }
  return plugins
}

async function templateIsReady(communityPlugins) {
  const manifest = await readManifest(join(bundledProfileDirectory, 'package.json'))
  if (!manifest || !hasPinnedDefaultPlugins(manifest, communityPlugins)) return false
  const requiredFilesExist = existsSync(join(bundledProfileDirectory, 'pnpm-lock.yaml')) &&
    existsSync(join(bundledProfileDirectory, 'node_modules', DESKTOP_INTEGRATION_PACKAGE, 'package.json')) &&
    existsSync(join(bundledProfileDirectory, 'packages', 'insight-desktop-integration', 'lib', 'client.js'))
  if (!requiredFilesExist) return false
  if (await sha256(join(bundledProfileDirectory, 'pnpm-lock.yaml')) !== await sha256(profileLockPath)) return false

  for (const plugin of communityPlugins) {
    const installedManifest = await readManifest(join(
      bundledProfileDirectory,
      'node_modules',
      ...plugin.packageName.split('/'),
      'package.json'
    ))
    if (
      installedManifest?.name !== plugin.packageName ||
      installedManifest?.version !== plugin.version
    ) return false
    const retainedArchive = join(
      bundledProfileDirectory,
      COMMUNITY_PLUGIN_DIRECTORY,
      plugin.archiveName
    )
    if (!existsSync(retainedArchive) || await sha256(retainedArchive) !== plugin.sha256) return false
  }
  return true
}

async function copyCommunityPluginArchives(profileDirectory, communityPlugins) {
  const destination = join(profileDirectory, COMMUNITY_PLUGIN_DIRECTORY)
  await mkdir(destination, { recursive: true })
  for (const plugin of communityPlugins) {
    await cp(plugin.artifactPath, join(destination, plugin.archiveName))
  }
}

async function writePnpmShim(directory) {
  await mkdir(directory, { recursive: true })
  if (process.platform === 'win32') {
    await writeFile(
      join(directory, 'pnpm.cmd'),
      `@echo off\r\n"${nodeExecutable}" "${pnpmEntry}" %*\r\n`,
      'utf8'
    )
    await writeFile(join(directory, 'node.cmd'), `@echo off\r\n"${nodeExecutable}" %*\r\n`, 'utf8')
    return
  }
  const pnpmPath = join(directory, 'pnpm')
  await writeFile(pnpmPath, `#!/bin/sh\nexec "${nodeExecutable}" "${pnpmEntry}" "$@"\n`, 'utf8')
  await chmod(pnpmPath, 0o755)
  const nodePath = join(directory, 'node')
  await writeFile(nodePath, `#!/bin/sh\nexec "${nodeExecutable}" "$@"\n`, 'utf8')
  await chmod(nodePath, 0o755)
}

async function runDsh(home, workingDirectory, shimDirectory, args) {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  const inheritedPath = process.env[pathKey] ?? process.env.PATH ?? ''
  const environment = {
    ...process.env,
    DSH_HOME: home,
    [pathKey]: [shimDirectory, dirname(nodeExecutable), inheritedPath].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
    PATH: [shimDirectory, dirname(nodeExecutable), inheritedPath].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
    CI: 'true',
    NO_COLOR: '1',
    PNPM_MAX_WORKERS: '1',
    npm_config_child_concurrency: '1',
    npm_config_package_import_method: 'clone-or-copy',
    npm_config_side_effects_cache: 'false'
  }
  await new Promise((resolve, reject) => {
    const child = spawn(nodeExecutable, [join(projectRoot, 'build', 'harness-node-entry.mjs'), dshEntry, ...args], {
      cwd: workingDirectory,
      env: environment,
      stdio: 'inherit',
      windowsHide: true
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Could not prepare the bundled profile (dsh exited with code ${code ?? 'unknown'}).`)))
  })
}

async function configureDefaultProfile(directory) {
  const manifestPath = join(directory, 'package.json')
  const manifest = await readManifest(manifestPath)
  if (!manifest) throw new Error('The bundled profile manifest could not be read.')
  manifest.dependencies ??= {}
  manifest.dependencies[DESKTOP_INTEGRATION_PACKAGE] = 'workspace:*'
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  manifest.dsh.profile.bundles ??= []
  if (!manifest.dsh.profile.bundles.includes(DESKTOP_INTEGRATION_PACKAGE)) {
    manifest.dsh.profile.bundles.push(DESKTOP_INTEGRATION_PACKAGE)
  }
  manifest.insightDesktop = { defaultProfileVersion: DEFAULT_PROFILE_VERSION }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const packageDestination = join(directory, 'packages', 'insight-desktop-integration')
  await rm(packageDestination, { recursive: true, force: true })
  await mkdir(dirname(packageDestination), { recursive: true })
  await cp(desktopIntegrationSource, packageDestination, {
    recursive: true,
    filter: (source) => !source.includes(`${join('insight-desktop-integration', 'src')}`) &&
      !source.includes(`${join('insight-desktop-integration', 'tsconfig.json')}`)
  })

  const workspacePath = join(directory, 'pnpm-workspace.yaml')
  let workspace = {}
  try {
    workspace = parse(await readFile(workspacePath, 'utf8')) ?? {}
  } catch { }
  const packages = Array.isArray(workspace.packages)
    ? workspace.packages.filter((value) => typeof value === 'string')
    : []
  if (!packages.includes('.')) packages.unshift('.')
  if (!packages.includes('packages/*')) packages.push('packages/*')
  workspace.packages = packages
  delete workspace.minimumReleaseAge
  await writeFile(workspacePath, stringify(workspace), 'utf8')
}

if (!existsSync(dshEntry) || !existsSync(pnpmEntry)) {
  throw new Error('The locked Core Runtime was not found. Run npm run prepare:core-runtime before preparing the bundled profile.')
}

const communityPlugins = await readCommunityPlugins()
await removeHarnessHomeResidue()

if (await templateIsReady(communityPlugins)) {
  await configureDefaultProfile(bundledProfileDirectory)
  await patchBundledPromptEnhance(bundledProfileDirectory)
  console.log(`Refreshed bundled desktop profile version ${DEFAULT_PROFILE_VERSION}.`)
} else {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'insight-bundled-profile-'))
  try {
    const shimDirectory = join(temporaryDirectory, '.bin')
    await writePnpmShim(shimDirectory)
    const temporaryProfile = join(temporaryDirectory, 'profiles', PROFILE)
    await mkdir(temporaryProfile, { recursive: true })
    await copyCommunityPluginArchives(temporaryProfile, communityPlugins)
    await writeFile(join(temporaryProfile, 'package.json'), `${JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: Object.fromEntries(communityPlugins.map(plugin => [plugin.packageName, plugin.profileSpecifier])),
      dsh: { profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
          ...communityPlugins.map(plugin => plugin.packageName)],
        patchReload: 'live'
      } }
    }, null, 2)}\n`)
    await writeFile(join(temporaryProfile, 'cordis.patch.yml'), '[]\n')
    await writeFile(join(temporaryProfile, 'pnpm-workspace.yaml'), stringify({
      packages: ['.', 'packages/*'],
      nodeLinker: 'hoisted',
      autoInstallPeers: false,
      allowBuilds: { 'node-pty': true }
    }))
    await configureDefaultProfile(temporaryProfile)
    await cp(profileLockPath, join(temporaryProfile, 'pnpm-lock.yaml'))
    await runDsh(temporaryDirectory, projectRoot, shimDirectory, [
      'plugin', '--profile', PROFILE, 'install', '--frozen-lockfile'
    ])
    if (await sha256(join(temporaryProfile, 'pnpm-lock.yaml')) !== await sha256(profileLockPath)) {
      throw new Error('Bundled Profile installation changed the frozen dependency lock.')
    }
    await patchBundledPromptEnhance(temporaryProfile)
    await rm(bundledProfileRoot, { recursive: true, force: true })
    await mkdir(bundledProfileRoot, { recursive: true })
    await cp(join(temporaryDirectory, 'profiles', PROFILE), bundledProfileDirectory, {
      recursive: true,
      verbatimSymlinks: true
    })
    console.log(`Prepared bundled desktop profile version ${DEFAULT_PROFILE_VERSION}.`)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
