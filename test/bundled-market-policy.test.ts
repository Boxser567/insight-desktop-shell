import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { patchBundledMarket } from '../scripts/patch-bundled-market.mjs'

describe('bundled market host policy', () => {
  const testDirectory = join(__dirname, '.temp-bundled-market-policy')

  afterEach(async () => {
    await rm(testDirectory, { recursive: true, force: true })
  })

  it('prevents market mutation of required desktop capabilities', async () => {
    const library = join(testDirectory, 'node_modules', 'dshmarket', 'lib')
    await mkdir(library, { recursive: true })
    await writeFile(
      join(library, 'patch.js'),
      "const PROTECTED_MODULE_PATTERNS = [\n    /^cordis:/u,\n];\n",
      'utf8'
    )
    await writeFile(
      join(library, 'routes.js'),
      [
        "path: '/dsh-market/update'",
        "                        const name = typeof body.name === 'string' ? body.name : '';",
        "path: '/dsh-market/uninstall'",
        "                        const name = typeof body.name === 'string' ? body.name : '';",
        "path: '/dsh-market/install'"
      ].join('\n'),
      'utf8'
    )

    await patchBundledMarket(testDirectory)
    await patchBundledMarket(testDirectory)

    const patch = await readFile(join(library, 'patch.js'), 'utf8')
    const routes = await readFile(join(library, 'routes.js'), 'utf8')
    expect(patch.match(/dsh-better-sidebar/g)).toHaveLength(1)
    expect(patch.match(/@insight-ai\\\/desktop-integration/g)).toHaveLength(1)
    expect(routes.match(/Insight Desktop protects required capabilities/g)).toHaveLength(2)
    expect(routes).toContain('isProtectedModule(name)')
    expect(routes).toContain('cannot be updated from the plugin market')
    expect(routes).toContain('cannot be uninstalled from the plugin market')
  })
})
