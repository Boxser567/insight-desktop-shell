import { chromium } from '/Users/boxser.shi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const folder='/private/tmp/canvas-agent-task-1-4-final'
const session=JSON.parse(await readFile(`${folder}/isolated/browser-session.json`,'utf8'))
assert.match(session.base,/^http:\/\/127\.0\.0\.1:\d+$/)
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const context=await browser.newContext({viewport:{width:1500,height:1000}})
const counts={get:0,model:0,partial:0,invoke:0}
const operations=[]; const errors=[]; let version=18; let nodes=[]; let taskStatus='FINISHED'; let runningId
const model={model_name:'本地验收模型',parameters:{gen_count:{default:1,choices:[1,2].map(value=>({value,label:String(value)}))}},senoir_parameters:{},maxPrompt:10000}
const config={text:{fixture:model},image:{text_to_image:{name:'文生图',models:{fixture:model}}},video:{text_to_video:{name:'文生视频',models:{fixture:model}}},audio:{music_gen:{name:'音乐',models:{fixture:model}}}}
const send=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify({code:'SUCCESS',data,msg:''})})
try {
  await context.route('**/*',async route=>{
    const request=route.request();const url=new URL(request.url())
    if(url.origin!==session.base)return route.fulfill({status:403,body:'External traffic disabled in local fixture verification'})
    if(url.pathname==='/desktop-canvas/api/model-params'){counts.model++;return route.fulfill({contentType:'application/json',body:JSON.stringify(config)})}
    if(url.pathname.startsWith('/desktop-canvas/api/legacy/')){
      const path=url.pathname.slice('/desktop-canvas/api/legacy/'.length)
      const input=request.method()==='GET'?{}:JSON.parse(request.postData()||'{}')
      if(path.endsWith('/canvas/get')){
        counts.get++
        if(runningId){nodes=nodes.map(node=>node.id===runningId?{...node,data:{...node.data,value:session.base+'/fixture-output.png',product:[],taskInfo:{status:'success',taskId:'fixture-task'}}}:node);version++;taskStatus='SUCCESS';runningId=undefined}
        return send(route,{data:JSON.stringify({nodes,edges:[]}),versionNumber:String(version),taskStatus,name:'1.4 本地隔离验收',temp:false,templateId:0,thumbnailUrl:''})
      }
      if(path.endsWith('/canvas/partialUpdate')){
        counts.partial++;operations.push({action:'save',inputVersion:input.versionNumber})
        assert.equal(input.versionNumber,String(version))
        const deletions=new Set(input.deleteNodeIds||[]);nodes=nodes.filter(node=>!deletions.has(node.id));
        for(const encoded of input.addNodes||[])nodes.push(JSON.parse(encoded))
        for(const encoded of input.updateNodes||[]){const patch=JSON.parse(encoded);nodes=nodes.map(node=>node.id===patch.id?{...node,...patch,data:{...node.data,...patch.data}}:node)}
        version++;return send(route,{versionNumber:String(version)})
      }
      if(path.endsWith('/workflow/invoke')){
        counts.invoke++;operations.push({action:'invoke',inputVersion:input.versionNumber});assert.equal(input.versionNumber,String(version));version++;runningId=input.runningNodeIds[0];taskStatus='RUNNING';return send(route,{versionNumber:String(version),taskId:'fixture-task'})
      }
      if(path.endsWith('/getAvailableCapacity'))return send(route,{usedCapacity:0,limitCapacity:100})
      if(path.endsWith('/account/balance'))return send(route,{rechargeBalance:100,giftBalance:0})
      if(path.endsWith('/getAllRule'))return send(route,[])
      if(path.endsWith('/calculateWorkflowCost')||path.includes('/cost/'))return send(route,{discount_applied:false,original_points:1})
      return send(route,[])
    }
    if(url.pathname==='/fixture-output.png')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kL5sAAAAASUVORK5CYII=','base64')})
    return route.continue()
  })
  await context.addCookies(session.cookie.split('; ').map(item=>{const i=item.indexOf('=');return{name:item.slice(0,i),value:item.slice(i+1),url:session.base}}))
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
  const rootResponse = await page.goto(session.base); const mainCsp = rootResponse.headers()['content-security-policy'] ?? null;await page.waitForFunction(()=>!!window.__INSIGHT_CANVAS_RUNTIME_V1__,undefined,{timeout:20000})
  const initial=await page.evaluate(async()=>{
    const before=document.querySelectorAll('iframe[src*="/desktop-canvas/view"]').length
    const rt=await window.__INSIGHT_CANVAS_RUNTIME_V1__.ready
    const info=await rt.ensureContext({canvasId:'2873',capability:'edit'})
    const read=await rt.execute({canvasId:'2873',operation:{action:'canvas.read'}})
    const add=await rt.execute({canvasId:'2873',operation:{action:'node.add',expectedVersion:read.version,node:{type:'text',changes:{title:'验收文本',text:'初始内容'}}}})
    const update=await rt.execute({canvasId:'2873',operation:{action:'node.update',expectedVersion:add.version,nodeId:add.affectedNodeIds[0],changes:{text:'服务已保存'}}})
    window.__canvasSmoke={rt,nodeId:add.affectedNodeIds[0]}
    return {before,after:document.querySelectorAll('iframe[src*="/desktop-canvas/view"]').length,info,read,add,update}
  })
  assert.equal(initial.before,0);assert.equal(initial.after,0);assert.equal(initial.add.status,'saved');assert.equal(initial.update.status,'saved');assert.equal(counts.partial,2)
  // Register a visible view through the real installed Client handle. Execute did not create it.
  await page.evaluate(()=>{const frame=document.createElement('iframe');frame.id='fixture-view';frame.style.cssText='width:1100px;height:750px';frame.src='/desktop-canvas/view?id=2873&viewId=fixture-view';window.__canvasSmoke.release=window.__INSIGHT_CANVAS_RUNTIME_V1__.registerView({canvasId:'2873',viewId:'fixture-view',frame});document.body.append(frame)})
  const frame=await (await page.locator('#fixture-view').elementHandle()).contentFrame()
  await frame.waitForSelector('.react-flow__node',{timeout:30000})
  assert.equal(counts.get,1,'Opening the UI must not reload its prepared context')
  assert.ok((await frame.locator('body').innerText()).includes('服务已保存'));assert.ok(await frame.locator('input').evaluateAll(inputs=>inputs.some(input=>input.value==='验收文本')))
  await frame.locator('body').screenshot({path:`${folder}/browser-ui-bound.png`})
  const textNode=frame.locator('.react-flow__node-text').first()
  await textNode.dblclick({position:{x:120,y:120}})
  const editor=frame.locator('[contenteditable="true"]').first()
  await editor.waitFor({state:'visible',timeout:15000})
  await editor.fill('关闭界面前的最后输入')
  const protectedWrite=await page.evaluate(()=>window.__canvasSmoke.rt.execute({canvasId:'2873',operation:{action:'node.update',expectedVersion:'20',nodeId:window.__canvasSmoke.nodeId,changes:{text:'不应覆盖草稿'}}}))
  assert.equal(protectedWrite.status,'rejected');assert.equal(protectedWrite.error.code,'EDITOR_BUSY')
  await page.evaluate(()=>{window.__canvasSmoke.release();document.getElementById('fixture-view').remove()})
  await page.waitForFunction(()=>window.__canvasSmoke.rt.getContextInfo('2873').readiness.version!=='20',undefined,{timeout:10000})
  const finalInput=await page.evaluate(()=>window.__canvasSmoke.rt.execute({canvasId:'2873',operation:{action:'canvas.read'}}))
  assert.equal(finalInput.consistency,'confirmed');assert.ok(finalInput.nodes[0].text.includes('关闭界面前的最后输入'))
  assert.equal(counts.partial,3,'The final native input must persist once after removing its iframe')
  const generated=await page.evaluate(async()=>{
    const rt=window.__canvasSmoke.rt;const latest=await rt.execute({canvasId:'2873',operation:{action:'canvas.read'}})
    const added=await rt.execute({canvasId:'2873',operation:{action:'node.add',expectedVersion:latest.version,node:{type:'image',changes:{prompt:'本地 fixture 验收'}}}})
    const run=await rt.execute({canvasId:'2873',operation:{action:'node.run',expectedVersion:added.version,nodeId:added.affectedNodeIds[0],approvedGeneration:{images:1,videos:0}}})
    window.__canvasSmoke.imageId=added.affectedNodeIds[0];window.__canvasSmoke.runVersion=run.version;return {added,run,frames:document.querySelectorAll('iframe[src*="/desktop-canvas/view"]').length}
  })
  assert.equal(generated.run.status,'submitted');assert.equal(generated.frames,0)
  await page.waitForFunction(()=>window.__canvasSmoke.rt.getContextInfo('2873').readiness.version!==window.__canvasSmoke.runVersion,undefined,{timeout:10000})
  const generatedRead=await page.evaluate(()=>window.__canvasSmoke.rt.execute({canvasId:'2873',operation:{action:'canvas.read',nodeIds:[window.__canvasSmoke.imageId]}}))
  assert.equal(generatedRead.nodes[0].status,'success');assert.equal(generatedRead.nodes[0].outputs.length,1)
  assert.equal(counts.invoke,1)
  assert.equal(errors.length,0)
  const packageSha256=createHash('sha256').update(await readFile('/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/insight-ai-desktop-canvas-plugin-0.3.0-alpha.8.tgz')).digest('hex')
  const result={passed:true,packageSha256,browser:browser.version(),core:'0.2.1-alpha.1',node:process.version,api:'fixture only; external traffic blocked',mainCsp,initial,protectedWrite,finalInput,generated,generatedRead,counts,operations,errors}
  await page.screenshot({path:`${folder}/browser-complete.png`,fullPage:true})
  await writeFile(`${folder}/browser-complete.json`,JSON.stringify(result,null,2))
  console.log(JSON.stringify({passed:true,browser:result.browser,counts,errors}))
} finally {await browser.close()}
