import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UPDATE_V2_SCHEMAS,
  UPDATE_V2_TARGET_IDS,
  assertReleaseIndexMatchesTargets,
  parseV2ReleaseIndex,
  parseV2TargetManifest
} from './update-v2-contract.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArguments(argv) {
  const names = new Set(['--dir', '--version', '--private-key'])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!names.has(name) || !value || values.has(name)) throw new Error(usage())
    values.set(name, value)
  }
  if ([...names].some((name) => !values.has(name))) throw new Error(usage())
  return Object.fromEntries(values)
}

function usage() {
  return 'Usage: build-update-v2-index.mjs --dir <release-root> --version <final-semver> --private-key <path>'
}

export async function buildV2Index(input) {
  const releaseDir = resolve(input.releaseDir)
  const privateKeyPath = resolve(input.privateKeyPath)
  const keyRelative = relative(repositoryRoot, privateKeyPath)
  if (keyRelative === '' || (!keyRelative.startsWith('..') && !isAbsolute(keyRelative))) {
    throw new Error('The update signing private key must be stored outside the repository.')
  }
  const privateKey = createPrivateKey(await readFile(privateKeyPath, 'utf8'))
  const publicKey = createPublicKey(privateKey)
  const authenticatedTargets = await Promise.all(UPDATE_V2_TARGET_IDS.map(async (id) => {
    const targetDir = join(releaseDir, 'targets', id)
    const [manifestBytes, signatureBytes] = await Promise.all([
      readFile(join(targetDir, 'insight-target.json')),
      readFile(join(targetDir, 'insight-target.json.sig'))
    ])
    if (!verify(null, manifestBytes, publicKey, signatureBytes)) {
      throw new Error(`Target Manifest signature is invalid: ${id}`)
    }
    const manifest = parseV2TargetManifest(JSON.parse(manifestBytes.toString('utf8')))
    if (`${manifest.target.platform}-${manifest.target.arch}` !== id) {
      throw new Error(`Target Manifest is stored under the wrong target: ${id}`)
    }
    return { manifest, manifestBytes }
  }))
  const first = authenticatedTargets[0]?.manifest
  if (!first) throw new Error('Release Index target set is empty.')
  const index = parseV2ReleaseIndex({
    schema: UPDATE_V2_SCHEMAS.release,
    version: input.version,
    shellCommit: first.shellCommit,
    coreRuntime: first.coreRuntime,
    targets: authenticatedTargets.map(({ manifest, manifestBytes }) => ({
      id: `${manifest.target.platform}-${manifest.target.arch}`,
      manifestSha512: createHash('sha512').update(manifestBytes).digest('base64')
    }))
  })
  assertReleaseIndexMatchesTargets(index, authenticatedTargets)
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`)
  const signature = sign(null, indexBytes, privateKey)
  await mkdir(releaseDir, { recursive: true })
  await Promise.all([
    writeFile(join(releaseDir, 'insight-release.json'), indexBytes),
    writeFile(join(releaseDir, 'insight-release.json.sig'), signature)
  ])
  return index
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  await buildV2Index({
    releaseDir: args['--dir'],
    version: args['--version'],
    privateKeyPath: args['--private-key']
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
