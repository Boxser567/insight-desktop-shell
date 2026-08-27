import { describe, expect, it } from 'vitest'
import { resolveCoreRuntime } from '../src/main/state/core-runtime'

describe('embedded Core Runtime paths', () => {
  it('uses the pnpm ESM fallback when the legacy CommonJS entry is absent', () => {
    expect(resolveCoreRuntime('/tmp/insight-runtime-test/Resources', 'darwin')).toEqual({
      root: '/tmp/insight-runtime-test/Resources/runtime',
      runtimeManifestPath: '/tmp/insight-runtime-test/Resources/runtime/runtime.json',
      dshEntryPath: '/tmp/insight-runtime-test/Resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
      nodeExecutablePath: '/tmp/insight-runtime-test/Resources/runtime/node_modules/node/bin/node',
      pnpmEntryPath: '/tmp/insight-runtime-test/Resources/runtime/node_modules/pnpm/bin/pnpm.mjs'
    })
  })

  it('uses Windows path separators and the Windows Node executable', () => {
    expect(resolveCoreRuntime('C:\\Program Files\\Insight AI\\resources', 'win32').nodeExecutablePath).toBe(
      'C:\\Program Files\\Insight AI\\resources\\runtime\\node_modules\\node\\bin\\node.exe'
    )
  })
})
