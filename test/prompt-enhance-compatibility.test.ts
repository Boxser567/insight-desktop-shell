import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// @ts-expect-error build script has no declaration file
import { adaptPromptEnhanceClient } from '../scripts/patch-bundled-prompt-enhance.mjs'
import { refreshPromptEnhanceCompatibility } from '../src/main/state/bundled-profile'

const original = 'const imageCount = useInput((state) => state.imageIds.length);'
const adapted = 'const imageCount = useInput((state) => state.attachmentIds.length);'
describe('prompt-enhance Core attachment compatibility', () => {
  it('adapts the removed input field and is idempotent', () => {
    expect(adaptPromptEnhanceClient(original)).toBe(adapted)
    expect(adaptPromptEnhanceClient(adapted)).toBe(adapted)
    expect(() => adaptPromptEnhanceClient('unknown client')).toThrow(/Review/)
  })
  it('repairs a registry reinstall but preserves a user upgrade or removal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'insight-prompt-compat-'))
    const source = join(root, 'source')
    const destination = join(root, 'destination')
    const relative = 'node_modules/dsh-prompt-enhance'
    try {
      for (const profile of [source, destination]) {
        await mkdir(join(profile, relative, 'lib'), { recursive: true })
        await writeFile(join(profile, relative, 'package.json'), JSON.stringify({ version: '0.1.9' }))
      }
      await writeFile(join(source, relative, 'lib/client.js'), adapted)
      await writeFile(join(destination, relative, 'lib/client.js'), original)
      await refreshPromptEnhanceCompatibility(source, destination)
      expect(await readFile(join(destination, relative, 'lib/client.js'), 'utf8')).toBe(adapted)
      await writeFile(join(destination, relative, 'package.json'), JSON.stringify({ version: '0.2.0' }))
      await writeFile(join(destination, relative, 'lib/client.js'), 'user upgraded')
      await refreshPromptEnhanceCompatibility(source, destination)
      expect(await readFile(join(destination, relative, 'lib/client.js'), 'utf8')).toBe('user upgraded')
      await rm(join(destination, relative), { recursive: true })
      await refreshPromptEnhanceCompatibility(source, destination)
      await expect(readFile(join(destination, relative, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
