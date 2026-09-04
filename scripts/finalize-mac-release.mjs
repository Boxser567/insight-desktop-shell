import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import semver from 'semver'

async function main() {
  const [releaseDirectory, archiveName, ...rest] = process.argv.slice(2)
  if (!releaseDirectory || !archiveName || rest.length > 0) {
    throw new Error('Usage: finalize-mac-release.mjs <release-dir> <zip-name>')
  }

  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  const version = packageJson.version
  if (semver.valid(version) !== version) {
    throw new Error('package.json must contain a valid semantic version.')
  }

  const match = /^(insight-candidate|insight)-mac-(arm64|x64)\.zip$/u.exec(archiveName)
  if (!match) throw new Error(`Unexpected macOS release archive: ${archiveName}`)
  const expectedPrefix = semver.prerelease(version)?.[0] === 'rc'
    ? 'insight-candidate'
    : 'insight'
  if (match[1] !== expectedPrefix) {
    throw new Error(`macOS release archive does not match version ${version}.`)
  }

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
