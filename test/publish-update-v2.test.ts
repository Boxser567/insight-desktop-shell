import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
// @ts-expect-error Production scripts are plain ESM and expose runtime-tested helpers.
import * as publisher from '../scripts/publish-update-v2-to-oss.mjs'
import { sha512, writeReleaseFixture } from './release-script-fixtures'

const {
  acceptV2Target,
  parseV2PublisherArguments,
  promoteV2Stable,
  publishV2Candidate,
  rejectV2Version,
  stageV2Target
} = publisher
const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

class MemoryOss {
  readonly objects = new Map<string, Buffer>()

  async listObjects(prefix: string) {
    return [...this.objects]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, bytes]) => ({ key, size: bytes.length }))
  }

  async getObject(key: string, destination: string) {
    const bytes = this.objects.get(key)
    if (!bytes) throw new Error(`Missing object: ${key}`)
    await writeFile(destination, bytes)
    return { status: 200 }
  }

  async uploadReleaseObject(key: string, source: string, headers: Record<string, string>) {
    expect(headers['x-oss-forbid-overwrite']).toBe('true')
    if (this.objects.has(key)) throw new Error(`Overwrite attempted: ${key}`)
    this.objects.set(key, await readFile(source))
    return { status: 200 }
  }

  async putObject(key: string, source: string) {
    this.objects.set(key, await readFile(source))
    return { status: 200 }
  }
}

type Target = 'darwin-arm64' | 'darwin-x64' | 'win32-x64'

async function releaseFixture(version = '1.0.1') {
  const root = await mkdtemp(path.join(tmpdir(), 'insight-publish-v2-'))
  temporaryDirectories.push(root)
  const paths = await writeReleaseFixture(root, version, 'stable')
  await writeFile(paths.compatibility, JSON.stringify({
    profileSchema: 1,
    accountStorageSchema: 1,
    readsDataSchema: { minimum: 1, maximum: 1 },
    writesDataSchema: 1
  }))
  await writeFile(paths.policy, JSON.stringify({
    schema: 1,
    releaseVersion: version,
    channel: 'stable',
    mode: 'optional',
    minimumSupportedVersion: '1.0.0-rc.18'
  }))
  return { root, paths, version }
}

async function writeTargetMetadata(
  releaseDir: string,
  version: string,
  target: Target
) {
  const name = target === 'darwin-arm64'
    ? `insight-${version}-mac-arm64.zip`
    : target === 'darwin-x64'
      ? `insight-${version}-mac-x64.zip`
      : `insight-${version}-windows-x64-setup.exe`
  const bytes = await readFile(path.join(releaseDir, name))
  await writeFile(
    path.join(releaseDir, target.startsWith('darwin-') ? 'latest-mac.yml' : 'latest.yml'),
    stringify({
      version,
      files: [{ url: name, sha512: sha512(bytes), size: bytes.length }],
      path: name,
      sha512: sha512(bytes)
    })
  )
}

