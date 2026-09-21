import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { enforceWindowsChildProcessHide } from '../build/windows-child-process-hide.mjs'
import { createHiddenConsole } from '../build/windows-hidden-console.mjs'

function fixture() {
  const originals = Object.fromEntries(['spawn', 'spawnSync', 'fork', 'exec', 'execSync', 'execFile', 'execFileSync'].map(name => [name, vi.fn()]))
  const cp = { ...originals }
  const sync = vi.fn()
  enforceWindowsChildProcessHide(cp, sync)
  return { cp, originals, sync }
}

describe('Windows child-process compatibility', () => {
  it.each(['spawn', 'spawnSync', 'fork', 'execFileSync'])('%s handles args and options without mutating callers', name => {
    const { cp, originals, sync } = fixture()
    const options = Object.freeze({ cwd: 'work' })
    cp[name]('command', ['arg'], options)
    expect(originals[name]).toHaveBeenLastCalledWith('command', ['arg'], { cwd: 'work', windowsHide: true })
    cp[name]('command', options)
    expect(originals[name]).toHaveBeenLastCalledWith('command', { cwd: 'work', windowsHide: true })
    cp[name]('command', [], { windowsHide: false })
    expect(originals[name]).toHaveBeenLastCalledWith('command', [], { windowsHide: false })
    expect(sync).toHaveBeenCalledOnce()
  })
  it('keeps exec and execFile callback/options overloads', () => {
    const { cp, originals } = fixture()
    const callback = vi.fn()
    cp.exec('cmd', callback)
    expect(originals.exec).toHaveBeenLastCalledWith('cmd', { windowsHide: true }, callback)
    cp.execSync('cmd', { encoding: 'utf8' })
    expect(originals.execSync).toHaveBeenLastCalledWith('cmd', { encoding: 'utf8', windowsHide: true })
    for (const args of [[callback], [{ cwd: 'work' }, callback], [['arg'], callback], [['arg'], { cwd: 'work' }, callback]]) {
      cp.execFile('cmd', ...args)
      const hasArgs = Array.isArray(args[0])
      const hasOptions = args.some(arg => arg && typeof arg === 'object' && !Array.isArray(arg))
      expect(originals.execFile).toHaveBeenLastCalledWith('cmd', hasArgs ? ['arg'] : [], { ...(hasOptions ? { cwd: 'work' } : {}), windowsHide: true }, callback)
    }
  })
  it('preserves promisified output, child and failure details', async () => {
    const { cp, originals } = fixture()
    const child = { pid: 123 }
    originals.execFile.mockImplementation((_file, _args, options, callback) => {
      expect(options.windowsHide).toBe(true)
      callback(null, 'out', 'err')
      return child
    })
    const pending = promisify(cp.execFile)('cmd', [])
    expect(pending.child).toBe(child)
    await expect(pending).resolves.toEqual({ stdout: 'out', stderr: 'err' })
    originals.exec.mockImplementation((_cmd, _options, callback) => { callback(new Error('failed'), 'out', 'err'); return child })
    await expect(promisify(cp.exec)('cmd')).rejects.toMatchObject({ message: 'failed', stdout: 'out', stderr: 'err' })
  })
  it('works with real Node ESM exports and promisify in an isolated process', () => {
    const helper = pathToFileURL(resolve('build/windows-child-process-hide.mjs')).href
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import cp, { execFile } from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { promisify } from 'node:util';
      import { enforceWindowsChildProcessHide } from ${JSON.stringify(helper)};
      enforceWindowsChildProcessHide(cp, syncBuiltinESMExports);
      if (execFile !== cp.execFile) throw new Error('stale ESM export');
      const p = promisify(execFile)(process.execPath, ['-e', 'console.log("ok")']);
      if (!p.child) throw new Error('missing child');
      console.log(JSON.stringify(await p));
    `], { encoding: 'utf8', timeout: 10000 })
    expect(JSON.parse(output)).toEqual({ stdout: 'ok\n', stderr: '' })
  })
})

describe('hidden console and packaging', () => {
  it('continues through the Windows entry when native console support is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'insight-entry-'))
    try {
      const entry = join(root, 'core.mjs')
      writeFileSync(entry, 'export function runCli() { console.log("CORE_STARTED") }')
      const loader = resolve('build/harness-node-entry.mjs')
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
        Object.defineProperty(process, 'platform', { value: 'win32' });
        process.argv = [process.execPath, ${JSON.stringify(loader)}, ${JSON.stringify(entry)}];
        await import(${JSON.stringify(pathToFileURL(loader).href)});
      `], { encoding: 'utf8', timeout: 10000 })
      expect(output).toContain('hidden console: unavailable')
      expect(output).toContain('Node child-process windowsHide default enabled')
      expect(output.match(/CORE_STARTED/g)).toHaveLength(1)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('allocates and hides a console, without blocking startup on failure', () => {
    const hide = vi.fn()
    const load = () => ({ func: name => name === 'AllocConsole' ? () => true : name === 'GetConsoleWindow' ? () => 123 : hide })
    expect(createHiddenConsole({ load })).toBe(true)
    expect(hide).toHaveBeenCalledWith(123, 0)
    expect(createHiddenConsole({ load: () => { throw new Error('missing native binding') } })).toBe(false)
    expect(createHiddenConsole({ load: () => ({ func: () => () => false }) })).toBe(false)
  })
  it.each(['runtime', 'core-runtime'])('resolves native dependency from the %s Core layout', directory => {
    const root = mkdtempSync(join(tmpdir(), 'insight-console-'))
    try {
      const base = join(root, directory, 'node_modules')
      const entryPath = join(base, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      mkdirSync(join(base, '@deepseek-ai', 'dsh', 'lib'), { recursive: true })
      const koffi = join(base, 'koffi')
      mkdirSync(koffi, { recursive: true })
      writeFileSync(join(koffi, 'index.js'), 'exports.load = () => ({ func: name => name === "GetConsoleWindow" ? () => 123 : () => true })')
      expect(createHiddenConsole({ entryPath })).toBe(true)
      expect(createHiddenConsole({ entryPath: join(root, 'missing', 'bin.js') })).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('includes both helpers in all inherited package configurations', () => {
    const require = createRequire(import.meta.url)
    for (const config of [require('../package.json').build, require('../electron-builder.dev.cjs'), require('../electron-builder.candidate.cjs')]) {
      for (const helper of ['windows-hidden-console.mjs', 'windows-child-process-hide.mjs']) {
        expect(config.extraResources).toContainEqual({ from: `build/${helper}`, to: helper })
      }
    }
  })
})
