import { describe, expect, it, vi } from 'vitest'
import { parseInventoryRequest, parseInventorySnapshot } from '../packages/insight-desktop-integration/src/skill-inventory-contract'
import { createSkillCatalog, filterSkills } from '../packages/insight-desktop-integration/src/skill-catalog'

describe('skill inventory boundary and client', () => {
  it.each([null, {}, {sessionId:42}, {sessionId:''}, {sessionId:'x\n'}])('rejects invalid session input %j', input => {
    expect(()=>parseInventoryRequest(input)).toThrow()
  })
  it('validates response and strips arbitrary paths or executable metadata', () => {
    const row = {entryId:'a',name:'example',description:'Native',origin:'user-shared',availability:'callable',order:0,path:'/private',instructions:'ignored'}
    expect(parseInventorySnapshot({skills:[row],complete:true}).skills[0]).not.toHaveProperty('path')
    expect(()=>parseInventorySnapshot({skills:[{...row,origin:'project'}],complete:true})).toThrow()
  })
  it('mounts the Shell Remote once, separates tabs and re-reads labels on every refresh', async () => {
    const list = vi.fn().mockResolvedValue({ok:true,value:{skills:[{entryId:'one',name:'new-skill',description:'Native',displayName:'新增技能',origin:'user-account',availability:'callable',order:0}],complete:true}})
    const mount = vi.fn().mockResolvedValue(async()=>{})
    const ctx = {get:(key:string)=>key==='remote.desktopSkills'?{list}:undefined,remote:{$mount:mount},on:vi.fn()}
    const catalog = createSkillCatalog(ctx as never)
    const rows = await catalog.list('session' as never)
    expect(filterSkills(rows,'')).toEqual([])
    expect(filterSkills(rows,'新增','user')).toHaveLength(1)
    await catalog.list('session' as never)
    expect(mount).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(2)
  })
})

it('coalesces overlapping refreshes for a slow session instead of starving every response', async () => {
  let finish!: (value: unknown)=>void
  const list = vi.fn(()=>new Promise(resolve=>{finish=resolve}))
  const ctx = {get:(key:string)=>key==='remote.desktopSkills'?{list}:undefined,remote:{$mount:async()=>async()=>{}},on:vi.fn()}
  const catalog = createSkillCatalog(ctx as never)
  const first = catalog.list('slow-session' as never)
  const second = catalog.list('slow-session' as never)
  await vi.waitFor(()=>expect(list).toHaveBeenCalledTimes(1))
  finish({ok:true,value:{skills:[],complete:true}})
  await expect(first).resolves.toEqual([])
  await expect(second).resolves.toEqual([])
})
