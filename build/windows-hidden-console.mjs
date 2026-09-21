// Copyright (c) 2026 DataElement. SPDX-License-Identifier: MIT
import { createRequire } from 'node:module'

// Adapted from dataelement/dsh-desktop fb168ef / 4d34d8d. Give the detached
// Harness a hidden console that console children can inherit. Windows visual
// behavior still requires native verification (including Windows Terminal).
export function createHiddenConsole({ entryPath, load } = {}) {
  try {
    // Resolve from the actual Core entry, not Shell's app/node_modules: Insight
    // ships Koffi under resources/runtime (build/core-runtime in development).
    const loadLibrary = load ?? createRequire(entryPath)('koffi').load
    const kernel32 = loadLibrary('kernel32.dll')
    const user32 = loadLibrary('user32.dll')
    const allocate = kernel32.func('AllocConsole', 'bool', [])
    const getWindow = kernel32.func('GetConsoleWindow', 'void *', [])
    const hide = user32.func('ShowWindow', 'bool', ['void *', 'int'])
    if (!allocate()) return false
    const window = getWindow()
    if (window) hide(window, 0)
    return true
  } catch {
    // Native binding failures must not prevent normal or Safe Mode startup.
    // The caller logs a fixed status, not native errors containing local paths.
    return false
  }
}
