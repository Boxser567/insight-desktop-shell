import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildPackagedHarnessArguments,
  probePackagedHarness
} from './smoke-packaged-harness.mjs'

const PROFILE = 'web'
const DESCRIPTOR_PATH = join('vendor', 'plugins', 'bundled-community-plugins.json')
const REQUIRED_ENTRIES = new Map([
  ['dsh-memory-evolve', ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']],
  ['@changfenhuang/dsh-genui', [
    'lib/index.js',
    'lib/client.js',
    'lib/invariant.js',
    'lib/assets/mermaid.js',
    'lib/assets/three.js',
    'lib/assets/echarts.js',
    'cordis.patch.yml'
  ]],
  ['dsh-prompt-enhance', ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']]
])

function runtimePaths(projectRoot) {
  const coreRuntimeRoot = join(projectRoot, 'build', 'core-runtime')
  const nodeExecutable = process.platform === 'win32'
    ? join(coreRuntimeRoot, 'node_modules', 'node', 'bin', 'node.exe')
    : join(coreRuntimeRoot, 'node_modules', 'node', 'bin', 'node')
  return {
    nodeExecutable,
    dshEntry: join(coreRuntimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    pnpmEntry: join(coreRuntimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    nodeEntry: join(projectRoot, 'build', 'harness-node-entry.mjs'),
    desktopPatch: join(projectRoot, 'build', 'dsh-desktop.patch.yml')
  }
}

function profileEnvironment(home, shimDirectory, nodeExecutable) {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  const inheritedPath = process.env[pathKey] ?? process.env.PATH ?? ''
  const executablePath = [shimDirectory, dirname(nodeExecutable), inheritedPath]
    .filter(Boolean)
    .join(process.platform === 'win32' ? ';' : ':')
  return {
    ...process.env,
    DSH_HOME: home,
    [pathKey]: executablePath,
    PATH: executablePath,
    CI: 'true',
    NO_COLOR: '1',
    PNPM_MAX_WORKERS: '1',
    npm_config_child_concurrency: '1',
    npm_config_package_import_method: 'clone-or-copy',
    npm_config_side_effects_cache: 'false',
    PNPM_CONFIG_CHILD_CONCURRENCY: '1',
    PNPM_CONFIG_PACKAGE_IMPORT_METHOD: 'clone-or-copy',
    PNPM_CONFIG_SIDE_EFFECTS_CACHE: 'false'
  }
}

async function writePnpmShim(directory, paths) {
  await mkdir(directory, { recursive: true })
  if (process.platform === 'win32') {
    await writeFile(
      join(directory, 'pnpm.cmd'),
      `@echo off\r\n"${paths.nodeExecutable}" "${paths.pnpmEntry}" %*\r\n`,
      'utf8'
    )
    await writeFile(
      join(directory, 'node.cmd'),
      `@echo off\r\n"${paths.nodeExecutable}" %*\r\n`,
      'utf8'
    )
    return
  }
  const pnpmPath = join(directory, 'pnpm')
  await writeFile(
    pnpmPath,
    `#!/bin/sh\nexec "${paths.nodeExecutable}" "${paths.pnpmEntry}" "$@"\n`,
    'utf8'
  )
  await chmod(pnpmPath, 0o755)
  const nodePath = join(directory, 'node')
  await writeFile(nodePath, `#!/bin/sh\nexec "${paths.nodeExecutable}" "$@"\n`, 'utf8')
  await chmod(nodePath, 0o755)
}

async function runDshCommand(command, paths) {
  const environment = profileEnvironment(command.home, command.shimDirectory, paths.nodeExecutable)
  await new Promise((resolveCommand, reject) => {
    const child = spawn(paths.nodeExecutable, [paths.dshEntry, ...command.args], {
      cwd: command.workingDirectory,
      env: environment,
      stdio: 'inherit',
      windowsHide: true
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0
      ? resolveCommand()
      : reject(new Error(`dsh exited with code ${code ?? 'unknown'}`)))
  })
}

async function runHarnessProbe(probe) {
  const shimDirectory = join(probe.dshHome, '.bin')
  await probePackagedHarness({
    nodeExecutable: probe.nodeExecutable,
    buildArguments: (port) => buildPackagedHarnessArguments(probe, port),
    workingDirectory: probe.workingDirectory,
    environment: profileEnvironment(probe.dshHome, shimDirectory, probe.nodeExecutable),
    stabilityMs: 2_000,
    failOnStderr: true
  })
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function resolveArtifact(projectRoot, artifact) {
  if (typeof artifact !== 'string' || artifact.length === 0 || isAbsolute(artifact)) {
    throw new Error(`Invalid bundled community plugin artifact path: ${String(artifact)}`)
  }
  const artifactPath = resolve(projectRoot, artifact)
  const projectRelativePath = relative(projectRoot, artifactPath)
  if (projectRelativePath === '..' || projectRelativePath.startsWith(`..${sep}`)) {
    throw new Error(`Bundled community plugin artifact escapes the project root: ${artifact}`)
  }
  return artifactPath
}

async function readDescriptor(projectRoot) {
  const descriptor = JSON.parse(await readFile(join(projectRoot, DESCRIPTOR_PATH), 'utf8'))
  if (descriptor?.schemaVersion !== 1 || !Array.isArray(descriptor.plugins)) {
    throw new Error('Bundled community plugin descriptor must use schemaVersion 1.')
  }
  return descriptor
}

async function verifyArchiveDigest(record, artifactPath) {
  const archive = await readFile(artifactPath)
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== record.sha256) {
    throw new Error(`${record.packageName} archive SHA-256 mismatch: expected ${record.sha256}, got ${actual}`)
  }
}

async function verifyInstalledPackage(home, record) {
  const profileDirectory = join(home, 'profiles', PROFILE)
  const profileManifest = JSON.parse(await readFile(join(profileDirectory, 'package.json'), 'utf8'))
  if (typeof profileManifest.dependencies?.[record.packageName] !== 'string') {
    throw new Error(`${record.packageName} was not saved as a Profile dependency`)
  }
  if (!profileManifest.dsh?.profile?.bundles?.includes(record.packageName)) {
    throw new Error(`${record.packageName} was not saved as a Profile bundle`)
  }

  const packageDirectory = join(profileDirectory, 'node_modules', ...record.packageName.split('/'))
  const installedManifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
  if (installedManifest.name !== record.packageName || installedManifest.version !== record.version) {
    throw new Error(
      `expected ${record.packageName}@${record.version}, installed ${installedManifest.name ?? 'unknown'}@${installedManifest.version ?? 'unknown'}`
    )
  }
  for (const entry of REQUIRED_ENTRIES.get(record.packageName) ?? []) {
    if (!existsSync(join(packageDirectory, ...entry.split('/')))) {
      throw new Error(`${record.packageName} is missing required entry ${entry}`)
    }
  }
}

export async function verifyBundledCommunityPlugin(projectRoot, packageName, dependencies = {}) {
  const resolvedProjectRoot = resolve(projectRoot)
  const descriptor = await readDescriptor(resolvedProjectRoot)
  const record = descriptor.plugins.find((plugin) => plugin?.packageName === packageName)
  if (!record) throw new Error(`${packageName} is not a bundled community plugin`)
  const requiredEntries = REQUIRED_ENTRIES.get(packageName)
  if (!requiredEntries) throw new Error(`${packageName} has no bundled verification policy`)
  if (typeof record.version !== 'string' || !/^[a-f0-9]{64}$/u.test(record.sha256)) {
    throw new Error(`${packageName} has invalid version or SHA-256 metadata`)
  }

  const artifactPath = resolveArtifact(resolvedProjectRoot, record.artifact)
  console.log(`[${packageName}] verifying archive digest`)
  await verifyArchiveDigest(record, artifactPath)

  const paths = runtimePaths(resolvedProjectRoot)
  for (const requiredPath of Object.values(paths)) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Bundled plugin verification resource is missing: ${requiredPath}`)
    }
  }

  const makeTemporaryDirectory = dependencies.makeTemporaryDirectory ??
    ((prefix) => mkdtemp(prefix))
  const removeTemporaryDirectory = dependencies.removeTemporaryDirectory ??
    ((directory) => rm(directory, { recursive: true, force: true }))
  const runDsh = dependencies.runDsh ?? ((command) => runDshCommand(command, paths))
  const runHarness = dependencies.runHarness ?? runHarnessProbe
  const temporaryDirectory = await makeTemporaryDirectory(
    join(tmpdir(), 'insight-bundled-plugin-verifier-')
  )

  try {
    const shimDirectory = join(temporaryDirectory, '.bin')
    const workspaceDirectory = join(temporaryDirectory, 'workspace')
    await writePnpmShim(shimDirectory, paths)
    await mkdir(workspaceDirectory)

    const baseCommand = {
      home: temporaryDirectory,
      workingDirectory: resolvedProjectRoot,
      shimDirectory
    }
    console.log(`[${packageName}] adding archive to disposable Profile`)
    try {
      await runDsh({
        ...baseCommand,
        args: [
          'plugin', '--profile', PROFILE, 'add', '--save-exact', '--allow-build=node-pty',
          artifactPath
        ]
      })
    } catch (error) {
      throw new Error(`Could not add ${packageName}: ${errorMessage(error)}`)
    }

    console.log(`[${packageName}] installing disposable Profile`)
    try {
      await runDsh({
        ...baseCommand,
        args: ['plugin', '--profile', PROFILE, 'install', '--no-frozen-lockfile']
      })
    } catch (error) {
      throw new Error(`Could not install ${packageName}: ${errorMessage(error)}`)
    }
    await verifyInstalledPackage(temporaryDirectory, record)

    console.log(`[${packageName}] probing Harness startup`)
    try {
      await runHarness({
        nodeExecutable: paths.nodeExecutable,
        nodeEntry: paths.nodeEntry,
        dshEntry: paths.dshEntry,
        desktopPatch: paths.desktopPatch,
        dshHome: temporaryDirectory,
        workingDirectory: workspaceDirectory
      })
    } catch (error) {
      throw new Error(`${packageName} Harness boot failed: ${errorMessage(error)}`)
    }
    console.log(`[${packageName}] disposable Profile verification passed`)
  } finally {
    await removeTemporaryDirectory(temporaryDirectory)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1) {
    throw new Error('Usage: node scripts/verify-bundled-community-plugin.mjs <package-name>')
  }
  await verifyBundledCommunityPlugin(process.cwd(), args[0])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
