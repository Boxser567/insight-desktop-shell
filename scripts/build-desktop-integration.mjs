import { build } from 'esbuild'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = join(root, 'packages', 'insight-desktop-integration')
const output = join(packageRoot, 'lib')
const moduleId = '@insight-ai/desktop-integration'

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

await build({
  entryPoints: [join(packageRoot, 'src', 'index.ts')],
  outfile: join(output, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  legalComments: 'none'
})

const result = await build({
  entryPoints: [join(packageRoot, 'src', 'client', 'index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  legalComments: 'none',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
  loader: { '.svg': 'dataurl' },
  write: false
})
const client = result.outputFiles[0]?.text
if (client === undefined) throw new Error('Desktop integration client build produced no JavaScript output.')

await writeFile(
  join(output, 'client.js'),
  `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(moduleId)},\n  factory: (require) => {\n    const module = { exports: {} }\n    const exports = module.exports\n${client.split('\n').map(line => `    ${line}`).join('\n')}\n    return module.exports\n  }\n})\n`,
  'utf8'
)
