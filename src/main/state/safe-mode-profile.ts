import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DESKTOP_INTEGRATION_PACKAGE } from './installation-owned-bundles'

export const SAFE_MODE_PROFILE = 'desktop-safe-mode'
export const SAFE_MODE_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  DESKTOP_INTEGRATION_PACKAGE
] as const

const SAFE_MODE_PATCH = `# Managed by DSH Desktop Safe Mode.
# Third-party bundles and the normal web profile's patch layer are intentionally omitted.
[]
`

const SAFE_MODE_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    if (await readFile(path, 'utf8') === content) return
  } catch {
    // Missing or unreadable managed files are recreated below.
  }
  await writeFile(path, content, 'utf8')
}

async function linkDesktopIntegration(dshHome: string, safeModeDirectory: string): Promise<void> {
  const source = join(
    dshHome,
    'profiles',
    'web',
    'packages',
    'insight-desktop-integration'
  )
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error('The managed desktop Gateway integration is unavailable in Safe Mode.')
  }
  const destination = join(
    safeModeDirectory,
    'node_modules',
    '@insight-ai',
    'desktop-integration'
  )
  await mkdir(join(safeModeDirectory, 'node_modules', '@insight-ai'), { recursive: true })
  await rm(destination, { recursive: true, force: true })
  await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
}

/**
 * Materialize an isolated profile that resolves only installation-owned core
 * bundles plus the desktop Gateway. It shares DSH_HOME settings, credentials,
 * sessions, and workspaces with the normal profile, but never reads that
 * profile's bundle list or user patch layer.
 */
export async function ensureSafeModeProfile(dshHome: string): Promise<string> {
  const directory = join(dshHome, 'profiles', SAFE_MODE_PROFILE)
  await mkdir(directory, { recursive: true })
  const manifest = `${JSON.stringify({
    name: 'dsh-profile-desktop-safe-mode',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...SAFE_MODE_BUNDLES] } }
  }, null, 2)}\n`
  await Promise.all([
    writeIfChanged(join(directory, 'package.json'), manifest),
    writeIfChanged(join(directory, 'cordis.patch.yml'), SAFE_MODE_PATCH),
    writeIfChanged(join(directory, 'pnpm-workspace.yaml'), SAFE_MODE_WORKSPACE)
  ])
  await linkDesktopIntegration(dshHome, directory)
  return directory
}
