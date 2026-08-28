import { createHash } from 'node:crypto'
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

  it('keeps valid system icon containers and guards the PNG source size', async () => {
    const [png, icns, ico, generator] = await Promise.all([
      readFile(buildPath('app-icon.png')),
      readFile(buildPath('icon.icns')),
      readFile(buildPath('icon.ico')),
      readFile(path.join(projectRoot, 'scripts', 'generate-app-icons.mjs'), 'utf8')
    ])

    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    expect(createHash('sha256').update(png).digest('hex')).toBe(
      'a4817096a7a28fdfa6cf825727c9128abc917626c0842d8f5218e0e5b6466c31'
    )
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(7)
    expect(generator).toContain('readUInt32BE(16)')
    expect(generator).toContain('must be a 1024x1024 PNG')
    expect(generator).not.toContain("execFileSync('iconutil'")
  })
})
