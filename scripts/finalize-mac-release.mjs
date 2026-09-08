import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { assertReleaseIdentity, macArchiveName } from './update-release-contract.mjs'

async function main() {
  const [releaseDirectory, channel, version, arch, ...rest] = process.argv.slice(2)
  if (!releaseDirectory || !channel || !version || !arch || rest.length > 0) {
    throw new Error('Usage: finalize-mac-release.mjs <release-dir> <candidate|stable> <semver> <arm64|x64>')
  }
  assertReleaseIdentity(channel, version)
  const archiveName = macArchiveName(channel, version, arch)

  const directory = resolve(releaseDirectory)
  const archivePath = join(directory, basename(archiveName))
  const blockmapPath = `${archivePath}.blockmap`
  const [archive, archiveStat, blockmapStat] = await Promise.all([
    readFile(archivePath),
    stat(archivePath),
    stat(blockmapPath)
  ])
  if (archiveStat.size <= 0 || blockmapStat.size <= 0) {
    throw new Error('macOS release ZIP and blockmap must be non-empty.')
  }

  const digest = createHash('sha512').update(archive).digest('base64')
  const metadata = [
    `version: ${version}`,
    'files:',
    `  - url: ${JSON.stringify(archiveName)}`,
    `    sha512: ${digest}`,
    `    size: ${archiveStat.size}`,
    `path: ${JSON.stringify(archiveName)}`,
    `sha512: ${digest}`,
    `releaseDate: ${JSON.stringify(new Date().toISOString())}`,
    ''
  ].join('\n')
  await writeFile(join(directory, 'latest-mac.yml'), metadata, 'utf8')
  console.log(`Finalized macOS update metadata for ${archiveName}.`)
}

await main()
