// CI-only: installs a disposable, uniquely identified product, never Insight AI.
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('Disposable Windows CI only')
const repo = process.cwd()
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js')
const compiler = await getMakeNsisPath()
const root = await mkdtemp(path.join(tmpdir(), 'insight-upgrade-'))
const app = path.join(root, 'app')
const meta = path.join(root, 'meta')
const install = path.join(root, 'installed')
const evidence = path.join(repo, 'windows-upgrade-evidence')
const product = 'Insight Upgrade Probe'
const run = (exe, args) => execFileSync(exe, args, { cwd: repo, stdio: 'inherit', timeout: 180000 })
await mkdir(evidence, { recursive: true })
await mkdir(app, { recursive: true })
await mkdir(meta, { recursive: true })
const baselineFiles = [
  'node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh',
  'node_modules/app-builder-lib/templates/nsis/installSection.nsh',
  'node_modules/app-builder-lib/templates/nsis/uninstaller.nsh'
]
const patched = await Promise.all(baselineFiles.map(f => readFile(f)))
let installed = false
try {
  // Minimal executable payload, no Electron launch, network, or user account data.
  const nsi = path.join(root, 'app.nsi')
  await writeFile(nsi, `Unicode true\nRequestExecutionLevel user\nSilentInstall silent\nOutFile "${path.join(app, product + '.exe')}"\nSection\nSectionEnd\n`)
  execFileSync(compiler.path, ['/V2', nsi], { env: { ...process.env, ...compiler.env }, stdio: 'inherit' })
  const leaf = 'getchatcompletionfieldoptionscountsv1observabilitychatcompletionfieldsfieldnameoptionscountspost.js'
  const parent = 'p'.repeat(260 - install.length - leaf.length - 2)
  const relative = path.join(parent, leaf)
  await mkdir(path.join(app, parent), { recursive: true })
  await writeFile(path.join(app, relative), 'old-payload')
  const build = async (version, include) => {
    await writeFile(path.join(meta, 'package.json'), JSON.stringify({ name: 'insight-upgrade-probe', version, description: 'Disposable NSIS test', author: 'Insight', main: 'index.js' }))
    const output = path.join(root, version)
    const config = path.join(root, 'config.json')
    await writeFile(config, JSON.stringify({
      appId: 'com.insight-aigc.upgrade-probe', productName: product, npmRebuild: false,
      electronVersion: '44.0.0',
      directories: { output }, artifactName: 'fixture.exe',
      win: { signAndEditExecutable: false },
      nsis: { oneClick: false, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: false, createStartMenuShortcut: false,
        runAfterFinish: false, ...(include ? { include } : {}) }
    }))
    run(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', '--x64', '--projectDir', meta, '--prepackaged', app, '--config', config, '--publish', 'never'])
    return path.join(output, 'fixture.exe')
  }
  // Restore the unmodified same-version builder templates for the old package.
  run('git', ['apply', '--reverse', '--ignore-whitespace', 'patches/app-builder-lib+26.15.3.patch'])
  const old = await build('0.0.1')
  for (let i = 0; i < baselineFiles.length; i++) await writeFile(baselineFiles[i], patched[i])
  run(old, ['/S', '/currentuser', `/D=${install}`])
  installed = true
  if ((await readFile(path.join(install, relative), 'utf8')) !== 'old-payload') throw new Error('Baseline not installed')
  await writeFile(path.join(app, relative), 'new-payload')
  const next = await build('0.0.2', path.join(repo, 'build/installer.nsh'))
  run(next, ['/S', '/currentuser', `/D=${install}`])
  if ((await readFile(path.join(install, relative), 'utf8')) !== 'new-payload') throw new Error('Upgrade payload mismatch')
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ sourceLength: path.join(install, relative).length, upgraded: true, product, identity: 'com.insight-aigc.upgrade-probe' }, null, 2))
} finally {
  for (let i = 0; i < baselineFiles.length; i++) await writeFile(baselineFiles[i], patched[i])
  const logs = path.join(tmpdir(), 'insight-desktop-update-logs')
  for (const name of await readdir(logs).catch(() => [])) {
    if (name.endsWith('.log')) await writeFile(path.join(evidence, name), await readFile(path.join(logs, name)))
  }
  if (installed) {
    // Only this isolated fixture's uninstaller; no production app identity.
    spawnSync(path.join(install, 'Uninstall ' + product + '.exe'), ['/S', '/currentuser'], { timeout: 30000 })
  }
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
