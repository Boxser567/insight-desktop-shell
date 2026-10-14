import vm from 'node:vm'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
let exports
const host={location:{origin:'http://127.0.0.1:3000'},__ModuleLoader__:{load(module){assert.equal(module.id,'@insight-ai/desktop-canvas-plugin');exports=module.factory(()=>({}))}}}
vm.runInNewContext(await readFile('/private/tmp/canvas-agent-task-1-4-3/packed-client.js','utf8'),{window:host,URL,crypto:globalThis.crypto})
const effects=new Map();let opened=0
exports.apply({effect(fn,label){effects.set(label,fn())},sidebarRightTabs:{register(){return()=>{}}},slots:{inject(){return()=>{}},register(){return()=>{}}},sidebarRight:{openResource(){opened++}}})
assert.ok(host.__INSIGHT_CANVAS_RUNTIME_V1__)
effects.get('desktop-canvas: tab body')();assert.ok(host.__INSIGHT_CANVAS_RUNTIME_V1__)
effects.get('desktop-canvas: service runtime')();assert.equal(host.__INSIGHT_CANVAS_RUNTIME_V1__,undefined)
assert.equal(opened,0)
const result={status:'passed',runtime:process.version,proof:'actual npm-packed Client module factory/apply evaluated; lazy runtime lifecycle independent of tab body; no canvas opened'}
await writeFile('/private/tmp/canvas-agent-task-1-4-3/packed-client-smoke.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
