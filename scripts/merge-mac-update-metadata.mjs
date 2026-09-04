import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import semver from 'semver'
import { parseDocument, stringify } from 'yaml'

function parseMetadata(bytes, path) {
  const document = parseDocument(bytes.toString('utf8'))
  if (document.errors.length > 0) {
    throw new Error(`Invalid updater YAML ${path}: ${document.errors[0].message}`)
  }
  const value = document.toJS()
  if (
    !value ||
    typeof value !== 'object' ||
    semver.valid(value.version) !== value.version ||
    !Array.isArray(value.files) ||
    value.files.length === 0
  ) {
    throw new Error(`Invalid macOS updater metadata: ${path}`)
  }
  for (const file of value.files) {
    if (
      !file ||
      typeof file !== 'object' ||
      typeof file.url !== 'string' ||
      typeof file.sha512 !== 'string' ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0
    ) {
      throw new Error(`Invalid macOS updater file entry: ${path}`)
    }
  }
  return value
}

function metadataArchitecture(metadata, path) {
  const architectures = new Set()
  for (const file of metadata.files) {
    if (/-arm64\.(?:zip|dmg)$/u.test(file.url)) architectures.add('arm64')
    if (/-x64\.(?:zip|dmg)$/u.test(file.url)) architectures.add('x64')
  }
  if (architectures.size !== 1) {
    throw new Error(`macOS updater metadata must describe exactly one architecture: ${path}`)
  }
  return [...architectures][0]
}

async function verifyReferencedFiles(metadata, path) {
  const directory = dirname(path)
  const zipEntries = metadata.files.filter((file) => file.url.endsWith('.zip'))
  if (zipEntries.length !== 1) {
    throw new Error(`macOS updater metadata must contain exactly one ZIP: ${path}`)
  }

  for (const file of metadata.files) {
    const assetPath = join(directory, basename(file.url))
    const bytes = await readFile(assetPath)
    const fileStat = await stat(assetPath)
    const digest = createHash('sha512').update(bytes).digest('base64')
    if (fileStat.size !== file.size || digest !== file.sha512) {
      throw new Error(`macOS updater metadata does not match ${basename(assetPath)}.`)
    }
  }

  const blockmapPath = join(directory, `${basename(zipEntries[0].url)}.blockmap`)
  if ((await stat(blockmapPath)).size <= 0) {
    throw new Error(`Missing non-empty macOS ZIP blockmap: ${basename(blockmapPath)}`)
  }
}

async function main() {
  const [arm64Input, x64Input, output, ...rest] = process.argv.slice(2)
  if (!arm64Input || !x64Input || !output || rest.length > 0) {
    throw new Error(
      'Usage: merge-mac-update-metadata.mjs <arm64-yaml> <x64-yaml> <output-yaml>'
    )
  }

  const inputPaths = [resolve(arm64Input), resolve(x64Input)]
  const metadata = await Promise.all(
    inputPaths.map(async (path) => parseMetadata(await readFile(path), path))
  )
  const architectures = metadata.map((value, index) => metadataArchitecture(value, inputPaths[index]))
  if (new Set(architectures).size !== 2 || architectures[0] !== 'arm64' || architectures[1] !== 'x64') {
    throw new Error('macOS updater metadata inputs must be unique arm64 and x64 releases.')
  }
  if (metadata[0].version !== metadata[1].version) {
    throw new Error('macOS updater metadata versions do not match.')
  }

  await Promise.all(metadata.map((value, index) => verifyReferencedFiles(value, inputPaths[index])))
  const files = metadata.flatMap((value) => value.files)
    .sort((left, right) => left.url.localeCompare(right.url))
  const merged = {
    version: metadata[0].version,
    files,
    path: files.find((file) => file.url.endsWith('.zip'))?.url,
    sha512: files.find((file) => file.url.endsWith('.zip'))?.sha512,
    releaseDate: metadata.map((value) => value.releaseDate)
      .filter((value) => typeof value === 'string')
      .sort()
      .at(-1) ?? new Date().toISOString()
  }
  await writeFile(resolve(output), stringify(merged), 'utf8')
}

await main()
