import { describe, expect, it } from 'vitest'
import { resolveCoreRuntime } from '../src/main/state/core-runtime'

describe('embedded Core Runtime paths', () => {
  it('resolves the packaged DSH, Node, and pnpm entries below Resources/runtime', () => {
    expect(resolveCoreRuntime('/Applications/因赛AI.app/Contents/Resources', 'darwin')).toEqual({
      root: '/Applications/因赛AI.app/Contents/Resources/runtime',
      runtimeManifestPath: '/Applications/因赛AI.app/Contents/Resources/runtime/runtime.json',
      dshEntryPath: '/Applications/因赛AI.app/Contents/Resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
      nodeExecutablePath: '/Applications/因赛AI.app/Contents/Resources/runtime/node_modules/node/bin/node',
      pnpmEntryPath: '/Applications/因赛AI.app/Contents/Resources/runtime/node_modules/pnpm/bin/pnpm.mjs'
    })
  })

  it('uses the Windows Node executable', () => {
    expect(resolveCoreRuntime('C:\\Program Files\\Insight AI\\resources', 'win32').nodeExecutablePath).toBe(
      'C:\\Program Files\\Insight AI\\resources/runtime/node_modules/node/bin/node.exe'
    )
  })
})
