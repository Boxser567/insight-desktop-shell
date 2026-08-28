import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const packageRoot = new URL('../packages/insight-desktop-integration/', import.meta.url)

describe('desktop integration package', () => {
  it('defines an installation-owned client bundle without registry metadata', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))

    expect(manifest.name).toBe('@insight-ai/desktop-integration')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.private).toBe(true)
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-settings-general'
    ]))
    expect(manifest.publishConfig).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
  })

  it('replaces the official brand and inserts one product integration row', async () => {
    const patch = parse(await readFile(new URL('cordis.patch.yml', packageRoot), 'utf8'))

    expect(patch).toEqual([
      { id: 'ui-brand-official', disabled: true },
      { insert: [{ id: 'insight-desktop-integration', name: '@insight-ai/desktop-integration' }] }
    ])
  })
})
