// Executes the installed electron-builder atomic relocation/restore functions
// on disposable fixtures. Never reads installation registry keys or user data.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
const require = createRequire(import.meta.url)
if (process.platform !== 'win32') throw new Error('Windows runner required')
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js')
const compiler = await getMakeNsisPath()
const template = await readFile(require.resolve('app-builder-lib/templates/nsis/uninstaller.nsh'), 'utf8')
const functions = template.slice(template.indexOf('Function un.atomicRMDir'), template.indexOf('!ifndef UNINSTALL_SECTION_NAME'))
  .replaceAll('un.atomicRMDir', 'probeAtomic').replaceAll('un.restoreFiles', 'probeRestore')
  .replaceAll('$PLUGINSDIR', '$ProbeStage')
if (!functions.includes('Rename "$INSTDIR$R0\\$R2"')) throw new Error('Unexpected template')
const root = await mkdtemp(path.join(tmpdir(), 'insight-nsis-'))
const output = path.resolve('nsis-path-results.json')
const rows = []
try {
  const script = path.join(root, 'probe.nsi')
  const exe = path.join(root, 'probe.exe')
  await writeFile(script, `Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${exe}"
!include LogicLib.nsh
!define UNINSTALL_FILENAME "unused-uninstaller.exe"
Var ProbeStage
Var ProbeResult
${functions}
Section
  ReadEnvStr $INSTDIR INSIGHT_PROBE_SOURCE
  ReadEnvStr $ProbeStage INSIGHT_PROBE_STAGE
  ReadEnvStr $ProbeResult INSIGHT_PROBE_RESULT
  Push ""
  Call probeAtomic
  Pop $R0
  WriteINIStr "$ProbeResult" result atomic "$R0"
  Push ""
  Call probeRestore
  Pop $R0
  WriteINIStr "$ProbeResult" result restore "$R0"
SectionEnd
`)
  execFileSync(compiler.path, ['/V2', script], { env: { ...process.env, ...compiler.env }, stdio: 'inherit' })
  const leaf = 'getchatcompletionfieldoptionscountsv1observabilitychatcompletionfieldsfieldnameoptionscountspost.js'
  for (const length of [259, 260, 261]) {
    for (const mode of ['ordinary', 'extended']) {
      const base = path.join(root, `${length}-${mode}`)
      const source = path.join(base, 'source')
      const stage = path.join(base, 'stage')
      const padding = length - source.length - leaf.length - 2
      if (padding < 1) throw new Error('Fixture root too long')
      const relative = path.join('p'.repeat(padding), leaf)
      const file = path.join(source, relative)
      await mkdir(path.dirname(file), { recursive: true })
      await mkdir(path.join(stage, 'old-install'), { recursive: true })
      await writeFile(file, 'preserve-this-content')
      const report = path.join(base, 'result.ini')
      const prefix = mode === 'extended' ? '\\\\?\\' : ''
      execFileSync(exe, [], { timeout: 30000, env: {
        ...process.env, INSIGHT_PROBE_SOURCE: prefix + source,
        INSIGHT_PROBE_STAGE: prefix + stage, INSIGHT_PROBE_RESULT: report
      } })
      const raw = await readFile(report)
      const result = raw[0] === 0xff ? raw.toString('utf16le') : raw.toString('utf8')
      const restored = await readFile(file, 'utf8').catch(() => null)
      rows.push({ length: file.length, mode, result, restored: restored === 'preserve-this-content' })
    }
  }
} finally {
  await writeFile(output, JSON.stringify({ scope: 'Actual template functions in isolated executable; not a full upgrade', rows }, null, 2))
  await rm(root, { recursive: true, force: true })
}
console.log(JSON.stringify(rows, null, 2))
