import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Production scripts are plain ESM and expose runtime-tested helpers.
import * as publisher from '../scripts/publish-update-to-oss.mjs'

const {
  acquirePublisherLock,
  assertExactRemoteFiles,
  assertNoOssCredentialEnvironment,
  parsePublisherArguments
} = publisher

const script = path.join(process.cwd(), 'scripts', 'publish-update-to-oss.mjs')

describe('GitHub Actions OSS update publisher', () => {
  it('accepts only the fixed stage and explicitly confirmed promote commands', () => {
    expect(parsePublisherArguments([
      'stage', '--tag', 'v0.1.2-rc.2'
    ])).toEqual({
      command: 'stage',
      tag: 'v0.1.2-rc.2',
      channel: 'candidate',
      version: '0.1.2-rc.2',
      bucket: 'insight-desktop-updates',
      origin: 'https://updates.insight-aigc.com'
    })
    expect(parsePublisherArguments([
      'promote', '--tag', 'v0.1.2', '--confirm-version', '0.1.2'
    ])).toMatchObject({ command: 'promote', channel: 'stable', version: '0.1.2' })

    for (const invalid of [
      ['stage', '--tag', 'v0.1.2', '--unknown', 'value'],
      ['stage', '--tag', 'v0.1.2;rm'],
      ['stage', '--tag', 'v0.1.2', '--bucket', 'another-bucket'],
      ['stage', '--tag', 'v0.1.2', '--origin', 'https://attacker.example'],
      ['stage', '--tag', 'v0.1.2', '--profile', 'desktop-updates-publisher'],
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
