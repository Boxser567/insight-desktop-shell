import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export interface CoreRuntimePaths {
  root: string
  runtimeManifestPath: string
  dshEntryPath: string
  nodeExecutablePath: string
  pnpmEntryPath: string
}

/** Resolve the selected Core Runtime embedded below an Electron resource root. */
export function resolveCoreRuntime(resourceRoot: string, platform: NodeJS.Platform = process.platform): CoreRuntimePaths {
  const join = platform === 'win32' ? win32.join : posix.join
  const root = join(resourceRoot, 'runtime')
  const pnpmRoot = join(root, 'node_modules', 'pnpm', 'bin')
  const pnpmCjs = join(pnpmRoot, 'pnpm.cjs')
  return {
    root,
    runtimeManifestPath: join(root, 'runtime.json'),
    dshEntryPath: join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    nodeExecutablePath: join(root, 'node_modules', 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node'),
    pnpmEntryPath: existsSync(pnpmCjs) ? pnpmCjs : join(pnpmRoot, 'pnpm.mjs')
  }
}
