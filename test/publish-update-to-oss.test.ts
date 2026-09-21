import { spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Production scripts are plain ESM and expose runtime-tested helpers.
import * as publisher from '../scripts/publish-update-to-oss.mjs'

const {
  acquirePublisherLock,
  assertExactRemoteFiles,
  assertNoOssCredentialEnvironment,
  parsePublisherArguments,
  uploadImmutableRelease
} = publisher

const script = path.join(process.cwd(), 'scripts', 'publish-update-to-oss.mjs')

describe('GitHub Actions OSS update publisher', () => {
  it('verifies existing bytes before filling missing assets and never overwrites conflicts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'oss-stage-test-'))
    const prefix = 'desktop/releases/v1.0.0-rc.17/'
    const files = ['a.dmg', 'b.zip'].map((name) => ({ name, size: 3,
      sha512: createHash('sha512').update('abc').digest('base64') }))
    const remote = new Map<string, string>([[`${prefix}a.dmg`, 'abc']])
    const oss = {
      listObjects: async () => [...remote].map(([key, value]) => ({ key, size: Buffer.byteLength(value) })),
      getObject: async (key: string, destination: string) => writeFile(destination, remote.get(key)!),
      uploadReleaseObject: vi.fn(async (key: string, source: string, headers: Record<string, string>) => {
        expect(headers['x-oss-forbid-overwrite']).toBe('true')
        expect(remote.has(key)).toBe(false)
        remote.set(key, await readFile(source, 'utf8'))
      })
    }
    try {
      await writeFile(path.join(directory, 'b.zip'), 'abc')
      await expect(uploadImmutableRelease({ version: '1.0.0-rc.17' }, directory, files, oss)).resolves.toMatchObject({ reused: false })
      expect(oss.uploadReleaseObject).toHaveBeenCalledTimes(1)
      await expect(uploadImmutableRelease({ version: '1.0.0-rc.17' }, directory, files, oss)).resolves.toMatchObject({ reused: true })
      expect(oss.uploadReleaseObject).toHaveBeenCalledTimes(1)
      remote.delete(`${prefix}b.zip`)
      remote.set(`${prefix}a.dmg`, 'xyz')
      await expect(uploadImmutableRelease({ version: '1.0.0-rc.17' }, directory, files, oss)).rejects.toThrow('content differs')
      remote.set(`${prefix}a.dmg`, 'longer')
      await expect(uploadImmutableRelease({ version: '1.0.0-rc.17' }, directory, files, oss)).rejects.toThrow('different assets')
      remote.set(`${prefix}a.dmg`, 'abc')
      remote.set(`${prefix}extra`, 'abc')
      await expect(uploadImmutableRelease({ version: '1.0.0-rc.17' }, directory, files, oss)).rejects.toThrow('unexpected')
      expect(oss.uploadReleaseObject).toHaveBeenCalledTimes(1)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('accepts only the fixed stage and explicitly confirmed promote commands', () => {
    expect(parsePublisherArguments([
      'stage', '--tag', 'v0.1.2-rc.2'
    ])).toEqual({
      command: 'stage',
      tag: 'v0.1.2-rc.2',
      channel: 'candidate',
      version: '0.1.2-rc.2',
      scope: 'all',
      bucket: 'insight-desktop-updates',
      origin: 'https://updates.insight-aigc.com'
    })
    expect(parsePublisherArguments([
      'promote', '--tag', 'v0.1.2', '--confirm-version', '0.1.2'
    ])).toMatchObject({ command: 'promote', channel: 'stable', version: '0.1.2' })
    expect(parsePublisherArguments([
      'stage', '--tag', 'v0.1.2-rc.4', '--scope', 'macos-arm64'
    ])).toMatchObject({ channel: 'candidate', scope: 'macos-arm64' })

    expect(parsePublisherArguments([
      'stage', '--tag', 'v0.1.2-rc.4', '--scope', 'windows-x64'
    ])).toMatchObject({ channel: 'candidate', scope: 'windows-x64' })

    for (const invalid of [
      ['stage', '--tag', 'v0.1.2', '--unknown', 'value'],
      ['stage', '--tag', 'v0.1.2;rm'],
      ['stage', '--tag', 'v0.1.2', '--bucket', 'another-bucket'],
      ['stage', '--tag', 'v0.1.2', '--origin', 'https://attacker.example'],
      ['stage', '--tag', 'v0.1.2', '--profile', 'desktop-updates-publisher'],
      ['stage', '--tag', 'v0.1.2', '--scope', 'macos-arm64'],
      ['stage', '--tag', 'v0.1.2', '--scope', 'windows-x64'],
      ['stage', '--tag', 'v0.1.2', '--confirm-version', '0.1.2'],
      ['promote', '--tag', 'v0.1.2', '--confirm-version', '0.1.3']
    ]) {
      expect(() => parsePublisherArguments(invalid)).toThrow()
    }
  })

  it('never accepts OSS credentials from command arguments or the process environment', () => {
    expect(() => assertNoOssCredentialEnvironment({
      PATH: '/usr/bin',
      OSS_ACCESS_KEY_SECRET: 'must-not-be-used'
    })).toThrow('Remove OSS credential or config environment variables')
    expect(() => assertNoOssCredentialEnvironment({
      PATH: '/usr/bin',
      OSSUTIL_CONFIG_FILE: '/tmp/untrusted-config'
    })).toThrow('Remove OSS credential or config environment variables')
    const result = spawnSync(process.execPath, [
      script,
      'stage',
      '--tag', 'v0.1.2',
      '--access-key-secret', 'forbidden'
    ], { encoding: 'utf8', env: { PATH: process.env.PATH } })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Usage:')
  })

  it('allows only a complete byte-sized immutable prefix on rerun', () => {
    const files = [
      { name: 'a.bin', size: 10 },
      { name: 'b.bin', size: 20 }
    ]
    const exact = [
      { key: 'desktop/releases/v0.1.2/a.bin', size: 10 },
      { key: 'desktop/releases/v0.1.2/b.bin', size: 20 }
    ]
    expect(() => assertExactRemoteFiles(exact, files, 'desktop/releases/v0.1.2/')).not.toThrow()
    expect(() => assertExactRemoteFiles(exact.slice(0, 1), files, 'desktop/releases/v0.1.2/')).toThrow('partial')
    expect(() => assertExactRemoteFiles([
      exact[0],
      { ...exact[1], size: 21 }
    ], files, 'desktop/releases/v0.1.2/')).toThrow('differs')
  })

  it('prevents two publishers on the same machine', async () => {
    const release = await acquirePublisherLock()
    try {
      await expect(acquirePublisherLock()).rejects.toThrow('Another local desktop update publisher')
    } finally {
      await release()
    }
  })

  it('publishes GitHub before the sole mutable pointer commit without shell commands', async () => {
    const source = await readFile(script, 'utf8')
    const publishRelease = source.indexOf('const githubPublished = await publishGithubRelease')
    const commitPointer = source.indexOf('await uploadPointer(options, pointer, oss)')
    const verifyCommittedPointer = source.indexOf("'committed',")

    expect(publishRelease).toBeGreaterThan(0)
    expect(commitPointer).toBeGreaterThan(publishRelease)
    expect(verifyCommittedPointer).toBeGreaterThan(commitPointer)
    expect(source).toContain("'x-oss-forbid-overwrite': 'true'")
    expect(source).toContain("distributionVerification: 'deferred-to-mainland-acceptance'")
    expect(source).not.toContain('verifyCdn')
    expect(source).not.toContain('ossutil')
    expect(source).not.toContain('desktop-updates-publisher')
    expect(source).not.toMatch(/\bexecSync\b|\bspawnSync\b|shell\s*:/)
  })
})
