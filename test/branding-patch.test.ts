import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasPatch, patchPath, projectRoot } from './patch-path'

const shellClient = path.join(projectRoot, 'packages', 'dsh-desktop-shell', 'client.js')

describe('DSH Desktop sidebar branding', () => {
  it('matches the native window surface to the initial Harness theme', async () => {
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')

    expect(main).toContain("frame: process.platform !== 'darwin'")
    expect(main).toContain("document.body.hasAttribute('data-ds-dark-theme')")
    expect(main).toContain("window.setBackgroundColor(isDark ? '#141416' : '#ffffff')")
    expect(main).toContain('window.setWindowButtonVisibility(true)')
    expect(main).toContain('window.setWindowButtonPosition({ x: 12, y: 9 })')
    expect(main).not.toContain('dsh-desktop-titlebar-style')
    expect(main).not.toContain('--dsh-desktop-titlebar-height')
    expect(main).not.toContain('body { box-sizing: border-box; padding-top:')
    expect(main).toContain("dragRegion.id = 'dsh-desktop-drag-region'")
    expect(main).toContain("dragRegion.style.setProperty('-webkit-app-region', 'drag')")
    expect(main).toContain("left: '80px'")
    expect(main).toContain("right: '220px'")
    expect(main).toContain("height: '24px'")
  })

  it('leaves the official single-occupant brand slots to Harness', async () => {
    const client = await readFile(shellClient, 'utf8')

    expect(client).not.toContain("name: 'sidebar.brand.mark'")
    expect(client).not.toContain("name: 'sidebar.brand.name'")
    expect(client).toContain("name: 'sidebar.footer.action'")
  })

  it('keeps the desktop shell out of ui-sidebar so upgrades carry no patch', async () => {
    const composition = await readFile(
      path.join(projectRoot, 'build', 'dsh-desktop.patch.yml'),
      'utf8'
    )
    const manifest = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> }

    expect(composition).toContain('name: dsh-desktop-shell')
    expect(manifest.dependencies['dsh-desktop-shell']).toBe('file:packages/dsh-desktop-shell')
    expect(hasPatch('@deepseek-ai/dsh-client-ui-sidebar')).toBe(false)
  })

  it('registers the shell plugin where the profile link farm can find it', async () => {
    // Harness builds $DSH_HOME/profiles/node_modules by walking the *dsh*
    // package manifest, not this project's. A local plugin that is only a
    // dependency here resolves during tests and fails at runtime with
    // ERR_MODULE_NOT_FOUND, so it has to be named in that manifest too.
    const dshPatch = await readFile(patchPath('@deepseek-ai/dsh'), 'utf8')

    expect(dshPatch).toContain('+    "dsh-desktop-shell": "0.1.0",')
    expect(dshPatch).toContain('+    "dsh-desktop-market-installer": "0.1.0",')
  })

  it('uses an 80px macOS rail that clears the traffic lights', async () => {
    const patch = await readFile(
      patchPath('@deepseek-ai/dsh-client-ui-layout'),
      'utf8'
    )

    expect(patch).toContain('navigator.userAgent.includes("Macintosh") ? 80 : 56')
    expect(patch).toContain('sidebar === 0 ? COLLAPSED_SIDEBAR_WIDTH')
  })

  it('provides a sidebar phone entry that follows expanded and connected state', async () => {
    const client = await readFile(shellClient, 'utf8')
    const preload = await readFile(path.join(projectRoot, 'src', 'preload', 'index.ts'), 'utf8')
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')

    expect(client).toContain("name: 'sidebar.footer.action'")
    expect(client).toContain('if (!wide && !connected) return null')
    expect(client).toContain('bridge.openPhonePairing()')
    expect(client).toContain('bridge.phoneStatus()')
    expect(preload).toContain("openPhonePairing: (): Promise<void> => ipcRenderer.invoke('mobile:open-pairing')")
    expect(preload).toContain("phoneStatus: (): Promise<{ connected?: boolean }> => ipcRenderer.invoke('mobile:status')")
    expect(preload).not.toContain('data-dsh-sidebar-root')
    expect(preload).not.toContain('mountMobileButton')
    expect(preload).not.toContain('refreshMobileStatus')
    expect(main).toContain("ipcMain.handle('mobile:open-pairing'")
    expect(main).toContain("ipcMain.handle('mobile:status'")
  })

  it('installs the source logo into the Harness static frontend', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { scripts: { postinstall: string } }
    const installer = await readFile(
      path.join(projectRoot, 'scripts', 'install-brand-assets.mjs'),
      'utf8'
    )

    expect(packageJson.scripts.postinstall).toContain('node scripts/install-brand-assets.mjs')
    expect(installer).toContain("'build', 'icon.png'")
    expect(installer).toContain("'dsh-desktop-logo.png'")
    expect(installer).toContain("'build', 'logo-light.png'")
    expect(installer).toContain("'dsh-desktop-logo-light.png'")
    expect(installer).toContain("'build', 'logo-dark.png'")
    expect(installer).toContain("'dsh-desktop-logo-dark.png'")
    expect(installer).toContain('<link rel="icon" type="image/png" href="/dsh-desktop-logo.png" />')
    expect(installer).toContain('"src": "/dsh-desktop-logo.png"')
  })
})
