import { mkdir, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveRuntimePackages } from '../../scripts/core-runtime-resolution.mjs'

/** Give standalone test processes the same installation packages as Core's profile loader. */
export async function linkRuntimePackages(runtimeRoot, destination) {
  for (const [name, directory] of await resolveRuntimePackages(runtimeRoot)) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u.test(name)) throw new Error(`Invalid Runtime package name: ${name}`)
    const link = join(destination, name)
    await mkdir(dirname(link), { recursive: true })
    await symlink(directory, link, process.platform === 'win32' ? 'junction' : 'dir')
  }
}
