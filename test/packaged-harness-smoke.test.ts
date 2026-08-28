import { describe, expect, it } from 'vitest'
// @ts-expect-error The build script is JavaScript and has no declaration file.
import { buildPackagedHarnessArguments, resolvePackagedHarnessPaths } from '../scripts/smoke-packaged-harness.mjs'

describe('packaged Harness smoke test', () => {
  const runtimeMetadata = {
    entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js',
    target: { platform: 'win32', arch: 'x64' }
  }

  it('launches the Windows Runtime shipped inside the package', () => {
    const paths = resolvePackagedHarnessPaths(
      'C:\\app\\resources',
      runtimeMetadata,
      { platform: 'win32', arch: 'x64' }
    )

    expect(paths.nodeExecutable).toContain('node.exe')
    expect(paths.dshEntry).toContain('@deepseek-ai')
    expect(buildPackagedHarnessArguments(paths, 43127)).toEqual([
      '--expose-internals',
      paths.nodeEntry,
      paths.dshEntry,
      'web',
      '--patch',
      paths.desktopPatch,
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '43127'
    ])
  })

  it('rejects a package built for a different target', () => {
    expect(() =>
      resolvePackagedHarnessPaths(
        '/app/resources',
        runtimeMetadata,
        { platform: 'darwin', arch: 'arm64' }
      )
    ).toThrow('win32-x64, not darwin-arm64')
  })
})
