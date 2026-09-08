import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { patchBundledMarket } from '../scripts/patch-bundled-market.mjs'

describe('bundled market host policy', () => {
  const testDirectory = join(__dirname, '.temp-bundled-market-policy')

  afterEach(async () => {
    await rm(testDirectory, { recursive: true, force: true })
  })

  it('prevents market mutation of required desktop capabilities', async () => {
    const library = join(testDirectory, 'node_modules', 'dshmarket', 'lib')
    const client = join(testDirectory, 'node_modules', 'dshmarket', 'client')
    await mkdir(library, { recursive: true })
    await mkdir(client, { recursive: true })
    await writeFile(
      join(library, 'patch.js'),
      "const PROTECTED_MODULE_PATTERNS = [\n    /^cordis:/u,\n];\n",
      'utf8'
    )
    await writeFile(
      join(library, 'routes.js'),
      [
        "path: '/dsh-market/installed'",
        '                const installed = readInstalled(config.profile, activeProfileDir);',
        '                sendJson(response, 200, {',
        '                    profile: config.profile,',
        '                    installed,',
        '                });',
        "path: '/dsh-market/status'",
        '                    busy: installing,',
        "path: '/dsh-market/updates'",
        '                    const updates = await checkUpdates();',
        '                    sendJson(response, 200, { updates });',
        "path: '/dsh-market/update'",
        "                        const name = typeof body.name === 'string' ? body.name : '';",
        "path: '/dsh-market/uninstall'",
        "                        const name = typeof body.name === 'string' ? body.name : '';",
        "path: '/dsh-market/self-uninstall'",
        '                        pendingRollbacks.clear();',
        "                        const result = await runPlugin(config.profile, ['remove', selfName]);",
        '                        if (!result) return;',
        '                        // Opt-in cleanup.',
        "path: '/dsh-market/install'"
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      join(client, 'client.js'),
      [
        'const doRestart = () => {',
        '  setRestartEnabled(status.restart === true);',
        '  const requestRestart = (attemptsLeft) => {',
        '    fetch(api("/dsh-market/restart"), { method: "POST" })',
        '  }',
        '  requestRestart(10)',
        '}'
      ].join('\n'),
      'utf8'
    )

    await patchBundledMarket(testDirectory)
    await patchBundledMarket(testDirectory)

    const patch = await readFile(join(library, 'patch.js'), 'utf8')
    const routes = await readFile(join(library, 'routes.js'), 'utf8')
    const clientSource = await readFile(join(client, 'client.js'), 'utf8')
    expect(patch.match(/dsh-better-sidebar/g)).toHaveLength(1)
    expect(patch.match(/@insight-ai\\\/desktop-integration/g)).toHaveLength(1)
    expect(routes.match(/Insight Desktop protects required capabilities/g)).toHaveLength(2)
    expect(routes.match(/Insight Desktop hides required capabilities/g)).toHaveLength(2)
    expect(routes).toContain('isProtectedModule(name)')
    expect(routes).toContain('installed: visibleInstalled')
    expect(routes).toContain('updates: visibleUpdates')
    expect(routes).toContain('cannot be updated from the plugin market')
    expect(routes).toContain('cannot be uninstalled from the plugin market')
    expect(routes).toContain('// Insight Desktop reports every market mutation as restart-blocking.')
    expect(routes).toContain('busy: installing || writing')
    expect(routes).toContain('// Insight Desktop records an explicit market uninstall.')
    expect(routes).toContain("writeFileSync(join(activeProfileDir, '.insight-market-uninstalled'), '1\\n', 'utf8')")
    expect(clientSource).toContain('// Insight Desktop exposes the shell restart capability.')
    expect(clientSource).toContain('status.restart === true || typeof globalThis.dshDesktop?.restartHarness === "function"')
    expect(clientSource).toContain('// Insight Desktop delegates Harness restarts to the desktop shell (v2).')
    expect(clientSource).toContain('globalThis.dshDesktop?.restartHarness')
    expect(clientSource).toContain('navigator.userAgent.includes("Electron/")')
    expect(clientSource).toContain('desktop restart bridge unavailable')
    expect(clientSource).toContain('status.busy === true')
    expect(clientSource).toContain('fetch(api("/dsh-market/restart")')
    expect(clientSource.match(/delegates Harness restarts/g)).toHaveLength(1)
    for (const removablePackage of [
      'dshmarket',
      'dsh-memory-evolve',
      '@changfenhuang/dsh-genui',
      'dsh-prompt-enhance'
    ]) {
      expect(patch).not.toContain(removablePackage)
    }
  })
})
