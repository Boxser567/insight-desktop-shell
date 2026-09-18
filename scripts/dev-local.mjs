import { spawn } from 'node:child_process'
import { cp, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeRuntimeManifest } from './prepare-runtime-manifest.mjs'
import { removeInvalidBundledNodeShim } from './prepare-core-runtime.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** Validate a locally assembled Runtime before replacing the development cache. */
export async function inspectLocalRuntime(directory) {
  const metadata = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'))
  if (metadata.schemaVersion !== 1 || metadata.target?.platform !== process.platform ||
      metadata.target?.arch !== process.arch || !/^[a-f0-9]{40}$/.test(metadata.core?.commit) ||
      typeof metadata.core?.repository !== 'string' || typeof metadata.core?.version !== 'string' ||
      typeof metadata.node?.version !== 'string' || metadata.entry !== 'node_modules/@deepseek-ai/dsh/lib/bin.js') {
    throw new Error('Local Runtime metadata is invalid or targets a different platform.')
  }
  const inputTypes = await readFile(join(directory, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/input.d.ts'), 'utf8')
  if (!inputTypes.includes('setSelectedSkills(')) throw new Error('Local Runtime lacks setSelectedSkills; rebuild the Skill feature Core first.')
  await Promise.all([
    metadata.entry,
    `node_modules/node/bin/${process.platform === 'win32' ? 'node.exe' : 'node'}`,
    'node_modules/pnpm/bin/pnpm.cjs'
  ].map(path => realpath(join(directory, path))))
  return metadata
}

function runNpm(args) {
  return new Promise((resolvePromise, reject) => {
    const cli = process.env.npm_execpath
    if (!cli) throw new Error('Run this entry using npm run dev:local -- <assembled-runtime-directory>.')
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`npm ${args.join(' ')} exited with ${code}`)))
  })
}

async function main() {
  if (process.argv.length !== 3) throw new Error('Usage: npm run dev:local -- <assembled-runtime-directory>')
  const source = await realpath(resolve(process.argv[2]))
  const destination = join(root, 'build/core-runtime')
  const relativeSource = relative(destination, source)
  const relativeDestination = relative(source, destination)
  if (!relativeSource || !relativeSource.startsWith('..') || !relativeDestination.startsWith('..')) {
    throw new Error('Local Runtime must be outside the build/core-runtime cache.')
  }
  const metadata = await inspectLocalRuntime(source)
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true })
  await removeInvalidBundledNodeShim(destination)
  await writeRuntimeManifest(join(root, 'build/runtime-manifest.json'), {
    schemaVersion: 1,
    core: { ...metadata.core, source: 'local', releaseTag: 'local-development' },
    harness: { entry: metadata.entry },
    node: metadata.node,
    target: metadata.target,
    checksums: { archiveSha256: '' }
  })
  console.log(`Local development Core: ${metadata.core.commit}`)
  await runNpm(['run', 'build:desktop-integration'])
  await runNpm(['run', 'prepare:bundled-profile'])
  await runNpm(['exec', '--', 'electron-vite', 'dev'])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
