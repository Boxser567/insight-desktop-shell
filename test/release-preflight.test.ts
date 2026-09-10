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
    runtimeLock: path.join(root, 'runtime-lock.json'),
    serviceEnvironment: path.join(root, 'service-environment.json')
  }
  const core = {
    repository: 'Boxser567/insight-harness-core',
    version: '0.1.1-rc.2',
    commit: 'a'.repeat(40)
  }
  const runtimeTag = 'insight-runtime-v0.1.1-rc.10'
  await Promise.all([
    writeFile(paths.packageJson, JSON.stringify({ version: '1.0.0-rc.2' })),
    writeFile(paths.policy, JSON.stringify({
      schema: 1,
      releaseVersion: '1.0.0-rc.2',
      channel: 'candidate',
      mode: 'optional',
      minimumSupportedVersion: '1.0.0-rc.1'
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
    })),
    writeFile(paths.serviceEnvironment, JSON.stringify({
      schemaVersion: 1,
      releaseEnvironment: 'test',
      environments: {
        test: {
          authOrigin: 'https://gapi-test.insight-aigc.com',
          modelBaseUrl: 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1'
        },
        production: {
          authOrigin: 'https://gapi.insight-aigc.com',
          modelBaseUrl: 'https://gapi.insight-aigc.com/insight-harness-llm-gateway/v1'
        }
      }
    }))
  ])
  return paths
}

function run(paths: Awaited<ReturnType<typeof fixture>>, tag = 'v1.0.0-rc.2', channel = 'candidate') {
  return spawnSync(process.execPath, [
    path.join(process.cwd(), 'scripts', 'verify-release-preflight.mjs'),
    '--tag', tag,
    '--expected-channel', channel,
    '--package', paths.packageJson,
    '--policy', paths.policy,
    '--runtime-lock', paths.runtimeLock,
    '--service-environment', paths.serviceEnvironment
  ], { encoding: 'utf8' })
}

describe('desktop release preflight', () => {
  it('returns the authenticated release and three locked native targets', async () => {
    const paths = await fixture()
    const result = run(paths)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      tag: 'v1.0.0-rc.2',
      version: '1.0.0-rc.2',
      channel: 'candidate',
      runtimeTag: 'insight-runtime-v0.1.1-rc.10',
      runtimeCommit: 'a'.repeat(40),
      serviceEnvironment: 'test',
      targets: ['darwin-arm64', 'darwin-x64', 'win32-x64']
    })
  })

  it('allows Candidate test services and requires production services for Stable', async () => {
    const candidate = await fixture()
    expect(run(candidate).status).toBe(0)

    const blockedStable = await fixture()
    await writeFile(blockedStable.packageJson, JSON.stringify({ version: '0.1.2' }))
    await writeFile(blockedStable.policy, JSON.stringify({
      schema: 1,
      releaseVersion: '0.1.2',
      channel: 'stable',
      mode: 'optional',
      minimumSupportedVersion: '0.1.1'
    }))
    expect(run(blockedStable, 'v0.1.2', 'stable').stderr).toContain(
      'Stable releases require the production desktop service environment.'
    )

    const stable = await fixture()
    await writeFile(stable.packageJson, JSON.stringify({ version: '0.1.2' }))
    await writeFile(stable.policy, JSON.stringify({
      schema: 1,
      releaseVersion: '0.1.2',
      channel: 'stable',
      mode: 'optional',
      minimumSupportedVersion: '0.1.1'
    }))
    const services = JSON.parse(await readFile(stable.serviceEnvironment, 'utf8'))
    services.releaseEnvironment = 'production'
    await writeFile(stable.serviceEnvironment, JSON.stringify(services))
    expect(run(stable, 'v0.1.2', 'stable').status).toBe(0)
  })

  it.each([
    ['unknown environment', (value: any) => { value.releaseEnvironment = 'staging' }],
    ['missing endpoint', (value: any) => { delete value.environments.test.authOrigin }],
    ['HTTP endpoint', (value: any) => { value.environments.test.authOrigin = 'http://gapi-test.insight-aigc.com' }],
    ['URL credentials', (value: any) => { value.environments.test.authOrigin = 'https://user@gapi-test.insight-aigc.com' }],
    ['URL query', (value: any) => { value.environments.test.authOrigin = 'https://gapi-test.insight-aigc.com?mode=test' }],
    ['URL fragment', (value: any) => { value.environments.test.authOrigin = 'https://gapi-test.insight-aigc.com#test' }],
    ['wrong model path', (value: any) => { value.environments.test.modelBaseUrl = 'https://gapi-test.insight-aigc.com/v1' }]
  ])('rejects malformed client service configuration: %s', async (_label, mutate) => {
    const paths = await fixture()
    const value = JSON.parse(await readFile(paths.serviceEnvironment, 'utf8'))
    mutate(value)
    await writeFile(paths.serviceEnvironment, JSON.stringify(value))

    expect(run(paths).stderr).toContain('Desktop service environment')
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
      releaseVersion: '1.0.0-rc.3',
      channel: 'candidate',
      mode: 'optional',
      minimumSupportedVersion: '0.1.1'
    }))
    expect(run(policy).stderr).toContain('does not match')
  })

  it('rejects non-canonical versions and unsupported release floors', async () => {
    const tag = await fixture()
    expect(run(tag, 'v0.1.2-rc.01').stderr).toContain('Release tag')

    const policy = await fixture()
    const value = JSON.parse(await readFile(policy.policy, 'utf8'))
    value.minimumSupportedVersion = '1.0.0-rc.3'
    await writeFile(policy.policy, JSON.stringify(value))
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
