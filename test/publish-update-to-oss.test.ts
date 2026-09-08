import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Production scripts are plain ESM and expose runtime-tested helpers.
import * as publisher from '../scripts/publish-update-to-oss.mjs'

const {
  acquirePublisherLock,
  assertBucketVersioningDisabled,
  assertExactRemoteFiles,
  assertNoOssCredentialEnvironment,
  ossArguments,
  parseObjectList,
  parsePublisherArguments
} = publisher

const script = path.join(process.cwd(), 'scripts', 'publish-update-to-oss.mjs')
const common = [
  '--bucket', 'insight-desktop-updates',
  '--origin', 'https://updates.insight-aigc.com',
  '--profile', 'desktop-updates-publisher'
]

describe('local OSS update publisher', () => {
  it('accepts only the fixed stage and explicitly confirmed promote commands', () => {
    expect(parsePublisherArguments([
      'stage', '--tag', 'v0.1.2-rc.2', ...common
    ])).toMatchObject({ command: 'stage', channel: 'candidate', version: '0.1.2-rc.2' })
    expect(parsePublisherArguments([
      'promote', '--tag', 'v0.1.2', ...common, '--confirm-version', '0.1.2'
    ])).toMatchObject({ command: 'promote', channel: 'stable', version: '0.1.2' })

    for (const invalid of [
      ['stage', '--tag', 'v0.1.2', ...common, '--unknown', 'value'],
      ['stage', '--tag', 'v0.1.2;rm', ...common],
      ['stage', '--tag', 'v0.1.2', ...common.slice(0, 1), 'another-bucket', ...common.slice(2)],
      ['stage', '--tag', 'v0.1.2', ...common.slice(0, 3), 'https://attacker.example', ...common.slice(4)],
      ['promote', '--tag', 'v0.1.2', ...common, '--confirm-version', '0.1.3']
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
      ...common,
      '--access-key-secret', 'forbidden'
    ], { encoding: 'utf8', env: { PATH: process.env.PATH } })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Usage:')
  })

  it('pins the local profile and disables ossutil credential environment lookup', () => {
    expect(ossArguments(['api', 'put-object'], 'desktop-updates-publisher')).toEqual([
      'api', 'put-object',
      '--profile', 'desktop-updates-publisher',
      '--ignore-env-var',
      '--loglevel', 'off'
    ])
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

  it('parses the bounded OSS JSON listing and rejects truncated output', () => {
    expect(parseObjectList(JSON.stringify({
      IsTruncated: false,
      Contents: [{ Key: 'desktop/file', Size: 12 }]
    }))).toEqual([{ key: 'desktop/file', size: 12 }])
    expect(() => parseObjectList(JSON.stringify({
      IsTruncated: true,
      Contents: []
    }))).toThrow('more objects')
    expect(() => assertBucketVersioningDisabled('{}')).not.toThrow()
    expect(() => assertBucketVersioningDisabled('{"Status":"Enabled"}')).toThrow(
      'versioning must remain unconfigured'
    )
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
    const commitPointer = source.indexOf('await uploadPointer(options, pointer)')

    expect(publishRelease).toBeGreaterThan(0)
    expect(commitPointer).toBeGreaterThan(publishRelease)
    expect(source.match(/'--forbid-overwrite'/g)).toHaveLength(1)
    expect(source).not.toMatch(/\bexecSync\b|\bspawnSync\b|shell\s*:/)
  })
})
