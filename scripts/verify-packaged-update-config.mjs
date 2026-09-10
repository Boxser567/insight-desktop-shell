import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

const expectedProvider = 'generic'
const expectedUrl = 'https://updates.insight-aigc.com/desktop/'
const expectedCacheDirectory = 'insight-desktop-updater'

export async function verifyPackagedUpdateConfig(resourcesDirectory) {
  if (typeof resourcesDirectory !== 'string' || resourcesDirectory.trim() === '') {
    throw new Error('Packaged Resources directory is required.')
  }

  const configPath = join(resolve(resourcesDirectory), 'app-update.yml')
  let config
  try {
    config = parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`Packaged updater configuration is missing: ${configPath}`)
    }
    throw error
  }

  if (
    !config ||
    typeof config !== 'object' ||
    config.provider !== expectedProvider ||
    config.url !== expectedUrl ||
    config.updaterCacheDirName !== expectedCacheDirectory
  ) {
    throw new Error('Packaged updater configuration does not match the OSS update contract.')
  }

  const serialized = JSON.stringify(config)
  if (/github|bucket|access.?key|secret/iu.test(serialized)) {
    throw new Error('Packaged updater configuration contains a forbidden publication detail.')
  }

  return { configPath, provider: config.provider, url: config.url }
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error('Usage: verify-packaged-update-config.mjs <resources-directory>')
  }
  const result = await verifyPackagedUpdateConfig(process.argv[2])
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
