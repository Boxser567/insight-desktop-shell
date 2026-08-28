import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const runtimeTypesRoot = 'build/core-runtime/node_modules/@deepseek-ai'
const generatedProfileRoot = 'build/bundled-profile/web'
const requiredSlots = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'sidebar.footer.action',
  'sidebar.settings',
  'settings.section',
  'shell.overlay'
] as const

describe('authenticated single-sidebar integration contract', () => {
  it('declares only formal Runtime UI extension points', async () => {
    const manifest = JSON.parse(await readFile('packages/insight-desktop-integration/package.json', 'utf8'))
    const client = await readFile('packages/insight-desktop-integration/src/client/index.tsx', 'utf8')
    const patch = await readFile('packages/insight-desktop-integration/cordis.patch.yml', 'utf8')
    const tsconfig = JSON.parse(await readFile('packages/insight-desktop-integration/tsconfig.json', 'utf8'))

    expect(manifest.dsh.client.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-sidebar',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-settings-general'
    ]))
    for (const slot of requiredSlots) {
      expect(client).toContain(`ctx.slots.inject('${slot}'`)
    }
    expect(client).not.toMatch(/querySelector|\.click\(|fetch\(|token|cookie/iu)
    expect(patch).toMatch(/id:\s*ui-brand-official\s+disabled:\s*true/u)
    expect(patch).toContain("name: '@insight-ai/desktop-integration'")

    for (const path of Object.values<string[]>(tsconfig.compilerOptions.paths)) {
      expect(path).toHaveLength(1)
      expect(path[0]).toMatch(/^build\/core-runtime\//u)
    }
  })

  it('prepares a version-three Profile with protected first-party integration', async () => {
    const prepare = await readFile('scripts/prepare-bundled-profile.mjs', 'utf8')
    const installationOwned = await readFile('src/main/state/installation-owned-bundles.ts', 'utf8')
    const recovery = await readFile('src/main/state/plugin-recovery.ts', 'utf8')

    expect(prepare).toContain("const SIDEBAR_VERSION = '0.16.1'")
    expect(prepare).toContain("const DEFAULT_PROFILE_VERSION = 3")
    expect(prepare).toContain("const DESKTOP_INTEGRATION_PACKAGE = '@insight-ai/desktop-integration'")
    expect(prepare).toContain("manifest.dependencies[DESKTOP_INTEGRATION_PACKAGE] = 'workspace:*'")
    expect(prepare).toContain("packages.includes('packages/*')")
    expect(installationOwned).toContain("DESKTOP_INTEGRATION_PACKAGE = '@insight-ai/desktop-integration'")
    expect(recovery).toContain('isInstallationOwnedBundle')
  })

  it.skipIf(!existsSync(generatedProfileRoot))('matches the generated bundled Profile', async () => {
    const manifest = JSON.parse(await readFile(`${generatedProfileRoot}/package.json`, 'utf8'))
    const workspace = await readFile(`${generatedProfileRoot}/pnpm-workspace.yaml`, 'utf8')
    const patch = await readFile(`${generatedProfileRoot}/packages/insight-desktop-integration/cordis.patch.yml`, 'utf8')
    const bundledClient = await readFile(`${generatedProfileRoot}/packages/insight-desktop-integration/lib/client.js`, 'utf8')
    const builtClient = await readFile('packages/insight-desktop-integration/lib/client.js', 'utf8')

    expect(manifest.dependencies['dsh-better-sidebar']).toBe('0.16.1')
    expect(manifest.dependencies['@insight-ai/desktop-integration']).toBe('workspace:*')
    expect(manifest.dsh.profile.bundles).toContain('@insight-ai/desktop-integration')
    expect(manifest.insightDesktop.defaultProfileVersion).toBe(3)
    expect(workspace).toContain('packages/*')
    expect(patch).toMatch(/id:\s*ui-brand-official\s+disabled:\s*true/u)
    expect(bundledClient).toBe(builtClient)
  })

  it('leaves no authenticated Shell rail and fills the window with Harness', async () => {
    const app = await readFile('src/renderer/src/App.tsx', 'utf8')
    const styles = await readFile('src/renderer/src/styles.css', 'utf8')
    const view = await readFile('src/main/workspace/harness-workspace-view.ts', 'utf8')

    expect(app).toContain('authenticated-host')
    expect(app).not.toContain('AuthenticatedShell')
    expect(styles).not.toMatch(/account-sidebar|workspace-shell|shell-rail/u)
    expect(view).toContain('view.setBounds({ x: 0, y: 0, width: content.width, height: content.height })')
  })

  it.skipIf(!existsSync(runtimeTypesRoot))('matches the prepared locked Runtime public types', async () => {
    const sidebar = await readFile(`${runtimeTypesRoot}/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts`, 'utf8')
    const settings = await readFile(`${runtimeTypesRoot}/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`, 'utf8')
    const layout = await readFile(`${runtimeTypesRoot}/dsh-client-ui-layout/lib/types/client/index.d.ts`, 'utf8')
    const dialog = await readFile(`${runtimeTypesRoot}/dsh-client-ui-settings-general/lib/types/client/settings-dialog.d.ts`, 'utf8')
    const publicTypes = [sidebar, settings, layout].join('\n')

    for (const slot of requiredSlots) expect(publicTypes).toContain(`'${slot}'`)
    expect(dialog).toMatch(/open\(sectionId\?: string\): void;/u)
  })
})
