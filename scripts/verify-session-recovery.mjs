import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const probe = fileURLToPath(new URL('../test/fixtures/session-recovery.mjs', import.meta.url))

async function inspect(runtime) {
  const directory = resolve(runtime)
  const metadata = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'))
  assert.deepEqual(metadata.target, { platform: process.platform, arch: process.arch }, 'Recovery probes require native Runtimes')
  assert.match(metadata.core.commit, /^[a-f0-9]{40}$/)
  return { directory, metadata, node: join(directory, 'node_modules/node/bin', process.platform === 'win32' ? 'node.exe' : 'node') }
}

async function historicalHashes(root) {
  const entries = []
  for (const id of ['migrated-recovery', 'failed-tool-recovery']) {
    const directory = join(root, 'sessions/_no-cwd', id)
    const files = (await readdir(directory)).filter(name => name.startsWith('session.v3.')).sort()
    assert.ok(files.length > 0, 'Previous writer must persist a v3 generation')
    entries.push(...await Promise.all(files.map(async name => [`${id}/${name}`,
      createHash('sha256').update(await readFile(join(directory, name))).digest('hex')
    ])))
  }
  return Object.fromEntries(entries)
}

/** Prove Candidate → recovery → Candidate continuation using actual shipped persistence providers. */
export async function verifySessionRecovery({ candidateRuntime, recoveryRuntime, previousRuntime }) {
  const candidate = await inspect(candidateRuntime)
  const recovery = await inspect(recoveryRuntime)
  const previous = previousRuntime ? await inspect(previousRuntime) : undefined
  const root = await mkdtemp(join(tmpdir(), 'insight-session-recovery-'))
  try {
    const phases = []
    async function run(runtime, phase) {
      const { stdout } = await execute(runtime.node, [probe, runtime.directory, root, phase, String(Boolean(previous))], {
        cwd: root, timeout: 20000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
        env: { ...process.env, DSH_HOME: join(root, 'dsh-home') }
      })
      phases.push(JSON.parse(stdout.trim()))
    }
    let original
    if (previous) { await run(previous, 'previous'); original = await historicalHashes(root) }
    await run(candidate, 'candidate')
    await run(recovery, 'recovery')
    await run(candidate, 'verify')
    if (original) assert.deepEqual(await historicalHashes(root), original, 'Committed v3 generations must remain byte-for-byte intact')
    return { schema: 'insight-session-recovery-proof/v1', checkedAt: new Date().toISOString(),
      candidate: candidate.metadata, recovery: recovery.metadata,
      ...(previous ? { previous: previous.metadata, preservedHistoricalFiles: original } : {}), phases }
  } finally { await rm(root, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [candidateRuntime, recoveryRuntime, output, previousRuntime] = process.argv.slice(2)
  if (!candidateRuntime || !recoveryRuntime || !output || process.argv.length > 6) {
    throw new Error('Usage: verify-session-recovery.mjs <candidate-runtime> <recovery-runtime> <report.json> [previous-v3-runtime]')
  }
  const report = await verifySessionRecovery({ candidateRuntime, recoveryRuntime, previousRuntime })
  await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n')
  console.log(`Session recovery proof saved: ${resolve(output)}`)
}
