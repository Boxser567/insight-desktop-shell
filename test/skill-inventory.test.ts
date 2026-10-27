import { describe, expect, it, vi } from 'vitest'
import { readSkillInventory, type InventoryRoot, type InventoryCandidate } from '../packages/insight-desktop-integration/src/skill-inventory'
const entry = (name = 'example', path = '/shared/example/SKILL.md'): InventoryCandidate => ({ name, description: 'Native description', path, userInvocable: true, provider: 'filesystem' })
const root = (origin: InventoryRoot['origin'], candidates: InventoryCandidate[]): InventoryRoot => ({ origin, list: async () => ({ candidates, complete: true }) })
describe('Shell skill inventory', () => {
  it('keeps platform and both user roots even when absent from the active preset', async () => {
    const rows = await readSkillInventory([root('platform', [entry('platform')]), root('user-account', [entry('account')]), root('user-shared', [entry()])], { skills: [], complete: true }, async () => ({}))
    expect(rows.skills.map(s => s.origin)).toEqual(['platform', 'user-account', 'user-shared'])
    expect(rows.skills.every(s => s.availability === 'outside-composition')).toBe(true)
  })
  it('marks only the actual winning path callable, with one row for duplicate user names', async () => {
    const platform = entry('same', '/app/bundled-skills/same/SKILL.md')
    const account = entry('same', '/account/same/SKILL.md')
    const shared = entry('same', '/shared/same/SKILL.md')
    const rows = await readSkillInventory([root('platform', [platform]), root('user-shared', [shared]), root('user-account', [account])], { skills: [account], complete: true }, async () => ({}))
    expect(rows.skills.map(s => [s.origin, s.availability])).toEqual([['platform', 'shadowed'], ['user-account', 'callable']])
  })
  it('respects disabled user invocation, permits sidecar fallback and strips source spoofing', async () => {
    const candidate = { ...entry(), userInvocable: false }
    const rows = await readSkillInventory([root('user-shared', [candidate])], { skills: [candidate], complete: true }, async () => { throw Error('bad ui') })
    expect(rows.skills[0]).toMatchObject({ name: 'example', description: 'Native description', availability: 'user-disabled' })
    expect(rows.skills[0]).not.toHaveProperty('path')
  })
  it('retains failed root observations as unconfirmed and never treats a failed effective scan as callable', async () => {
    const good = root('user-shared', [entry()])
    await readSkillInventory([good], { skills: [entry()], complete: true }, async () => ({}))
    good.list = vi.fn().mockRejectedValue(Error('permission'))
    const rows = await readSkillInventory([good], { skills: [entry()], complete: true }, async () => ({}))
    expect(rows.complete).toBe(false)
    expect(rows.skills[0]?.availability).toBe('unconfirmed')
    const fresh = await readSkillInventory([root('user-shared', [entry()])], { skills: [entry()], complete: false }, async () => ({}))
    expect(fresh.skills[0]?.availability).toBe('unconfirmed')
  })
})

it('does not mistake an unknown provider for a file skill even when its path and source match', async () => {
  const installed = entry()
  const rows = await readSkillInventory([root('user-shared', [installed])], {skills:[{...installed,provider:'virtual-provider',source:'user-agents'}],complete:true},async()=>({}))
  expect(rows.skills[0]?.availability).toBe('shadowed')
})

it('retains an invalid updating file and confirms removals only after a stable interval', async () => {
  const observer = root('user-shared',[entry()])
  let status: 'present' | 'absent' = 'present'
  observer.checkMissing = async()=>status
  const now = vi.spyOn(Date,'now').mockReturnValue(1000)
  try {
    await readSkillInventory([observer],{skills:[entry()],complete:true},async()=>({}))
    observer.list = async()=>({candidates:[],complete:true})
    let snapshot = await readSkillInventory([observer],{skills:[],complete:true},async()=>({}))
    expect(snapshot.skills[0]?.availability).toBe('invalid')
    status='absent'
    snapshot = await readSkillInventory([observer],{skills:[],complete:true},async()=>({}))
    expect(snapshot.skills[0]?.availability).toBe('unconfirmed')
    now.mockReturnValue(1600)
    snapshot = await readSkillInventory([observer],{skills:[],complete:true},async()=>({}))
    expect(snapshot.skills).toEqual([])
  } finally {now.mockRestore()}
})

it('replaces an old native name when the same original entry parses as a new name', async () => {
  const old = {...entry('old'),entryPath:'/shared/original/SKILL.md'}
  const observer = root('user-shared',[old])
  observer.checkMissing = async()=>'present'
  await readSkillInventory([observer],{skills:[old],complete:true},async()=>({}))
  const renamed = {...old,name:'renamed'}
  observer.list = async()=>({candidates:[renamed],complete:true})
  expect((await readSkillInventory([observer],{skills:[renamed],complete:true},async()=>({}))).skills.map(s=>s.name)).toEqual(['renamed'])
})
