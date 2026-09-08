import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import semver from 'semver'
import { assertReleaseIdentity } from './update-release-contract.mjs'

function usage() {
  return 'Usage: build-update-pointer.mjs --channel <candidate|stable> --version <semver> --output <path> [--current <path>]'
}

function parseArguments(argv) {
  const allowed = new Set(['--channel', '--version', '--output', '--current'])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(name) || !value || values.has(name)) throw new Error(usage())
    values.set(name, value)
  }
  for (const required of ['--channel', '--version', '--output']) {
    if (!values.has(required)) throw new Error(usage())
  }
  return Object.fromEntries(values)
}

function parseCurrent(value, channel) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Current update pointer must be an object.')
  }
  const keys = Object.keys(value).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['channel', 'schemaVersion', 'version'])) {
    throw new Error('Current update pointer contains missing or unknown fields.')
  }
  if (value.schemaVersion !== 1 || value.channel !== channel) {
    throw new Error('Current update pointer channel or schema is invalid.')
  }
  assertReleaseIdentity(value.channel, value.version)
  return value
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const channel = args['--channel']
  const version = args['--version']
  assertReleaseIdentity(channel, version)

  const currentPath = args['--current']
  if (currentPath) {
    try {
      const current = parseCurrent(
        JSON.parse(await readFile(resolve(currentPath), 'utf8')),
        channel
      )
      if (!semver.gt(version, current.version)) {
        throw new Error('The next update pointer version must be strictly newer.')
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error
    }
  }

  const pointer = { schemaVersion: 1, channel, version }
  await writeFile(resolve(args['--output']), `${JSON.stringify(pointer)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
}

await main()
