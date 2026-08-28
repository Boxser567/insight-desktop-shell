import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')
const buildPath = (name: string): string => path.join(projectRoot, 'build', name)

describe('desktop brand assets', () => {
  it('keeps one mark and one wordmark as the editable logo sources', async () => {
    const mark = await readFile(buildPath('brand-mark.svg'), 'utf8')
    const wordmark = await readFile(buildPath('brand-wordmark.svg'), 'utf8')

    expect(mark).toContain('viewBox="0 0 36.954833984375 32.00146484375"')
    expect(wordmark).toContain('viewBox="0 0 111.268310546875 28"')
    expect(wordmark).not.toContain('<image')
  })

  it('does not retain legacy whale or loader aliases', () => {
    for (const name of [
      'dsh-loader.gif',
      'dsh-loader-dark.gif',
      'logo-light.png',
      'logo-dark.png',
      'logo-light.svg',
      'icon.png',
      'insight-logo.svg'
    ]) {
      expect(existsSync(buildPath(name)), name).toBe(false)
    }
  })

  it('packages the canonical wordmark without legacy loaders', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { build: { extraResources: Array<{ from: string; to: string }> } }

    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/brand-wordmark.svg',
      to: 'brand-wordmark.svg'
    })
    expect(packageJson.build.extraResources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: expect.stringContaining('dsh-loader') }),
        expect.objectContaining({ from: 'build/insight-logo.svg' })
      ])
    )
  })

  it('uses the product name in Shell-owned recovery errors', async () => {
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')

    expect(main).toContain("dialog.showErrorBox('因赛AI encountered an error', message)")
    expect(main).not.toContain("dialog.showErrorBox('DSH Desktop encountered an error'")
  })
})
