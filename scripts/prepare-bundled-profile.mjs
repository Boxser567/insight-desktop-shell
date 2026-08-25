import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const PROFILE = 'web'
const SIDEBAR_PACKAGE = 'dsh-better-sidebar'
const SIDEBAR_VERSION = '0.16.1'
const projectRoot = process.cwd()
const bundledProfileRoot = join(projectRoot, 'build', 'bundled-profile')
const bundledProfileDirectory = join(bundledProfileRoot, PROFILE)
const bundledNode = process.platform === 'win32'
  ? join(projectRoot, 'node_modules', 'node', 'bin', 'node.exe')
  : join(projectRoot, 'node_modules', 'node', 'bin', 'node')
const nodeExecutable = existsSync(bundledNode) ? bundledNode : process.execPath
const dshEntry = join(projectRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpmEntry = join(projectRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')

async function removeHarnessHomeResidue() {
  // `bundled-profile` is a template root, not a DSH home. A diagnostic run
  // with DSH_HOME pointed here can create these directories and symlink the
  // application dependencies into the template, which must never be shipped.
  await rm(join(bundledProfileRoot, 'profiles'), { recursive: true, force: true })
  await rm(join(bundledProfileRoot, 'storages'), { recursive: true, force: true })
}

function hasPinnedSidebar(manifest) {
  return manifest.dependencies?.[SIDEBAR_PACKAGE] === SIDEBAR_VERSION
}

async function readManifest(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

async function templateIsReady() {
  const manifest = await readManifest(join(bundledProfileDirectory, 'package.json'))
  if (!manifest || !hasPinnedSidebar(manifest)) return false
  return existsSync(join(bundledProfileDirectory, 'pnpm-lock.yaml')) &&
    existsSync(join(bundledProfileDirectory, 'node_modules', SIDEBAR_PACKAGE, 'package.json'))
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

async function runDsh(home, workingDirectory, shimDirectory) {
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
    const child = spawn(nodeExecutable, [dshEntry, 'plugin', '--profile', PROFILE, 'add', '--save-exact', `${SIDEBAR_PACKAGE}@${SIDEBAR_VERSION}`], {
      cwd: workingDirectory,
      env: environment,
      stdio: 'inherit',
      windowsHide: true
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Could not prepare the bundled profile (dsh exited with code ${code ?? 'unknown'}).`)))
  })
}

if (!existsSync(dshEntry) || !existsSync(pnpmEntry)) {
  throw new Error('The installed DSH or pnpm runtime was not found. Run npm install before preparing the bundled profile.')
}

await removeHarnessHomeResidue()

if (await templateIsReady()) {
  console.log(`Bundled ${SIDEBAR_PACKAGE}@${SIDEBAR_VERSION} profile is already prepared.`)
} else {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'insight-bundled-profile-'))
  try {
    const shimDirectory = join(temporaryDirectory, '.bin')
    await writePnpmShim(shimDirectory)
    await runDsh(temporaryDirectory, projectRoot, shimDirectory)
    await rm(bundledProfileRoot, { recursive: true, force: true })
    await mkdir(bundledProfileRoot, { recursive: true })
    await cp(join(temporaryDirectory, 'profiles', PROFILE), bundledProfileDirectory, {
      recursive: true,
      verbatimSymlinks: true
    })
    console.log(`Prepared bundled ${SIDEBAR_PACKAGE}@${SIDEBAR_VERSION} profile.`)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
