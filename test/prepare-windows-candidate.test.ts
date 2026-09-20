import { describe, expect, it } from 'vitest'
// @ts-expect-error Release helper is plain ESM.
import { validateSourceRun } from '../scripts/prepare-windows-candidate.mjs'

const run = { repository: { full_name: 'Boxser567/insight-desktop-shell' },
  path: '.github/workflows/release.yml', event: 'workflow_dispatch', status: 'completed',
  conclusion: 'success', head_sha: 'a'.repeat(40) }
const policy = { releaseVersion: '1.0.0-rc.15', channel: 'candidate', mode: 'optional' }
const lock = { releaseTag: 'runtime-test', targets: { win: { core: { commit: 'b'.repeat(40) } } } }
const validate = (source = run, releasePolicy = policy, version = '1.0.0-rc.15') =>
  validateSourceRun(source, 'v1.0.0-rc.15', releasePolicy, version, lock)

describe('existing Windows build provenance', () => {
  it('keeps the original build commit and Runtime identity', () => {
    expect(validate()).toMatchObject({ shellCommit: run.head_sha, core: { releaseTag: 'runtime-test' } })
  })
  it.each([
    { conclusion: 'cancelled' }, { event: 'pull_request' }, { status: 'in_progress' },
    { path: '.github/workflows/other.yml' }, { head_sha: 'main' },
    { repository: { full_name: 'another/repository' } }
  ])('rejects untrusted or unfinished build %j', (patch) => {
    expect(() => validate({ ...run, ...patch })).toThrow()
  })
  it('rejects mismatched versions and required policies', () => {
    expect(() => validate(run, policy, '1.0.0-rc.13')).toThrow()
    expect(() => validate(run, { ...policy, mode: 'required' })).toThrow()
  })
})
