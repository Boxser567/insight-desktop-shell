import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-release-preflight-'))
  temporaryDirectories.push(root)
  const paths = {
    packageJson: path.join(root, 'package.json'),
    policy: path.join(root, 'policy.json'),
    runtimeLock: path.join(root, 'runtime-lock.json')
  }
  const core = {
    repository: 'Boxser567/insight-harness-core',
    version: '0.1.1-rc.2',
    commit: 'a'.repeat(40)
  }
  const runtimeTag = 'insight-runtime-v0.1.1-rc.10'
  await Promise.all([
    writeFile(paths.packageJson, JSON.stringify({ version: '0.1.2-rc.1' })),
    writeFile(paths.policy, JSON.stringify({
      schema: 1,
      releaseVersion: '0.1.2-rc.1',
      channel: 'candidate',
      mode: 'optional',
      minimumSupportedVersion: '0.1.1'
    })),
    writeFile(paths.runtimeLock, JSON.stringify({
      schemaVersion: 1,
      releaseTag: runtimeTag,
      targets: Object.fromEntries(
        ['darwin-arm64', 'darwin-x64', 'win32-x64'].map((target) => [target, {
          url: `https://github.com/Boxser567/insight-harness-core/releases/download/${runtimeTag}/insight-harness-runtime-${core.version}-${target}.tar.gz`,
          sha256: 'b'.repeat(64),
          core,
          node: { version: '24.9.0' },
          pnpm: { version: '11.7.0' }
        }])
      )
    }))
  ])
  return paths
}

function run(paths: Awaited<ReturnType<typeof fixture>>, tag = 'v0.1.2-rc.1', channel = 'candidate') {
  return spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'verify-release-preflight.mjs'),
    '--tag', tag,
    '--expected-channel', channel,
    '--package', paths.packageJson,
    '--policy', paths.policy,
    '--runtime-lock', paths.runtimeLock
  ], { encoding: 'utf8' })
}

describe('desktop release preflight', () => {
  it('returns the authenticated release and three locked native targets', async () => {
    const paths = await fixture()
    const result = run(paths)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      tag: 'v0.1.2-rc.1',
      version: '0.1.2-rc.1',
      channel: 'candidate',
      runtimeTag: 'insight-runtime-v0.1.1-rc.10',
      runtimeCommit: 'a'.repeat(40),
      targets: ['darwin-arm64', 'darwin-x64', 'win32-x64']
    })
  })

  it('rejects the wrong event channel and package or policy version', async () => {
    const channel = await fixture()
    expect(run(channel, 'v0.1.2', 'candidate').status).not.toBe(0)

    const version = await fixture()
    await writeFile(version.packageJson, JSON.stringify({ version: '0.1.1' }))
    expect(run(version).stderr).toContain('package.json version')

    const policy = await fixture()
    await writeFile(policy.policy, JSON.stringify({
      schema: 1,
      releaseVersion: '0.1.2-rc.2',
      channel: 'candidate',
      mode: 'optional',
      minimumSupportedVersion: '0.1.1'
    }))
    expect(run(policy).stderr).toContain('does not match')
  })

  it('rejects incomplete or cross-commit Runtime locks', async () => {
    const incomplete = await fixture()
    const value = JSON.parse(await readFile(incomplete.runtimeLock, 'utf8'))
    delete value.targets['darwin-x64']
    await writeFile(incomplete.runtimeLock, JSON.stringify(value))
    expect(run(incomplete).status).not.toBe(0)

    const mismatch = await fixture()
    const mismatchValue = JSON.parse(await readFile(mismatch.runtimeLock, 'utf8'))
    mismatchValue.targets['win32-x64'].core.commit = 'c'.repeat(40)
    await writeFile(mismatch.runtimeLock, JSON.stringify(mismatchValue))
    expect(run(mismatch).stderr).toContain('one Core commit')

    const wrongAsset = await fixture()
    const wrongAssetValue = JSON.parse(await readFile(wrongAsset.runtimeLock, 'utf8'))
    wrongAssetValue.targets['darwin-arm64'].url =
      'https://github.com/Boxser567/insight-harness-core/releases/download/insight-runtime-v0.1.1-rc.10/unrelated-darwin-arm64.tar.gz'
    await writeFile(wrongAsset.runtimeLock, JSON.stringify(wrongAssetValue))
    expect(run(wrongAsset).stderr).toContain('darwin-arm64 is invalid')
  })
})
