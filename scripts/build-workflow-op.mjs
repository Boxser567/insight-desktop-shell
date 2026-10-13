import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = join(root, 'packages', 'insight-workflow-op')
await mkdir(join(packageRoot, 'lib'), { recursive: true })
await build({
  entryPoints: [join(packageRoot, 'src', 'index.ts')],
  outfile: join(packageRoot, 'lib', 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  alias: {
    '@insight-ai/insight-workflow-protocol': join(root, 'packages', 'insight-workflow-protocol', 'src', 'index.ts')
  },
  external: ['@deepseek-ai/*'],
  legalComments: 'none'
})
