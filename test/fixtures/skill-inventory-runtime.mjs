import assert from 'node:assert/strict'
import { mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { apply as applyFilesystem } from '@deepseek-ai/dsh-skill-filesystem'
import { DesktopSkillCatalog } from './inventory.mjs'
const ctx = new Context()
new TypertRegistry(ctx)
const registry = new SkillRegistry(ctx)
const agentsHome = join(resolve('.'), 'configured-agents')
const home = process.env.DSH_HOME, shared = join(agentsHome, 'skills'), platform = process.env.DSH_BUNDLED_SKILL_DIR
const createSkill = async (root, name) => {
  const dir = join(root, name)
  await mkdir(dir, {recursive:true})
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Native ${name}\n---\nInstructions`)
  await writeFile(join(dir, 'ui.json'), '{"displayName":"中文技能","shortDescription":"简短说明"}')
  return join(dir, 'SKILL.md')
}
await createSkill(platform, 'platform-skill')
const accountPath = await createSkill(join(home, 'skills'), 'account-skill')
await createSkill(shared, 'shared-skill')
const winner = {name:'account-skill',description:'Native account-skill',path:await realpath(accountPath),invocation:{userInvocable:true,modelInvocable:true},source:'user-dsh',provider:'fixture',content:'Instructions'}
// Existing execution composition is independently owned. The inventory must not change it.
const unregisterFixture = registry.register(winner)
let live, projectedDirectory
const changedDirectory = join(resolve('.'),'changed-project')
ctx.provide('agents', {get:()=>live})
ctx.provide('workingDirectory', {defaultDirectory:resolve('.'),ensure:async agent=>{assert.equal(agent,live);return changedDirectory}})
ctx.provide('sessionQuery', {observeSession:async id => {if(id!=='fixture-session')throw Error('unknown session');return {header:{cwd:resolve('.')},projections:{values:{workingDirectory:projectedDirectory}},[Symbol.dispose](){}}}})
new DesktopSkillCatalog(ctx, {agentsHome})
const gateway = new TypertGatewayService(ctx, {})
const peer = new Peer(ctx, {principal:{kind:'owner'},interactions:'none'})
const request = {namespace:'desktopSkills',method:'list',args:{request:{sessionId:'fixture-session'}},peer}
let nativeFiber
try {
  let result = await gateway.invoke(request)
  assert.equal(result.skills.length,3)
  assert.equal(result.skills.find(s=>s.origin==='user-account').availability,'shadowed')
  assert.equal(result.skills.find(s=>s.origin==='user-shared').availability,'outside-composition')
  assert.equal(result.skills[0].displayName,'中文技能')
  assert.ok(result.skills.every(s=>!('path' in s)))
  ctx.provide('agentPresets',{acquireScope:async()=>{throw Error('Deleted historical preset')},serviceFor:()=>undefined})
  assert.equal((await gateway.invoke(request)).skills.length,3)
  unregisterFixture()
  nativeFiber = ctx.plugin({ name: 'fixture-native-skills', inject: ['skills'], apply: c => applyFilesystem(c, { includeDefaultRoots: true, agentsHome, dshHome: home, watchStabilityThresholdMs: 25, watchPollIntervalMs: 10 }) })
  await nativeFiber
  assert.ok((await registry.list()).some(s=>s.name==='shared-skill'), 'Native provider must mount before watcher verification')
  await createSkill(join(changedDirectory,'.agents','skills'),'shared-skill')
  projectedDirectory=changedDirectory
  result=await gateway.invoke(request)
  assert.equal(result.skills.find(s=>s.name==='shared-skill').availability,'shadowed','Cold sessions must use their committed working directory')
  projectedDirectory=undefined
  live={}
  result=await gateway.invoke(request)
  assert.equal(result.skills.find(s=>s.name==='shared-skill').availability,'shadowed','Live sessions must use the Core working-directory service')
  live=undefined
  result=await gateway.invoke(request)
  assert.equal(result.skills.find(s=>s.name==='shared-skill').availability,'callable','Returning to the original project must restore the global winner')
  await createSkill(shared,'agent-installed')
  const deadline = Date.now()+5000
  while (!(await registry.list()).some(s=>s.name==='agent-installed')) {
    if(Date.now()>deadline) throw Error('Native Core watcher did not invalidate its registry')
    await new Promise(r=>setTimeout(r,30))
  }
  result = await gateway.invoke(request)
  assert.equal(result.skills.find(s=>s.name==='agent-installed').availability,'callable')
  assert.equal((await registry.get('agent-installed')).content.trim(),'Instructions')
  await writeFile(join(shared,'agent-installed','ui.json'),'{"displayName":"更新名称"}')
  result = await gateway.invoke(request)
  assert.equal(result.skills.find(s=>s.name==='agent-installed').displayName,'更新名称')
  await rm(join(shared,'agent-installed'),{recursive:true})
  await gateway.invoke(request)
  await new Promise(r=>setTimeout(r,550))
  result = await gateway.invoke(request)
  assert.ok(!result.skills.some(s=>s.name==='agent-installed'))
  const external = join(resolve('.'),'linked-target')
  await createSkill(resolve('.'),'linked-target')
  await symlink(external,join(shared,'linked-alias'))
  result = await gateway.invoke(request)
  assert.ok(result.skills.some(s=>s.name==='linked-target'))
  await rm(join(shared,'linked-alias'))
  await gateway.invoke(request)
  await new Promise(r=>setTimeout(r,550))
  result = await gateway.invoke(request)
  assert.ok(!result.skills.some(s=>s.name==='linked-target'),'Deleting a link must not retain its still-existing target')
  await writeFile(join(shared,'ui.json'),'{"displayName":"Must not label flat files"}')
  await symlink(join(external,'SKILL.md'),join(shared,'flat-link.md'))
  result = await gateway.invoke(request)
  assert.equal(result.skills.find(s=>s.name==='linked-target').displayName,undefined,'Flat links to SKILL.md must not read a root-wide sidecar')
  await rm(join(shared,'flat-link.md'))
  await gateway.invoke(request)
  await new Promise(r=>setTimeout(r,550))
  result = await gateway.invoke(request)
  assert.ok(!result.skills.some(s=>s.name==='linked-target'),'Deleting a flat link must remove its original discovery entry')
  const flatPath = join(shared,'flat-alias.md')
  await writeFile(flatPath,'---\nname: flat-old\ndescription: Flat\n---\nInstructions')
  await gateway.invoke(request)
  await writeFile(flatPath,'---\nname: flat-renamed\ndescription: Flat\n---\nInstructions')
  result = await gateway.invoke(request)
  assert.ok(result.skills.some(s=>s.name==='flat-renamed'))
  assert.ok(!result.skills.some(s=>s.name==='flat-old'),'A valid rename must replace the old row')
  await nativeFiber.dispose()
  nativeFiber = undefined
  assert.equal((await registry.list()).length,0)
  await assert.rejects(()=>gateway.invoke({...request,args:{request:{sessionId:42}}}))
  await assert.rejects(()=>gateway.invoke({...request,args:{request:{sessionId:'unknown'}}}))
  console.log('inventory runtime passed')
} finally { await nativeFiber?.dispose(); await peer.dispose() }
