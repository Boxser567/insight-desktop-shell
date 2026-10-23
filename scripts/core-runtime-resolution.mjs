import { createRequire } from 'node:module'
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Read Core's public installation package map without assuming a hoisting layout. */
export async function resolveRuntimePackages(runtimeRoot) {
  const root = await realpath(runtimeRoot)
  const installAnchor = join(root, 'package.json')
  const require = createRequire(join(root, 'node_modules/@deepseek-ai/dsh/package.json'))
  const { createRuntimeResolution } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
  const resolution = await createRuntimeResolution({ installAnchor })
  const packages = new Map()
  for (const { name, packageDir } of resolution.entries) {
    const directory = await realpath(packageDir)
    const suffix = relative(root, directory)
    if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) {
      throw new Error(`Core Runtime package escapes the selected Runtime: ${name}`)
    }
    packages.set(name, directory)
  }
  return packages
}
