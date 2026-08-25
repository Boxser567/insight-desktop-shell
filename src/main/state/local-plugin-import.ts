import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

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
