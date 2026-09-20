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
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-settings-general',
      '@deepseek-ai/dsh-api-workspace-files'
    ]))
    expect(manifest.publishConfig).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
  })

  it('replaces the official brand and inserts one product integration row', async () => {
    const patch = parse(await readFile(new URL('cordis.patch.yml', packageRoot), 'utf8'))

    expect(patch).toEqual([
      { id: 'ui-brand-official', disabled: true },
      { id: 'agent-default-model', config: { provider: 'yinsai-gateway', model: 'deepseek-flash' } },
      { id: 'llm-deepseek', disabled: true },
      { id: 'llm-pi-ai', disabled: true },
      { id: 'web-search-deepseek', disabled: true },
      { id: 'ui-settings-models', disabled: true },
      { insert: [{ id: 'insight-desktop-integration', name: '@insight-ai/desktop-integration' }] }
    ])
  })

  it('injects the web seam and registers the authenticated search lifecycle', async () => {
    const source = await readFile(new URL('src/index.ts', packageRoot), 'utf8')

    expect(source).toContain("export const inject = ['llm', 'web']")
    expect(source).toContain('ctx.web.registerSearchProvider')
    expect(source).toContain('unregisterSearch()')
  })

  it('uses the shared desktop service environment for the model Gateway', async () => {
    const source = await readFile(new URL('src/model-gateway.ts', packageRoot), 'utf8')

    expect(source).toContain('desktopServiceEnvironment().modelBaseUrl')
    expect(source).toContain("protocol: 'chat-completions'")
    expect(source).not.toContain('gapi-test.insight-aigc.com')
    expect(source).not.toContain('gapi.insight-aigc.com')
  })
})
