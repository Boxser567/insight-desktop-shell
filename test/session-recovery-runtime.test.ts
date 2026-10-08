import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifySessionRecovery } from '../scripts/verify-session-recovery.mjs'

const runtime = resolve(process.env.INSIGHT_TEST_CORE_RUNTIME ?? 'build/core-runtime')
const available = existsSync(resolve(runtime, 'runtime.json'))
if (process.env.INSIGHT_TEST_CORE_RUNTIME && !available) throw new Error('Selected Core Runtime is missing.')
const previous = process.env.INSIGHT_PREVIOUS_CORE_RUNTIME
if (previous && !existsSync(resolve(previous, 'runtime.json'))) throw new Error('Selected previous Core Runtime is missing.')

describe.skipIf(!available)('real Candidate session recovery', () => {
  it('reads and continues native v4 text, tools and developer changes across process restarts', async () => {
    const report = await verifySessionRecovery({ candidateRuntime: runtime, recoveryRuntime: runtime })
    expect(report.candidate.core.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(report.recovery.core).toEqual(report.candidate.core)
    expect(report.phases.map(phase => phase.phase)).toEqual(['candidate', 'recovery', 'verify'])
    expect(report.phases.every(phase => phase.writer === 4)).toBe(true)
    expect(report.phases.at(-1)?.sessions).toEqual([
      expect.objectContaining({ id: 'native-recovery', toolResults: 1, developerMessages: 1, turns: 2 })
    ])
  }, 30000)

  it('refuses a nonexistent recovery Runtime before running a probe', async () => {
    await expect(verifySessionRecovery({ candidateRuntime: runtime, recoveryRuntime: resolve(runtime, 'missing') }))
      .rejects.toThrow()
  })

  it.runIf(Boolean(previous))('migrates real v3 tool history without rewriting its committed generation', async () => {
    const report = await verifySessionRecovery({ candidateRuntime: runtime, recoveryRuntime: runtime, previousRuntime: previous })
    expect(report.phases.map(phase => phase.writer)).toEqual([3, 4, 4, 4])
    expect(Object.keys(report.preservedHistoricalFiles ?? {}).length).toBeGreaterThan(0)
    expect(report.phases.at(-1)?.sessions).toContainEqual(
      expect.objectContaining({ id: 'migrated-recovery', toolResults: 2, developerMessages: 1, turns: 3 })
    )
  }, 30000)

  it.runIf(Boolean(previous))('rejects the actual old Core when it tries to recover Candidate v4 data', async () => {
    if (!previous) throw new Error('Previous Core Runtime is required.')
    await expect(verifySessionRecovery({ candidateRuntime: runtime, recoveryRuntime: previous }))
      .rejects.toThrow(/uses log format v4.*reads only v3/s)
  }, 30000)
})
