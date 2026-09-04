import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const outputDirectory = join(projectRoot, 'build', 'core-runtime')
const lockPath = join(projectRoot, 'core-runtime.lock.json')

export function runtimeTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`
  if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target)) {
    throw new Error(`No Core Runtime is available for ${target}.`)
  }
  return target
}

export function selectCoreRuntime(lock, target) {
  if (lock?.schemaVersion !== 1 || typeof lock.releaseTag !== 'string') {
    throw new Error('core-runtime.lock.json is invalid.')
  }
  const runtime = lock.targets?.[target]
  if (!runtime || typeof runtime.url !== 'string' || !/^[0-9a-f]{64}$/.test(runtime.sha256)) {
    throw new Error(`core-runtime.lock.json has no valid ${target} Runtime.`)
  }
  return runtime
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Move a prepared Runtime, copying only when the source and destination are on different volumes. */
export async function moveRuntimeDirectory(source, destination, operations = { copyDirectory: cp, renameDirectory: rename }) {
  try {
    await operations.renameDirectory(source, destination)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EXDEV') throw error
    await operations.copyDirectory(source, destination, { recursive: true })
  }
}

/** Remove a host-bound Node shim that cannot be valid after Runtime extraction. */
export async function removeInvalidBundledNodeShim(directory, platform = process.platform) {
  if (platform === 'win32') return false
  const shim = join(directory, 'node_modules', '.bin', 'node')
  let shimStat
  try {
    shimStat = await lstat(shim)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
  if (!shimStat.isSymbolicLink()) return false

  const target = await readlink(shim)
  if (!isAbsolute(target)) {
    try {
      await stat(resolve(dirname(shim), target))
      return false
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    }
  }
  await rm(shim)
  return true
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`)))
  })
}

async function assertRuntime(directory, runtime, target) {
  const metadata = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'))
  const [platform, arch] = target.split('-')
  if (
    metadata?.schemaVersion !== 1 ||
    metadata.core?.repository !== runtime.core.repository ||
    metadata.core?.version !== runtime.core.version ||
    metadata.core?.commit !== runtime.core.commit ||
    metadata.node?.version !== runtime.node.version ||
    metadata.pnpm?.version !== runtime.pnpm.version ||
    metadata.target?.platform !== platform ||
    metadata.target?.arch !== arch
  ) throw new Error('Core Runtime metadata does not match core-runtime.lock.json.')

  const node = join(directory, 'node_modules', 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node')
  for (const path of [join(directory, metadata.entry), node, join(directory, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')]) {
    if (!existsSync(path)) throw new Error(`Core Runtime is missing ${path}.`)
  }
}

async function main() {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  const target = runtimeTarget()
  const runtime = selectCoreRuntime(lock, target)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'insight-core-runtime-'))
  try {
    const archive = join(temporaryDirectory, 'runtime.tar.gz')
    const response = await fetch(runtime.url)
    if (!response.ok) throw new Error(`Could not download locked Core Runtime: ${response.status} ${response.statusText}`)
    const body = Buffer.from(await response.arrayBuffer())
    if (sha256(body) !== runtime.sha256) throw new Error('Core Runtime archive SHA-256 does not match core-runtime.lock.json.')
    await writeFile(archive, body)
    const extracted = join(temporaryDirectory, 'runtime')
    await mkdir(extracted)
    await run('tar', ['-xzf', archive, '-C', extracted], projectRoot)
    await assertRuntime(extracted, runtime, target)
    await removeInvalidBundledNodeShim(extracted)
    await rm(outputDirectory, { recursive: true, force: true })
    await moveRuntimeDirectory(extracted, outputDirectory)
    console.log(`Prepared locked Core Runtime: ${target}`)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
