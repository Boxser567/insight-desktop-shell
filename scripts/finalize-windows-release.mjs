import { createHash } from 'node:crypto'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import semver from 'semver'

const require = createRequire(import.meta.url)
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap')

async function findInstaller(releaseDir) {
  const entries = await readdir(releaseDir, { withFileTypes: true })
  const installers = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => join(releaseDir, entry.name))
  if (installers.length !== 1) {
    throw new Error(`Expected exactly one Windows installer, found ${installers.length}.`)
  }
  return installers[0]
}

function validatePe(bytes, filename, expectedMachine) {
  if (bytes.length < 70 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error(`Windows executable has an invalid DOS header: ${filename}`)
  }
  const peOffset = bytes.readUInt32LE(0x3c)
  if (
    peOffset < 0x40 ||
    peOffset + 6 > bytes.length ||
    bytes.readUInt32LE(peOffset) !== 0x00004550
  ) {
    throw new Error(`Windows executable has an invalid PE signature: ${filename}`)
  }
  if (expectedMachine !== undefined && bytes.readUInt16LE(peOffset + 4) !== expectedMachine) {
    throw new Error(`Packaged Windows application is not x64: ${filename}`)
  }
}

async function finalizeRelease(releaseDir, version, appExecutable) {
  const installer = await findInstaller(releaseDir)
  const [installerBytes, appBytes] = await Promise.all([
    readFile(installer),
    readFile(appExecutable)
  ])
  validatePe(installerBytes, basename(installer))
  validatePe(appBytes, basename(appExecutable), 0x8664)
  const blockmap = `${installer}.blockmap`
  await rm(blockmap, { force: true })
  const updateInfo = await buildBlockMap(installer, 'gzip', blockmap)
  const fileStat = await stat(installer)
  const digest = createHash('sha512').update(installerBytes).digest('base64')
  if (updateInfo.size !== fileStat.size || updateInfo.sha512 !== digest) {
    throw new Error('Generated update metadata does not match the Windows installer.')
  }

  const filename = basename(installer)
  const metadata = [
    `version: ${version}`,
    'files:',
    `  - url: ${JSON.stringify(filename)}`,
    `    sha512: ${digest}`,
    `    size: ${fileStat.size}`,
    `path: ${JSON.stringify(filename)}`,
    `sha512: ${digest}`,
    `releaseDate: ${JSON.stringify(new Date().toISOString())}`,
    ''
  ].join('\n')
  await writeFile(join(releaseDir, 'latest.yml'), metadata, 'utf8')
  return { installer, blockmap }
}

const [releaseDirArg, version, appExecutableArg] = process.argv.slice(2)
if (!releaseDirArg || semver.valid(version) !== version || !appExecutableArg) {
  throw new Error(
    'Usage: finalize-windows-release.mjs <release-dir> <semver> <app-executable>'
  )
}

const result = await finalizeRelease(resolve(releaseDirArg), version, resolve(appExecutableArg))
console.log(`Finalized Windows installer metadata for ${basename(result.installer)}.`)
