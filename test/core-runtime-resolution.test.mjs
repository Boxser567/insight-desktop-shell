import { createRequire } from 'node:module'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { resolveRuntimePackages } from '../scripts/core-runtime-resolution.mjs'
import { runtimeTypePaths } from '../scripts/prepare-runtime-types.mjs'
import { linkRuntimePackages } from './fixtures/link-runtime-packages.mjs'

let root, runtime, nested
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'runtime-resolution-')))
  runtime = join(root, 'runtime')
  nested = join(runtime, 'node_modules/owner/node_modules/@deepseek-ai/nested')
  await mkdir(nested, { recursive: true })
  await writeFile(join(runtime, 'package.json'), '{"name":"runtime"}')
  await writeFile(join(nested, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/nested', type: 'module', exports: {
      '.': { types: './index.d.ts', default: './index.js' },
      './client': { types: './client.d.ts', default: './index.js' }
    }
  }))
  await writeFile(join(nested, 'index.js'), 'export const value = 1')
  await writeFile(join(nested, 'index.d.ts'), 'export declare const value: number')
  await writeFile(join(nested, 'client.d.ts'), 'export declare const value: number')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function publicResolution(directory) {
  const boot = join(runtime, 'node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot')
  await mkdir(boot, { recursive: true })
  await writeFile(join(boot, 'package.json'), '{"name":"@deepseek-ai/dsh-app-boot","type":"module","exports":"./index.js"}')
  await writeFile(join(boot, 'index.js'), `export async function createRuntimeResolution() {
    return { entries: [{name: '@deepseek-ai/nested', packageDir: ${JSON.stringify(directory)}}] }
  }`)
}

it('uses Core public package locations for root and client types and standalone imports', async () => {
  await publicResolution(nested)
  const packages = await resolveRuntimePackages(runtime)
  expect(await runtimeTypePaths(['@deepseek-ai/nested', '@deepseek-ai/nested/client'], packages, runtime)).toEqual({
    '@deepseek-ai/nested': ['node_modules/owner/node_modules/@deepseek-ai/nested/index.d.ts'],
    '@deepseek-ai/nested/client': ['node_modules/owner/node_modules/@deepseek-ai/nested/client.d.ts']
  })
  const destination = join(root, 'fixture/node_modules')
  await linkRuntimePackages(runtime, destination)
  expect(createRequire(join(dirname(destination), 'package.json')).resolve('@deepseek-ai/nested')).toBe(join(nested, 'index.js'))
})

it('refuses package locations outside the selected Runtime', async () => {
  await publicResolution(root)
  await expect(resolveRuntimePackages(runtime)).rejects.toThrow('escapes the selected Runtime')
})

it('reports missing packages and unexported type subpaths instead of silently skipping them', async () => {
  const packages = new Map([['@deepseek-ai/nested', nested]])
  await expect(runtimeTypePaths(['@deepseek-ai/missing'], packages, runtime)).rejects.toThrow('does not provide')
  await expect(runtimeTypePaths(['@deepseek-ai/nested/private'], packages, runtime)).rejects.toThrow('does not export types')
})

it('refuses type declarations outside their package', async () => {
  await writeFile(join(nested, 'package.json'), '{"types":"../outside.d.ts"}')
  await expect(runtimeTypePaths(['@deepseek-ai/nested'], new Map([['@deepseek-ai/nested', nested]]), runtime))
    .rejects.toThrow('Invalid type export')
})
