import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

export function resolvePackagedHarnessPaths(
  resourceRoot,
  runtimeMetadata,
  host = { platform: process.platform, arch: process.arch }
) {
  if (
    runtimeMetadata?.target?.platform !== host.platform ||
    runtimeMetadata?.target?.arch !== host.arch
  ) {
    throw new Error(
      `Packaged Runtime targets ${runtimeMetadata?.target?.platform ?? 'unknown'}-${runtimeMetadata?.target?.arch ?? 'unknown'}, not ${host.platform}-${host.arch}.`
    )
  }
  if (typeof runtimeMetadata.entry !== 'string') {
    throw new Error('Packaged Runtime metadata has no Harness entry.')
  }

  const runtimeRoot = join(resourceRoot, 'runtime')
  return {
    nodeExecutable: join(
      runtimeRoot,
      'node_modules',
      'node',
      'bin',
      host.platform === 'win32' ? 'node.exe' : 'node'
    ),
    nodeEntry: join(resourceRoot, 'harness-node-entry.mjs'),
    dshEntry: join(runtimeRoot, runtimeMetadata.entry),
    desktopPatch: join(resourceRoot, 'dsh-desktop.patch.yml'),
    bundledProfile: join(resourceRoot, 'bundled-profile', 'web')
  }
}

export function buildPackagedHarnessArguments(paths, port) {
  return [
    '--expose-internals',
    paths.nodeEntry,
    paths.dshEntry,
    'web',
    '--patch',
    paths.desktopPatch,
    '--no-open',
    '--host',
    '127.0.0.1',
    '--port',
    String(port)
  ]
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve a Harness port.')
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

async function waitForReady(url, child, output, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged Harness exited before readiness (code ${child.exitCode}).\n${output()}`)
    }
    try {
      await invokeHarnessRpc(url, 'session.list', {})
      return
    } catch {
      // The HTTP listener opens before the RPC routes finish registering.
    }
    await sleep(500)
  }
  throw new Error(`Packaged Harness did not become ready within ${Math.round(timeoutMs / 1000)} seconds.\n${output()}`)
}

async function invokeHarnessRpc(url, method, payload) {
  const rpcId = randomUUID()
  const response = await fetch(`${url}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(30_000)
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Harness RPC ${method} returned HTTP ${response.status}: ${text}`)
  }
  if (body.rpcId !== rpcId) throw new Error(`Harness RPC id mismatch for ${method}.`)
  if (!body.result?.ok) {
    throw new Error(
      `Harness RPC ${method} failed: ${body.result?.error?.code ?? 'unknown'}: ${body.result?.error?.message ?? 'unknown error'}`
    )
  }
  return body.result.value
}

async function stopProcess(child) {
  if (child.exitCode !== null) return
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  child.kill('SIGTERM')
  await Promise.race([exited, sleep(4_000)])
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await Promise.race([exited, sleep(4_000)])
  }
}

export async function smokePackagedHarness(resourceRoot) {
  const resolvedResourceRoot = resolve(resourceRoot)
  const runtimeMetadata = JSON.parse(
    await readFile(join(resolvedResourceRoot, 'runtime', 'runtime.json'), 'utf8')
  )
  const paths = resolvePackagedHarnessPaths(resolvedResourceRoot, runtimeMetadata)
  for (const path of Object.values(paths)) {
    if (!existsSync(path)) throw new Error(`Packaged Harness resource is missing: ${path}`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'insight-packaged-harness-smoke-'))
  const dshHome = join(temporaryRoot, 'dsh-home')
  const workspacePath = join(temporaryRoot, '数据项素-工作区')
  let child
  let stdout = ''
  let stderr = ''
  try {
    await mkdir(join(dshHome, 'profiles'), { recursive: true })
    await cp(paths.bundledProfile, join(dshHome, 'profiles', 'web'), {
      recursive: true,
      verbatimSymlinks: true
    })
    await mkdir(workspacePath)

    const port = await reservePort()
    const url = `http://127.0.0.1:${port}`
    child = spawn(paths.nodeExecutable, buildPackagedHarnessArguments(paths, port), {
      cwd: workspacePath,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        NO_COLOR: '1',
        PNPM_MAX_WORKERS: '1',
        npm_config_child_concurrency: '1',
        npm_config_package_import_method: 'clone-or-copy',
        npm_config_side_effects_cache: 'false',
        PNPM_CONFIG_CHILD_CONCURRENCY: '1',
        PNPM_CONFIG_PACKAGE_IMPORT_METHOD: 'clone-or-copy',
        PNPM_CONFIG_SIDE_EFFECTS_CACHE: 'false'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
    const output = () => [stdout, stderr].filter(Boolean).join('\n')

    await waitForReady(url, child, output)
    const workspace = await invokeHarnessRpc(url, 'workspace.create', { path: workspacePath })
    const session = await invokeHarnessRpc(url, 'session.create', {
      workspaceId: workspace.workspace.workspaceId
    })
    if (typeof session.sessionId !== 'string' || session.sessionId.length === 0) {
      throw new Error('Harness did not return a session id for the selected workspace.')
    }

    await sleep(20_000)
    if (child.exitCode !== null) {
      throw new Error(`Packaged Harness exited after workspace and session creation (code ${child.exitCode}).\n${output()}`)
    }
    if (stderr.trim().length > 0) {
      throw new Error(`Packaged Harness reported stderr after workspace and session creation.\n${output()}`)
    }
    console.log('Packaged Harness runtime smoke test passed.')
  } finally {
    if (child) await stopProcess(child)
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

async function main() {
  const resourceRoot = process.argv[2]
  if (!resourceRoot) throw new Error('Usage: node scripts/smoke-packaged-harness.mjs <resources-directory>')
  await smokePackagedHarness(resourceRoot)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
