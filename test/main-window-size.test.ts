import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('main window size', () => {
  it('opens at a compact 1K size with a low-height login fallback', async () => {
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')
    const styles = await readFile(
      path.join(projectRoot, 'src', 'renderer', 'src', 'styles.css'),
      'utf8'
    )

    expect(main).toContain('width: 1024')
    expect(main).toContain('height: 720')
    expect(main).toContain('minWidth: 800')
    expect(main).toContain('minHeight: 480')
    expect(styles).toContain('overflow-y: auto')
    expect(styles).toContain('@media (max-height: 600px)')
    expect(styles).toContain('place-items: start center')
  })
})
