import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertReleaseIdentity } from './update-release-contract.mjs'

export function validateSourceRun(run, tag, policy, packageVersion, lock) {
  const version = tag.startsWith('v') ? tag.slice(1) : ''
  assertReleaseIdentity('candidate', version)
  if (run.repository?.full_name !== 'Boxser567/insight-desktop-shell' ||
      run.path !== '.github/workflows/release.yml' ||
      run.event !== 'workflow_dispatch' || run.status !== 'completed' ||
      run.conclusion !== 'success' || !/^[0-9a-f]{40}$/u.test(run.head_sha)) {
    throw new Error('Source must be a successful desktop release build in this repository.')
  }
  if (packageVersion !== version || policy.releaseVersion !== version ||
      policy.channel !== 'candidate' || policy.mode !== 'optional') {
    throw new Error('Source package and optional Candidate policy must match the requested version.')
  }
  const commits = new Set(Object.values(lock.targets).map((target) => target.core.commit))
  if (commits.size !== 1) throw new Error('Runtime targets must use one Core commit.')
  return { version, shellCommit: run.head_sha,
    core: { releaseTag: lock.releaseTag, commit: [...commits][0] } }
}

async function main() {
  const [runPath, tag, outputDirectory] = process.argv.slice(2)
  const run = JSON.parse(await readFile(runPath, 'utf8'))
  if (!/^[0-9a-f]{40}$/u.test(run.head_sha)) throw new Error('Invalid source commit.')
  const source = (name) => JSON.parse(execFileSync('git', ['show', `${run.head_sha}:${name}`], { encoding: 'utf8' }))
  const policy = source('build/update-release-policy.json')
  const identity = validateSourceRun(run, tag, policy, source('package.json').version, source('core-runtime.lock.json'))
  const directory = resolve(outputDirectory)
  await mkdir(directory, { recursive: true })
  for (const [name, value] of Object.entries({
    'runtime.json': { core: identity.core },
    'policy.json': policy,
    'compatibility.json': source('build/update-compatibility.json'),
    'source.json': identity
  })) await writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`)
  console.log(JSON.stringify(identity))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
