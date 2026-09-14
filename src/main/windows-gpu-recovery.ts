import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { App } from 'electron'
import {
  defaultGpuFallbackState, gpuFallbackSwitches, isGpuLossFatal,
  isRendererGpuFallbackCandidate, parseGpuFallbackState, planGpuFallbackResponse,
  planStableLaunch, serializeGpuFallbackState, type GpuFallbackState
} from './gpu-fallback'

/** Configure GPU switches before Electron boots; persist progress before relaunch. */
export function configureWindowsGpuRecovery(app: App, options: {
  platform: NodeJS.Platform
  statePath: string
  isQuitting: () => boolean
  note: (line: string) => void
}): { rendered(): void; nativeCrash(reason: string, exitCode: number): boolean } {
  if (options.platform !== 'win32') return { rendered() {}, nativeCrash: () => false }
  let state: GpuFallbackState = { ...defaultGpuFallbackState }
  try { state = parseGpuFallbackState(readFileSync(options.statePath, 'utf8')) } catch { /* First launch has no state. */ }
  for (const flag of gpuFallbackSwitches(state.level)) app.commandLine.appendSwitch(flag)
  if (state.level === 'gpu-disabled') app.disableHardwareAcceleration()
  let rendered = false
  let failed = false
  let relaunching = false
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  const persist = (next: GpuFallbackState): boolean => {
    try {
      mkdirSync(dirname(options.statePath), { recursive: true })
      writeFileSync(`${options.statePath}.tmp`, serializeGpuFallbackState(next))
      renameSync(`${options.statePath}.tmp`, options.statePath)
      state = next
      return true
    } catch (error) {
      options.note(`[desktop] GPU fallback state could not be saved: ${String(error)}`)
      return false
    }
  }
  const signal = (): boolean => {
    if (options.isQuitting() || relaunching) return relaunching
    failed = true
    if (stableTimer) clearTimeout(stableTimer)
    const plan = planGpuFallbackResponse({ state, harnessRendered: rendered })
    options.note(`[desktop] GPU fallback: ${state.level} -> ${plan.state.level}`)
    if (!persist(plan.state) || !plan.relaunch) return false
    relaunching = true
    app.relaunch()
    // before-quit still tears down the runtime and its account credentials.
    app.quit()
    return true
  }
  app.on('child-process-gone', (_event, details) => {
    if (details.type === 'GPU' && isGpuLossFatal(details.reason)) signal()
  })
  app.on('before-quit', () => { if (stableTimer) clearTimeout(stableTimer) })
  return {
    rendered() {
      if (rendered) return
      rendered = true
      if (failed) return
      stableTimer = setTimeout(() => {
        if (!failed && !options.isQuitting()) persist(planStableLaunch(state))
      }, 60_000)
      stableTimer.unref?.()
    },
    nativeCrash(reason, exitCode) {
      return isRendererGpuFallbackCandidate({ platform: options.platform, reason, exitCode }) && signal()
    }
  }
}
