import { describe, expect, it, vi } from 'vitest'

const childProcess = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(() => ({
    pid: 1,
    output: [null, 'PATH=/usr/bin\n', ''],
    stdout: 'PATH=/usr/bin\n',
    stderr: '',
    status: 0,
    signal: null,
    error: undefined
  }))
}))

vi.mock('node:child_process', () => childProcess)

import { resolveShellEnvironment } from '../src/main/runtime/harness-runtime'

describe('POSIX shell environment process', () => {
  it.skipIf(process.platform === 'win32')(
    'runs the interactive shell in a detached session so it cannot take terminal control',
    () => {
      expect(resolveShellEnvironment().PATH).toBe('/usr/bin')
      expect(childProcess.spawnSync).toHaveBeenCalledWith(
        process.env.SHELL ?? '/bin/sh',
        ['-l', '-i', '-c', 'env'],
        {
          encoding: 'utf8',
          timeout: 10_000,
          stdio: ['ignore', 'pipe', 'ignore'],
          detached: true
        }
      )
    }
  )
})