async function buildTarget(
  fixture: Awaited<ReturnType<typeof releaseFixture>>,
  target: Target,
  shellCommit = 'a'.repeat(40)
) {
  await writeTargetMetadata(fixture.paths.releaseDir, fixture.version, target)
  const output = path.join(fixture.root, `target-${target}-${shellCommit[0]}`)
  const result = spawnSync(process.execPath, [
    path.join(projectRoot, 'scripts', 'build-update-v2-target.mjs'),
    '--asset-dir', fixture.paths.releaseDir,
    '--out-dir', output,
    '--version', fixture.version,
    '--target', target,
    '--shell-commit', shellCommit,
    '--runtime-manifest', fixture.paths.runtimeManifest,
    '--compatibility', fixture.paths.compatibility,
    '--private-key', fixture.paths.privateKey
  ], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return output
}

async function operationDirectory(root: string, label: string) {
  const directory = path.join(root, label)
  await mkdir(directory, { recursive: true })
  return directory
}

function commonInput(
  fixture: Awaited<ReturnType<typeof releaseFixture>>,
  oss: MemoryOss,
  temporaryDirectory: string
) {
  return {
    version: fixture.version,
    oss,
    temporaryDirectory,
    publicKeyPath: fixture.paths.publicKey,
    privateKeyPath: fixture.paths.privateKey,
    policyPath: fixture.paths.policy,
    actor: 'release-operator',
    workflowRun: '12345',
    now: () => new Date('2026-09-22T12:00:00.000Z'),
    verifyCdn: vi.fn(async (key: string, bytes: Buffer) => {
      expect(oss.objects.get(key)?.equals(bytes)).toBe(true)
    }),
    appendGithubIndex: vi.fn(async () => undefined),
    publishGithubRelease: vi.fn(async () => true),
    githubReleaseState: vi.fn(async () => ({ isDraft: false }))
  }
}

describe('v2 update publisher', () => {
  it('accepts only the five explicit release transitions', () => {
    expect(parseV2PublisherArguments([
      'stage-target', '--version', '1.0.1', '--target', 'darwin-arm64'
    ])).toMatchObject({ command: 'stage-target', version: '1.0.1', target: 'darwin-arm64' })
    expect(parseV2PublisherArguments([
      'publish-candidate', '--version', '1.0.1', '--target', 'win32-x64'
    ])).toMatchObject({ command: 'publish-candidate' })
    expect(parseV2PublisherArguments([
      'accept-target', '--version', '1.0.1', '--target', 'darwin-x64'
    ])).toMatchObject({ command: 'accept-target' })
    expect(parseV2PublisherArguments([
      'promote-stable', '--version', '1.0.1', '--confirm-version', '1.0.1'
    ])).toMatchObject({ command: 'promote-stable' })
    expect(parseV2PublisherArguments([
      'reject-version', '--version', '1.0.1', '--confirm-version', '1.0.1',
      '--reason', 'failed acceptance'
    ])).toMatchObject({ command: 'reject-version', reason: 'failed acceptance' })
    for (const invalid of [
      ['stage-target', '--version', '1.0.1'],
      ['promote-stable', '--version', '1.0.1', '--confirm-version', '1.0.2'],
      ['reject-version', '--version', '1.0.1', '--confirm-version', '1.0.1'],
      ['publish-candidate', '--version', '1.0.1-rc.1', '--target', 'darwin-arm64'],
      ['promote-stable', '--version', '1.0.1', '--target', 'darwin-arm64']
    ]) expect(() => parseV2PublisherArguments(invalid)).toThrow()
  })

  it('stages immutable target bytes idempotently and rejects a conflict', async () => {
    const fixture = await releaseFixture()
    const targetDir = await buildTarget(fixture, 'darwin-arm64')
    const oss = new MemoryOss()
    const temporaryDirectory = await operationDirectory(fixture.root, 'stage-op')
    const input = {
      ...commonInput(fixture, oss, temporaryDirectory),
      target: 'darwin-arm64',
      targetDir
    }
    await expect(stageV2Target(input)).resolves.toMatchObject({
      manifest: { version: '1.0.1', target: { platform: 'darwin', arch: 'arm64' } }
    })
    await expect(stageV2Target(input)).resolves.toMatchObject({
      uploaded: expect.arrayContaining([expect.objectContaining({ action: 'verified' })])
    })
    const key = 'desktop/releases/v1.0.1/targets/darwin-arm64/insight-target.json'
    oss.objects.set(key, Buffer.from('conflicting bytes'))
    await expect(stageV2Target(input)).rejects.toThrow('conflicts')
  })

  it('publishes optional per-target Candidate pointers and enforces the global floor', async () => {
    const fixture = await releaseFixture()
    const oss = new MemoryOss()
    const targetDir = await buildTarget(fixture, 'win32-x64')
    const temporaryDirectory = await operationDirectory(fixture.root, 'candidate-op')
    const common = commonInput(fixture, oss, temporaryDirectory)
    await stageV2Target({ ...common, target: 'win32-x64', targetDir })
    const result = await publishV2Candidate({ ...common, target: 'win32-x64' })
    expect(result.pointerAfter).toMatchObject({
      track: 'candidate',
      target: 'win32-x64',
      version: '1.0.1',
      policy: { mode: 'optional' }
    })
    await expect(publishV2Candidate({ ...common, target: 'win32-x64' }))
      .resolves.toMatchObject({ alreadyPublished: true })

    const older = await releaseFixture('1.0.0')
    const olderOss = new MemoryOss()
    olderOss.objects.set(
      'desktop/stable/current.json',
      Buffer.from(JSON.stringify({ schemaVersion: 1, channel: 'stable', version: '1.0.1' }))
    )
    const olderTarget = await buildTarget(older, 'win32-x64')
    const olderTemp = await operationDirectory(older.root, 'floor-op')
    const olderCommon = commonInput(older, olderOss, olderTemp)
    await stageV2Target({ ...olderCommon, target: 'win32-x64', targetDir: olderTarget })
    await expect(publishV2Candidate({ ...olderCommon, target: 'win32-x64' }))
      .rejects.toThrow('below authoritative pointer')
  })

  it('requires matching identities and all three immutable acceptance records', async () => {
    const fixture = await releaseFixture()
    const oss = new MemoryOss()
    const arm = await buildTarget(fixture, 'darwin-arm64')
    const intel = await buildTarget(fixture, 'darwin-x64', 'c'.repeat(40))
    let temporaryDirectory = await operationDirectory(fixture.root, 'identity-op')
    let common = commonInput(fixture, oss, temporaryDirectory)
    await stageV2Target({ ...common, target: 'darwin-arm64', targetDir: arm })
    await stageV2Target({ ...common, target: 'darwin-x64', targetDir: intel })
    await publishV2Candidate({ ...common, target: 'darwin-arm64' })
    await expect(publishV2Candidate({ ...common, target: 'darwin-x64' }))
      .rejects.toThrow('one release identity')

    const clean = await releaseFixture()
    const cleanOss = new MemoryOss()
    temporaryDirectory = await operationDirectory(clean.root, 'incomplete-op')
    common = commonInput(clean, cleanOss, temporaryDirectory)
    const cleanArm = await buildTarget(clean, 'darwin-arm64')
    await stageV2Target({ ...common, target: 'darwin-arm64', targetDir: cleanArm })
    await publishV2Candidate({ ...common, target: 'darwin-arm64' })
    await acceptV2Target({ ...common, target: 'darwin-arm64' })
    await expect(promoteV2Stable(common)).rejects.toThrow('requires Candidate target darwin-x64')
  })

  it('promotes the exact three accepted target bytes and writes Stable last', async () => {
    const fixture = await releaseFixture()
    const oss = new MemoryOss()
    const temporaryDirectory = await operationDirectory(fixture.root, 'promotion-op')
    const common = commonInput(fixture, oss, temporaryDirectory)
    for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const) {
      const targetDir = await buildTarget(fixture, target)
      await stageV2Target({ ...common, target, targetDir })
      await publishV2Candidate({ ...common, target })
      await acceptV2Target({ ...common, target })
    }
    const acceptanceKey = 'desktop/releases/v1.0.1/acceptance/darwin-arm64.json'
    const acceptedBytes = oss.objects.get(acceptanceKey)!
    const corruptAcceptance = JSON.parse(acceptedBytes.toString('utf8'))
    corruptAcceptance.manifestSha512 = Buffer.alloc(64, 7).toString('base64')
    oss.objects.set(acceptanceKey, Buffer.from(JSON.stringify(corruptAcceptance)))
    await expect(promoteV2Stable(common)).rejects.toThrow('Acceptance digest does not match')
    oss.objects.set(acceptanceKey, acceptedBytes)

    const putObject = oss.putObject.bind(oss)
    let interruptStableCommit = true
    oss.putObject = async (key: string, source: string) => {
      if (key === 'desktop/stable/current.json' && interruptStableCommit) {
        interruptStableCommit = false
        throw new Error('simulated pointer interruption')
      }
      return putObject(key, source)
    }
    await expect(promoteV2Stable(common)).rejects.toThrow('simulated pointer interruption')
    expect(common.publishGithubRelease).toHaveBeenCalledOnce()

    const retryDirectory = await operationDirectory(fixture.root, 'promotion-retry')
    const retry = commonInput(fixture, oss, retryDirectory)
    retry.publishGithubRelease.mockResolvedValue(false)
    const result = await promoteV2Stable(retry)
    expect(result.index.targets.map((target: { id: string }) => target.id)).toEqual([
      'darwin-arm64', 'darwin-x64', 'win32-x64'
    ])
    expect(result.pointerAfter).toMatchObject({ track: 'stable', version: '1.0.1' })
    expect(retry.appendGithubIndex).toHaveBeenCalledOnce()
    expect(retry.publishGithubRelease).toHaveBeenCalledOnce()
    const stableBytes = oss.objects.get('desktop/stable/current.json')
    expect(stableBytes).toBeDefined()
    expect(JSON.parse(stableBytes!.toString('utf8'))).toHaveProperty(
      'schema', 'insight-desktop-rollout-envelope/v2'
    )
  })

  it('recovers when CDN verification fails after a Candidate pointer commit', async () => {
    const fixture = await releaseFixture()
    const oss = new MemoryOss()
    const targetDir = await buildTarget(fixture, 'darwin-arm64')
    const temporaryDirectory = await operationDirectory(fixture.root, 'cdn-op')
    const common = commonInput(fixture, oss, temporaryDirectory)
    await stageV2Target({ ...common, target: 'darwin-arm64', targetDir })
    const failed = { ...common, target: 'darwin-arm64', verifyCdn: vi.fn(async () => {
      throw new Error('CDN did not converge')
    }) }
    await expect(publishV2Candidate(failed)).rejects.toThrow('CDN did not converge')
    expect(oss.objects.has('desktop/candidate-v2/darwin-arm64/current.json')).toBe(true)
    await expect(publishV2Candidate({ ...common, target: 'darwin-arm64' }))
      .resolves.toMatchObject({ alreadyPublished: true })
  })

  it('burns a rejected version with an idempotent immutable record', async () => {
    const fixture = await releaseFixture()
    const oss = new MemoryOss()
    const temporaryDirectory = await operationDirectory(fixture.root, 'reject-op')
    const rejectGithubRelease = vi.fn(async () => undefined)
    const input = {
      ...commonInput(fixture, oss, temporaryDirectory),
      reason: 'Windows acceptance failed',
      githubReleaseState: vi.fn(async () => ({ isDraft: true })),
      rejectGithubRelease
    }
    await expect(rejectV2Version(input)).resolves.toMatchObject({ rejected: true })
    await expect(rejectV2Version(input)).resolves.toMatchObject({ rejected: true })
    expect(rejectGithubRelease).toHaveBeenCalledTimes(2)
    await expect(rejectV2Version({ ...input, reason: 'different reason' }))
      .rejects.toThrow('conflicts')
  })

  it('keeps the workflow OIDC-only and Stable pointer publication after GitHub publication', async () => {
    const [workflow, source] = await Promise.all([
      readFile(path.join(projectRoot, '.github', 'workflows', 'publish-update-v2.yml'), 'utf8'),
      readFile(path.join(projectRoot, 'scripts', 'publish-update-v2-to-oss.mjs'), 'utf8')
    ])
    expect(workflow).toContain('id-token: write')
    expect(workflow).toContain('environment: desktop-release')
    expect(workflow).not.toMatch(/OSS_ACCESS_KEY|ALIYUN_|--clobber/u)
    expect(source.indexOf('await input.publishGithubRelease(input.version)'))
      .toBeLessThan(source.indexOf('await commitPointer(input, key, pointerBytes'))
    expect(source).toContain("'x-oss-forbid-overwrite': 'true'")
    expect(source).not.toMatch(/\bexecSync\b|\bspawnSync\b|shell\s*:/u)
  })
})
