// Test-only launcher: actual Shell/Main/preloads with isolated files and fixture authentication.
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, dialog, session, webContents } = require('electron')
const root = process.env.INSIGHT_SMOKE_ROOT
const output = process.env.INSIGHT_SMOKE_OUTPUT
if (!root || !output) throw new Error('INSIGHT_SMOKE_ROOT and INSIGHT_SMOKE_OUTPUT are required')
for (const directory of ['app-data', 'logs']) mkdirSync(join(output, directory), { recursive: true })
app.getAppPath = () => root
app.getVersion = () => require(join(root, 'package.json')).version
app.setPath('appData', join(output, 'app-data'))
app.setPath('logs', join(output, 'logs'))
const fromPartition = session.fromPartition.bind(session)
let account = 0
session.fromPartition = (partition, options) => {
  const value = fromPartition(partition, options)
  if (partition.includes('insight-auth')) value.fetch = async (input) => {
    const path = new URL(input).pathname
    let data
    if (path.endsWith('/loginV3')) { account++; data = { accessToken: `fixture-account-${account}`, accessTokenExpiredSeconds: 3600 } }
    else if (path.endsWith('/getUserDetail')) data = { id: `fixture-${account}`, userName: `验收账号 ${account}`, phoneNo: '13800138000' }
    else if (path.endsWith('/logout')) data = {}
    else if (path.endsWith('/refresh')) data = { accessToken: `fixture-account-${account}`, accessTokenExpiredSeconds: 3600 }
    else throw new Error(`Unexpected fixture auth request: ${path}`)
    return new Response(JSON.stringify({ code: 'SUCCESS', data }), { headers: { 'content-type': 'application/json' } })
  }
  return value
}
const messages = []
dialog.showErrorBox = (title, message) => { messages.push(`Native error: ${title}: ${message}`); console.error(title, message) }
const redact = value => String(value).replace(/([?&]token=)[^\s&#]+/gu, '$1[redacted]')
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', event => {
    const text = event.message
    if (text) messages.push(redact(text))
  })
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(label, check, timeout = 120000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const alive = () => webContents.getAllWebContents().filter(contents => !contents.isDestroyed())
async function inspect(contents) {
  return contents.executeJavaScript(`({ url: location.href.replace(/([?&]token=)[^&#]+/g,'$1[redacted]'), text: document.body?.innerText, sidebars: document.querySelectorAll('button[aria-label="收起侧边栏"]').length, buttons: [...document.querySelectorAll('button')].map(x=>({text:x.innerText,label:x.getAttribute('aria-label'),title:x.title})), errors: [...document.querySelectorAll('[data-dsh-boot-error]')].map(x=>x.textContent) })`)
}
async function save(label, contents) {
  writeFileSync(join(output, `${label}.json`), JSON.stringify(await inspect(contents), null, 2))
  writeFileSync(join(output, `${label}.png`), (await contents.capturePage()).toPNG())
}
async function run() {
  await import(pathToFileURL(join(root, 'out/main/index.js')).href)
  const shell = await until('Shell login', async () => {
    for (const contents of alive().filter(value => value.getURL().startsWith('file:'))) {
      if (await contents.executeJavaScript('typeof window.insightAuth !== "undefined"').catch(() => false)) return contents
    }
  })
  assert.equal((await shell.executeJavaScript('window.insightAuth.current()')).kind, 'unauthenticated')
  const login = await shell.executeJavaScript('window.insightAuth.loginSms({phone:"13800138000",code:"123456"})')
  assert.equal(login.ok, true)
  const harness = await until('Harness view', () => alive().find(value => /^http:\/\/127\.0\.0\.1:/.test(value.getURL())))
  await until('first account UI', () => harness.executeJavaScript(`document.body?.innerText.includes('验收账号 1') && !!document.querySelector('button[aria-label="收起侧边栏"]')`))
  await save('account-one', harness)
  const page = await inspect(harness)
  assert.equal(page.sidebars, 1, JSON.stringify(page))
  assert.match(page.text, /验收账号 1/)
  console.log('CANDIDATE_FIRST_ACCOUNT_RENDERED')
  await harness.executeJavaScript(`document.querySelector('[data-insight-desktop-account] button').click()`)
  await until('account menu', () => harness.executeJavaScript(`!!document.querySelector('[data-insight-desktop-account-menu]')`))
  await harness.executeJavaScript(`[...document.querySelectorAll('[role="menuitem"]')].find(x=>x.textContent==='设置').click()`)
  await until('desktop settings', () => harness.executeJavaScript(`!!document.querySelector('[data-insight-desktop-client-settings]')`))
  await save('desktop-settings', harness)
  harness.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' })
  harness.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' })
  for (const route of (process.argv.includes('--safe-mode') ? [] : ['update', 'uninstall'])) {
    for (const name of ['dsh-better-sidebar', 'dshmarket', '@insight-ai/desktop-integration']) {
      const response = await harness.executeJavaScript(`fetch('/dsh-market/${route}', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:${JSON.stringify(name)}})}).then(async r=>({status:r.status,body:await r.json()}))`)
      assert.equal(response.status, 403, JSON.stringify(response))
      assert.match(response.body.error, /managed by Insight Desktop/)
    }
  }
  console.log('CANDIDATE_SETTINGS_AND_MARKET_POLICY_PASSED')
  const catalog = await harness.executeJavaScript(`fetch('/api/session/modelCatalog', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'session/modelCatalog',payload:{args:{}}})}).then(r=>r.json())`)
  assert.equal(catalog.result.ok, true)
  assert.equal(catalog.result.value.default.provider, 'yinsai-gateway')
  if (process.env.INSIGHT_SMOKE_WORKSPACE === '1') {
    const workspacePath = join(output, '验收工作区')
    mkdirSync(workspacePath, { recursive: true })
    writeFileSync(join(workspacePath, 'acceptance.md'), '# Insight acceptance\n')
    const workspace = await harness.executeJavaScript(`fetch('/api/workspace/create', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'workspace/create',payload:{args:{request:{path:${JSON.stringify(workspacePath)}}}}})}).then(r=>r.json())`)
    assert.equal(workspace.result.ok, true, JSON.stringify(workspace))
    await until('workspace row', () => harness.executeJavaScript(`document.body.innerText.includes('验收工作区')`))
    await harness.executeJavaScript(`document.querySelector('button[aria-label="在“验收工作区”中新建会话"]').click()`)
    await until('selected workspace input', () => harness.executeJavaScript(`!!document.querySelector('[contenteditable="true"]')`))
    await save('workspace-open', harness)
    console.log('CANDIDATE_WORKSPACE_OPENED')
    await until('file panel', () => harness.executeJavaScript(`!!document.querySelector('button[title="文件"]')`))
    await harness.executeJavaScript(`document.querySelector('button[title="文件"]').click()`)
    await until('acceptance file', () => harness.executeJavaScript(`!!document.querySelector('[role="button"][title$="/acceptance.md"]')`))
    await harness.executeJavaScript(`document.querySelector('[role="button"][title$="/acceptance.md"]').click()`)
    await until('file preview', () => harness.executeJavaScript(`document.body.innerText.includes('Insight acceptance')`))
    await harness.executeJavaScript(`[...document.querySelectorAll('button')].find(x=>x.textContent==='编辑').click()`)
    await until('file editor', () => harness.executeJavaScript(`!!document.querySelector('.cm-content[contenteditable="true"]')`))
    await harness.executeJavaScript(`document.querySelector('.cm-content[contenteditable="true"]').focus()`)
    await harness.insertText('verified ')
    await harness.executeJavaScript(`document.querySelector('button[aria-label="保存"]').click()`)
    await until('saved file', () => readFileSync(join(workspacePath, 'acceptance.md'), 'utf8').includes('verified '))
    await save('file-edited', harness)
    // Opening the workspace starts its terminal tab alongside the file panel.
    await until('terminal input', () => harness.executeJavaScript(`!!document.querySelector('.xterm-helper-textarea')`))
    await harness.executeJavaScript(`document.querySelector('.xterm-helper-textarea').focus()`)
    await harness.insertText('echo terminal-verified > terminal-acceptance.txt')
    harness.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    harness.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await until('terminal command', () => { try { return readFileSync(join(workspacePath, 'terminal-acceptance.txt'), 'utf8').includes('terminal-verified') } catch { return false } })
    await save('terminal-verified', harness)
    console.log('CANDIDATE_EDITOR_AND_TERMINAL_PASSED')
  }

  if (process.argv.includes('--safe-mode')) {
    assert.equal(await harness.executeJavaScript(`!!document.getElementById('dsh-desktop-safe-mode-banner')`), true)
  }
  const firstSession = harness.session
  // Continue through the actual account IPC; the old renderer must be destroyed.
  await harness.executeJavaScript('setTimeout(() => { void window.insightDesktopAccount.signOut() }, 0); true')
  await until('old account view disposal', () => harness.isDestroyed())
  assert.equal((await shell.executeJavaScript('window.insightAuth.current()')).kind, 'unauthenticated')
  assert.equal((await shell.executeJavaScript('window.insightAuth.loginSms({phone:"13800138000",code:"123456"})')).ok, true)
  const second = await until('second account view', () => alive().find(value => /^http:\/\/127\.0\.0\.1:/.test(value.getURL())))
  assert.notEqual(second.session, firstSession)
  await until('second account UI', () => second.executeJavaScript(`document.body?.innerText.includes('验收账号 2') && !!document.querySelector('button[aria-label="收起侧边栏"]')`))
  await save('account-two', second)
  const secondPage = await inspect(second)
  assert.equal(secondPage.sidebars, 1)
  assert.match(secondPage.text, /验收账号 2/)
  assert.doesNotMatch(secondPage.text, /验收账号 1/)
  assert.deepEqual(messages.filter(message => /slot entry crashed|Uncaught |Failed to fetch dynamically imported module|Native error:/.test(message)), [], 'Renderer errors')
  writeFileSync(join(output, 'passed'), 'login, renderer, logout, and account partition passed\n')
}
const timer = setTimeout(() => { console.error('Desktop smoke deadline exceeded'); app.quit() }, 300000)
run().then(() => { console.log('CANDIDATE_DESKTOP_SMOKE_PASSED') }).catch(async error => {
  process.exitCode = 1
  console.error(redact(error.stack))
  for (const [index, contents] of alive().entries()) await save(`failure-${index}`, contents).catch(() => {})
}).finally(() => {
  clearTimeout(timer)
  writeFileSync(join(output, 'renderer-console.json'), JSON.stringify(messages, null, 2))
  app.quit()
})
