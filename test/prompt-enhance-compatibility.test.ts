import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// @ts-expect-error build script has no declaration file
import { adaptPromptEnhanceClient } from '../scripts/patch-bundled-prompt-enhance.mjs'
import { refreshPromptEnhanceCompatibility } from '../src/main/state/bundled-profile'

const original = 'const imageCount = useInput((state) => countOf(state.imageIds));'
const adapted = 'const imageCount = useInput((state) => countOf(state.attachmentIds));'
const themed = `${adapted}\nconst scope = settingsCtx.configForms.get(NS);\nbody:not([data-ds-dark-theme]) .dsh-pe-panel { color: black; }`
describe('prompt-enhance Core attachment compatibility', () => {
  it('adapts the removed input field and is idempotent', () => {
    expect(adaptPromptEnhanceClient(original)).toBe(adapted)
    expect(adaptPromptEnhanceClient(adapted)).toBe(adapted)
    expect(() => adaptPromptEnhanceClient('unknown client')).toThrow(/Review/)
  })
  it('follows shared configuration forms and decodes every settings refresh', () => {
    const source = `${adapted}
var inject = [];
ctx.inject(["settingsScope"], (settingsCtx) => {
  const scope = settingsCtx.settingsScope.bind({ namespace: NS, decode: decodeClientSettings });
  const sync = () => { setClientSettings(scope.getSnapshot().value ?? decodeClientSettings(void 0)); };
  sync(); ctx.effect(() => scope.subscribe(sync));
});`
    const patched = adaptPromptEnhanceClient(source)
    expect(adaptPromptEnhanceClient(patched)).toBe(patched)
    expect(patched).not.toContain('settingsScope')
    let value: unknown
    let listener: () => void = () => {}
    const updates: unknown[] = []
    const scope = { getSnapshot: () => ({ value }), subscribe: (callback: () => void) => { listener = callback; return () => {} } }
    const ctx = { configForms: { get: (namespace: string) => { expect(namespace).toBe('prompt'); return scope } },
      inject: (services: string[], callback: (context: unknown) => void) => { expect(services).toEqual(['configForms']); callback(ctx) },
      effect: (callback: () => unknown) => callback() }
    const execute = new Function('ctx', 'useInput', 'NS', 'decodeClientSettings', 'setClientSettings', 'countOf', `${patched}; return inject;`)
    expect(execute(ctx, (read: (input: unknown) => unknown) => read({ attachmentIds: [] }), 'prompt',
      (input: unknown) => input ?? { enabled: true }, (next: unknown) => updates.push(next), (input: unknown[]) => input.length)).toEqual([])
    value = { enabled: false }
    listener()
    expect(updates).toEqual([{ enabled: true }, { enabled: false }])
    expect(() => adaptPromptEnhanceClient(`${adapted}\nsettingsScope changed`)).toThrow(/Review/)
  })
  it('repairs a registry reinstall but preserves a user upgrade or removal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'insight-prompt-compat-'))
    const source = join(root, 'source')
    const destination = join(root, 'destination')
    const relative = 'node_modules/dsh-prompt-enhance'
    try {
      for (const profile of [source, destination]) {
        await mkdir(join(profile, relative, 'lib'), { recursive: true })
        await writeFile(join(profile, relative, 'package.json'), JSON.stringify({ version: '0.2.7' }))
      }
      await writeFile(join(source, relative, 'lib/client.js'), themed)
      await writeFile(join(destination, relative, 'lib/client.js'), original)
      await refreshPromptEnhanceCompatibility(source, destination)
      expect(await readFile(join(destination, relative, 'lib/client.js'), 'utf8')).toBe(themed)
      await writeFile(join(destination, relative, 'package.json'), JSON.stringify({ version: '0.2.8' }))
      await writeFile(join(destination, relative, 'lib/client.js'), 'user upgraded')
      await refreshPromptEnhanceCompatibility(source, destination)
      expect(await readFile(join(destination, relative, 'lib/client.js'), 'utf8')).toBe('user upgraded')
      await rm(join(destination, relative), { recursive: true })
      await refreshPromptEnhanceCompatibility(source, destination)
      await expect(readFile(join(destination, relative, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
