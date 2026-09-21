// Copyright (c) 2026 DataElement. SPDX-License-Identifier: MIT
import { promisify } from 'node:util'

// Adapted from dataelement/dsh-desktop c7faa1e. Limited to Node calls in this
// process; native Win32 calls and separately launched Node processes are not patched.
function hiddenOptions(options) {
  return options?.windowsHide !== undefined ? options : { ...options, windowsHide: true }
}

export function enforceWindowsChildProcessHide(childProcess, syncBuiltinESMExports) {
  for (const name of ['spawn', 'spawnSync', 'fork', 'execFileSync']) {
    const original = childProcess[name]
    childProcess[name] = function (file, args, options) {
      return Array.isArray(args)
        ? original.call(this, file, args, hiddenOptions(options))
        : original.call(this, file, hiddenOptions(args ?? options))
    }
  }
  const exec = childProcess.exec
  childProcess.exec = function (command, options, callback) {
    if (typeof options === 'function') return exec.call(this, command, hiddenOptions(), options)
    return exec.call(this, command, hiddenOptions(options), callback)
  }
  const execSync = childProcess.execSync
  childProcess.execSync = function (command, options) {
    return execSync.call(this, command, hiddenOptions(options))
  }
  const execFile = childProcess.execFile
  childProcess.execFile = function (file, args, options, callback) {
    if (typeof args === 'function') {
      callback = args
      args = []
      options = undefined
    } else if (!Array.isArray(args)) {
      callback = typeof options === 'function' ? options : callback
      options = args ?? options
      args = []
    } else if (typeof options === 'function') {
      callback = options
      options = undefined
    }
    return execFile.call(this, file, args, hiddenOptions(options), callback)
  }
  // Copying Node's original custom promisifier would bypass these wrappers.
  // Generic promisify would instead lose stderr and the cancellable child handle.
  for (const name of ['exec', 'execFile']) {
    const wrapped = childProcess[name]
    Object.defineProperty(wrapped, promisify.custom, {
      value: (...args) => {
        let child
        const promise = new Promise((resolve, reject) => {
          child = wrapped(...args, (error, stdout, stderr) => {
            if (error) {
              error.stdout = stdout
              error.stderr = stderr
              reject(error)
            } else resolve({ stdout, stderr })
          })
        })
        promise.child = child
        return promise
      }
    })
  }
  syncBuiltinESMExports()
}
