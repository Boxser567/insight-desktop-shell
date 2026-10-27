import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRuntimePackages } from './core-runtime-resolution.mjs'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const specifiers = [
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-agent-preset-registry',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-working-directory',
  '@deepseek-ai/dsh-shell-env',
  '@deepseek-ai/dsh-web',
  '@deepseek-ai/dsh-web-search-deepseek',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-remotes/client',
  '@deepseek-ai/dsh-api-session-controller/remote',
  '@deepseek-ai/dsh-api-workspace-files/remote',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-session/types',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-ui-layout/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-sidebar/client',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-settings-general/client',
  '@deepseek-ai/dsh-client-ui-renderer/client',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-ui-skill/client'
]

/** Resolve only published type exports from the selected Runtime's package map. */
export async function runtimeTypePaths(requests, packages, root) {
  const paths = {}
  for (const specifier of requests) {
    const [scope, name, ...subpath] = specifier.split('/')
    const directory = packages.get(`${scope}/${name}`)
    if (!directory) throw new Error(`Core Runtime does not provide ${specifier}.`)
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    const types = manifest.exports?.[subpath.length ? `./${subpath.join('/')}` : '.']?.types ??
      (subpath.length ? undefined : manifest.types)
    if (typeof types !== 'string') throw new Error(`Core Runtime does not export types for ${specifier}.`)
    const declaration = resolve(directory, types)
    const suffix = relative(directory, declaration)
    if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) throw new Error(`Invalid type export for ${specifier}.`)
    await access(declaration)
    paths[specifier] = [relative(root, declaration).split(sep).join('/')]
  }
  return paths
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packages = await resolveRuntimePackages(join(projectRoot, 'build/core-runtime'))
  const paths = await runtimeTypePaths(specifiers, packages, projectRoot)
  await mkdir(join(projectRoot, 'build'), { recursive: true })
  await writeFile(join(projectRoot, 'build/core-runtime-types.json'), `${JSON.stringify({
    compilerOptions: { baseUrl: '..', paths }
  }, null, 2)}\n`)
}
