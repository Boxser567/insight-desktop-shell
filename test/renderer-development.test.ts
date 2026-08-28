import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { relaxRendererCspForDevelopment } from '../src/renderer/development-csp'

describe('Renderer development configuration', () => {
  it('allows Vite HMR without weakening the packaged CSP', async () => {
    const productionHtml = await readFile('src/renderer/index.html', 'utf8')
    const developmentHtml = relaxRendererCspForDevelopment(productionHtml)

    expect(productionHtml).toContain("style-src 'self';")
    expect(productionHtml).toContain("connect-src 'none'")
    expect(developmentHtml).toContain("style-src 'self' 'unsafe-inline';")
    expect(developmentHtml).toContain(
      "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"
    )
  })

  it('uses the automatic JSX runtime for every Renderer component', async () => {
    const config = await readFile('electron.vite.config.ts', 'utf8')

    expect(config).toContain("jsx: 'automatic'")
  })
})
