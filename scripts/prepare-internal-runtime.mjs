import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectLocalRuntime } from './dev-local.mjs'
import { removeInvalidBundledNodeShim } from './prepare-core-runtime.mjs'
import { writeRuntimeManifest } from './prepare-runtime-manifest.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** Prepare the pinned CI Runtime for an isolated internal installer, leaving the public lock intact. */
export async function prepareInternalRuntime(archiveDirectory, projectDirectory = root) {
  const lock = JSON.parse(await readFile(join(projectDirectory, 'core-runtime.internal.lock.json'), 'utf8'))
  const target = `${process.platform}-${process.arch}`
  const selected = lock.targets?.[target]
  if (lock.schemaVersion !== 1 || lock.source?.repository !== 'Boxser567/insight-harness-core' ||
      !Number.isSafeInteger(lock.source?.workflowRun) || lock.source.workflowRun <= 0 ||
      lock.core?.repository !== lock.source.repository || !/^[a-f0-9]{40}$/.test(lock.core?.commit) ||
      !selected || !/^[a-f0-9]{64}$/.test(selected.sha256)) {
    throw new Error('Internal Runtime lock is invalid or lacks this native target.')
  }
  const filename = `insight-harness-runtime-${lock.core.version}-${target}.tar.gz`
  const archive = join(resolve(archiveDirectory), filename)
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
  if (digest !== selected.sha256) throw new Error('Internal Runtime archive SHA-256 mismatch.')
  const temporary = await mkdtemp(join(tmpdir(), 'insight-internal-runtime-'))
  try {
    await new Promise((resolvePromise, reject) => {
      const child = spawn('tar', ['-xzf', archive, '-C', temporary], { stdio: 'inherit', windowsHide: true })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Runtime extraction exited with ${code}.`)))
    })
    const metadata = await inspectLocalRuntime(temporary)
    if (metadata.core.repository !== lock.core.repository || metadata.core.version !== lock.core.version ||
        metadata.core.commit !== lock.core.commit || metadata.node.version !== selected.node.version ||
        metadata.pnpm?.version !== selected.pnpm.version) {
      throw new Error('Internal Runtime metadata does not match the pinned Core and toolchain.')
    }
    const destination = join(projectDirectory, 'build/core-runtime')
    await mkdir(dirname(destination), { recursive: true })
    await rm(destination, { recursive: true, force: true })
    await cp(temporary, destination, { recursive: true })
    await removeInvalidBundledNodeShim(destination)
    await writeRuntimeManifest(join(projectDirectory, 'build/runtime-manifest.json'), {
      schemaVersion: 1,
      core: { ...metadata.core, source: 'local', releaseTag: `internal-run-${lock.source.workflowRun}` },
      harness: { entry: metadata.entry },
      node: metadata.node,
      target: metadata.target,
      checksums: { archiveSha256: digest }
    })
    return metadata
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-internal-runtime.mjs <downloaded-runtime-artifact-directory>')
  const metadata = await prepareInternalRuntime(process.argv[2])
  console.log(`Prepared isolated internal Core: ${metadata.core.commit}`)
}
