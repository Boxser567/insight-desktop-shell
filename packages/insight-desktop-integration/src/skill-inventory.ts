import { createHash } from 'node:crypto'
import type { SkillOrigin, SkillInventorySnapshot, InventorySkill } from './skill-inventory-contract'
import type { SkillPresentation } from './skill-presentation'

export interface InventoryCandidate {
  name: string
  description: string
  path?: string
  userInvocable: boolean
  source?: string
  provider?: string
  invalid?: boolean
  directory?: string
  entryPath?: string
}
export interface InventoryRoot {
  origin: SkillOrigin
  checkMissing?(candidate: InventoryCandidate): Promise<'present' | 'absent' | 'unknown'>
  list(): Promise<{ candidates: readonly InventoryCandidate[]; complete: boolean }>
}
const missingSince = new WeakMap<InventoryRoot, Map<string, number>>()
const REMOVAL_STABILITY_MS = 500
const lastGood = new WeakMap<InventoryRoot, readonly InventoryCandidate[]>()
/** Core normalizes filesystem paths. Windows comparison must ignore case and separators. */
export function skillPathKey(path?: string): string {
  if (!path) return ''
  const normalized = path.replace(/\\/gu, '/')
  return process.platform === 'win32' || /^[a-z]:\//iu.test(normalized) ? normalized.toLowerCase() : normalized
}

/** Read-only product projection. No registration or alternate precedence decisions. */
export async function readSkillInventory(
  roots: readonly InventoryRoot[],
  effective: { skills: readonly InventoryCandidate[]; complete: boolean },
  readPresentation: (candidate: InventoryCandidate) => Promise<SkillPresentation>,
  signal?: AbortSignal
): Promise<SkillInventorySnapshot> {
  let complete = effective.complete
  const winners = new Map(effective.skills.map(skill => [skill.name, skill]))
  const rows: InventorySkill[] = []
  for (const root of roots) {
    signal?.throwIfAborted()
    let observed: { candidates: readonly InventoryCandidate[]; complete: boolean }
    try {
      observed = await root.list()
      if (observed.complete) {
        const retained: InventoryCandidate[] = []
        const missing = missingSince.get(root) ?? new Map<string, number>()
        missingSince.set(root, missing)
        for (const old of lastGood.get(root) ?? []) {
          const key = `${old.name}\0${old.path}`
          if (observed.candidates.some(candidate => old.entryPath ? candidate.entryPath === old.entryPath : candidate.path === old.path)) { missing.delete(key); continue }
          if (!root.checkMissing) continue
          let status: 'present' | 'absent' | 'unknown' = 'unknown'
          try { status = await root.checkMissing(old) } catch { /* Preserve unreadable entries. */ }
          if (status === 'present') { retained.push({ ...old, invalid: true }); missing.delete(key) }
          else {
            if (!missing.has(key)) missing.set(key, Date.now())
            if (status === 'unknown' || Date.now() - missing.get(key)! < REMOVAL_STABILITY_MS) {
              retained.push(old)
              observed.complete = false
            } else missing.delete(key)
          }
        }
        observed.candidates = [...observed.candidates, ...retained]
        lastGood.set(root, observed.candidates)
      } else observed = { candidates: lastGood.get(root) ?? observed.candidates, complete: false }
    } catch {
      observed = { candidates: lastGood.get(root) ?? [], complete: false }
    }
    if (!observed.complete) complete = false
    for (const candidate of observed.candidates) {
      signal?.throwIfAborted()
      const winner = winners.get(candidate.name)
      const expectedSource = root.origin === 'platform' ? 'bundled' : root.origin === 'user-account' ? 'user-dsh' : 'user-agents'
      const same = !!candidate.path && skillPathKey(winner?.path) === skillPathKey(candidate.path) && (!winner?.source || winner.source === expectedSource) && winner?.provider === 'filesystem'
      let ui: SkillPresentation = {}
      try { ui = await readPresentation(candidate) } catch { /* Optional labels cannot disable valid skills. */ }
      rows.push({
        entryId: createHash('sha256').update(`${root.origin}\0${candidate.name}\0${candidate.directory ?? candidate.path ?? ''}`).digest('hex'),
        name: candidate.name, description: candidate.description, ...ui, origin: root.origin, order: rows.length,
        availability: !observed.complete || !effective.complete ? 'unconfirmed' : candidate.invalid ? 'invalid' : !candidate.userInvocable || (same && !winner?.userInvocable) ? 'user-disabled' : same ? 'callable' : winner ? 'shadowed' : 'outside-composition'
      })
    }
  }
  // Merge duplicate global names for presentation, preferring only an actual Core winner.
  const users = new Map<string, InventorySkill>()
  for (const row of rows.filter(s => s.origin !== 'platform')) {
    const previous = users.get(row.name)
    if (!previous || row.availability === 'callable') users.set(row.name, row)
  }
  return { skills: [...rows.filter(s => s.origin === 'platform'), ...users.values()], complete }
}
