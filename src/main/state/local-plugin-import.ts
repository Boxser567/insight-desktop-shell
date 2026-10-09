import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'

/** A local package path that can be passed to `dsh plugin add`. */
export interface LocalPluginImport {
  path: string
  kind: 'directory' | 'archive'
}

/** Validate the two local package forms exposed by the desktop picker. */
export async function resolveLocalPluginImport(path: string): Promise<LocalPluginImport> {
  if (!isAbsolute(path)) throw new Error('The selected plugin path must be absolute.')

  let details
  try {
    details = await stat(path)
  } catch {
    throw new Error('The selected plugin no longer exists.')
  }

  if (details.isFile() && path.toLowerCase().endsWith('.tgz')) {
    return { path, kind: 'archive' }
  }
  if (details.isDirectory()) {
    try {
      const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')) as {
        name?: unknown
      }
      if (typeof manifest.name === 'string' && manifest.name.length > 0) {
        return { path, kind: 'directory' }
      }
    } catch {
      // The user-facing error below names the only directory requirement.
    }
    throw new Error('The selected plugin folder must contain a package.json with a name.')
  }
  throw new Error('Choose a plugin folder or a .tgz package archive.')
}

/** Archive installs must remain repairable after the selected download is removed. */
export async function stageLocalPluginImport(
  dshHome: string,
  plugin: LocalPluginImport
): Promise<LocalPluginImport> {
  if (plugin.kind === 'directory') return plugin
  const directory = join(dshHome, 'profiles', 'web', '.insight-local-plugins')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `${randomUUID()}.tgz`)
  await copyFile(plugin.path, path, constants.COPYFILE_EXCL)
  return { path, kind: 'archive' }
}

/** Attribute an exact missing archive path, never a similarly named unrelated file. */
export async function missingLocalArchivePlugins(dshHome: string, message: string): Promise<string[]> {
  if (!message.includes('ENOENT')) return []
  const directory = join(dshHome, 'profiles', 'web')
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    return Object.entries(manifest.dependencies ?? {}).flatMap(([name, spec]) => {
      if (typeof spec !== 'string' || !spec.startsWith('file:') || !spec.toLowerCase().endsWith('.tgz')) return []
      const path = resolve(directory, spec.slice(5))
      return message.includes(`'${path}'`) || message.includes(`"${path}"`) ? [name] : []
    })
  } catch {
    return []
  }
}
