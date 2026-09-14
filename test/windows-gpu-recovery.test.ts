import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { configureWindowsGpuRecovery } from '../src/main/windows-gpu-recovery'
const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function setup() {
  vi.useFakeTimers()
  const directory = await mkdtemp(join(tmpdir(), 'insight-gpu-'))
  directories.push(directory)
  const app = Object.assign(new EventEmitter(), {
    commandLine: { appendSwitch: vi.fn() }, disableHardwareAcceleration: vi.fn(), relaunch: vi.fn(), quit: vi.fn()
  })
  const options = { platform: 'win32' as const, statePath: join(directory, 'gpu.json'), isQuitting: () => false, note: vi.fn() }
  return { app, options, configure: () => configureWindowsGpuRecovery(app as unknown as App, options) }
}
it('persists the next level before restarting and never restarts beyond the last level', async () => {
  const first = await setup()
  const recovery = first.configure()
  expect(recovery.nativeCrash('crashed', -1073741819)).toBe(true)
  expect(JSON.parse(await readFile(first.options.statePath, 'utf8')).level).toBe('sandbox-disabled')
  expect(first.app.quit).toHaveBeenCalledTimes(1)
  recovery.nativeCrash('crashed', -1073741819)
  expect(first.app.quit).toHaveBeenCalledTimes(1)
  const last = await setup()
  await writeFile(last.options.statePath, JSON.stringify({ level: 'gpu-disabled', failures: 0, stableLaunches: 0 }))
  expect(last.configure().nativeCrash('crashed', -1073741819)).toBe(false)
  expect(last.app.relaunch).not.toHaveBeenCalled()
})
it('does not restart a usable account or degrade on normal shutdown', async () => {
  const { app, configure, options } = await setup()
  const recovery = configure()
  recovery.rendered()
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'killed' })
  expect(app.relaunch).not.toHaveBeenCalled()
  for (let i = 0; i < 3; i++) app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' })
  expect(app.relaunch).not.toHaveBeenCalled()
  expect(JSON.parse(await readFile(options.statePath, 'utf8')).level).toBe('sandbox-disabled')
  vi.advanceTimersByTime(60_000)
  expect(JSON.parse(await readFile(options.statePath, 'utf8')).stableLaunches).toBe(0)
})
it('does not relaunch if fallback state cannot be persisted', async () => {
  const { configure, options, app } = await setup()
  await writeFile(options.statePath, 'file')
  options.statePath = join(options.statePath, 'unwritable.json')
  expect(configure().nativeCrash('crashed', -1073741819)).toBe(false)
  expect(app.relaunch).not.toHaveBeenCalled()
})
