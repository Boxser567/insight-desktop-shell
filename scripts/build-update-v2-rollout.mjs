import { createPrivateKey, sign, verify, createPublicKey } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import {
  UPDATE_V2_SCHEMAS,
  canonicalJsonBytes,
  parseCanonicalV2Envelope,
  parseV2RolloutPayload,
  sha512
} from './update-v2-contract.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArguments(argv) {
  const values = new Map()
  const pointers = []
  const names = new Set([
    '--track', '--version', '--target', '--referenced-file',
    '--minimum-supported-version', '--mode', '--private-key', '--out', '--current-pointer'
  ])
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!names.has(name) || !value) throw new Error(usage())
    if (name === '--current-pointer') pointers.push(value)
    else {
      if (values.has(name)) throw new Error(usage())
      values.set(name, value)
    }
  }
  for (const name of [
    '--track', '--version', '--referenced-file', '--minimum-supported-version',
    '--private-key', '--out'
  ]) if (!values.has(name)) throw new Error(usage())
  return { ...Object.fromEntries(values), pointers }
}

function usage() {
  return 'Usage: build-update-v2-rollout.mjs --track <candidate|stable> --version <semver> [--target <id>] --referenced-file <path> --minimum-supported-version <semver> [--mode <optional|required>] --private-key <path> --out <path> [--current-pointer <path> ...]'
}

async function pointerVersion(path, publicKey) {
  const bytes = await readFile(resolve(path))
  const value = JSON.parse(bytes.toString('utf8'))
  if (value?.schemaVersion === 1 && typeof value.version === 'string') return value.version
  const authenticated = parseCanonicalV2Envelope(bytes)
  if (!verify(null, authenticated.payloadBytes, publicKey, authenticated.signatureBytes)) {
    throw new Error(`Current v2 pointer signature is invalid: ${path}`)
  }
  return authenticated.payload.version
}

export async function buildV2Rollout(input) {
  const privateKeyPath = resolve(input.privateKeyPath)
  const keyRelative = relative(repositoryRoot, privateKeyPath)
  if (keyRelative === '' || (!keyRelative.startsWith('..') && !isAbsolute(keyRelative))) {
    throw new Error('The update signing private key must be stored outside the repository.')
  }
  const privateKey = createPrivateKey(await readFile(privateKeyPath, 'utf8'))
  const publicKey = createPublicKey(privateKey)
  for (const path of input.currentPointers) {
    const current = await pointerVersion(path, publicKey)
    if (semver.valid(current) !== current || !semver.gt(input.version, current)) {
      throw new Error(`Rollout version must exceed the global version floor: ${current}`)
    }
  }
  const referencedBytes = await readFile(resolve(input.referencedFile))
  const payload = parseV2RolloutPayload({
    schema: UPDATE_V2_SCHEMAS.rollout,
    state: 'active',
    track: input.track,
    version: input.version,
    ...(input.track === 'candidate' ? { target: input.target } : {}),
    referencedSha512: sha512(referencedBytes),
    policy: {
      mode: input.mode ?? 'optional',
      minimumSupportedVersion: input.minimumSupportedVersion
    },
    publishedAt: input.publishedAt ?? new Date().toISOString()
  })
  const payloadBytes = canonicalJsonBytes(payload)
  const envelope = {
    schema: UPDATE_V2_SCHEMAS.envelope,
    payloadBase64: payloadBytes.toString('base64'),
    signatureBase64: sign(null, payloadBytes, privateKey).toString('base64')
  }
  await writeFile(resolve(input.out), canonicalJsonBytes(envelope))
  return envelope
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  await buildV2Rollout({
    track: args['--track'],
    version: args['--version'],
    target: args['--target'],
    referencedFile: args['--referenced-file'],
    minimumSupportedVersion: args['--minimum-supported-version'],
    mode: args['--mode'] ?? 'optional',
    privateKeyPath: args['--private-key'],
    out: args['--out'],
    currentPointers: args.pointers
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
