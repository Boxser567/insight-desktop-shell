// Test-only launcher: actual Shell/Main/preloads with isolated files and fixture authentication.
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, dialog, Menu, nativeTheme, session, webContents } = require('electron')
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
function findMenuItem(label, items = Menu.getApplicationMenu()?.items ?? []) {
  for (const item of items) {
    if (item.label === label) return item
    const nested = item.submenu ? findMenuItem(label, item.submenu.items) : undefined
    if (nested) return nested
  }
}
async function inspect(contents) {
  return contents.executeJavaScript(`({ url: location.href.replace(/([?&]token=)[^&#]+/g,'$1[redacted]'), text: document.body?.innerText, theme: document.documentElement.dataset.insightTheme, background: getComputedStyle(document.body).backgroundColor, sidebars: document.querySelectorAll('button[aria-label="收起侧边栏"]').length, buttons: [...document.querySelectorAll('button')].map(x=>({text:x.innerText,label:x.getAttribute('aria-label'),title:x.title})), errors: [...document.querySelectorAll('[data-dsh-boot-error]')].map(x=>x.textContent) })`)
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
  await harness.executeJavaScript(`{ const target = [...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='通用设置'); target?.click(); !!target }`)
  await until('appearance settings', () => harness.executeJavaScript(`[...document.querySelectorAll('button')].some(x=>x.textContent?.trim()==='浅色')`))
  await harness.executeJavaScript(`{ const target = [...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='浅色'); target?.click(); !!target }`)
  await until('native light theme', () => nativeTheme.themeSource === 'light' && nativeTheme.shouldUseDarkColors === false)
  harness.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' })
  harness.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' })
  console.log('CANDIDATE_SETTINGS_PASSED')

  const aboutItem = findMenuItem('关于因赛AI')
  assert.ok(aboutItem?.click, 'About menu item is unavailable')
  aboutItem.click(aboutItem, BrowserWindow.getFocusedWindow(), {})
  const about = await until('light About window', async () => {
    const contents = alive().find(value => value.getURL().includes('/about.html'))
    if (!contents) return undefined
    const state = await inspect(contents)
    return state.theme === 'light' && state.background !== 'rgb(32, 32, 36)' ? contents : undefined
  })
  assert.match((await inspect(about)).text, /因赛AI/)
  await save('about-light', about)

  await harness.executeJavaScript('void window.insightDesktopUpdates.open(); true')
  const update = await until('light Update window', async () => {
    const contents = alive().find(value => value.getURL().includes('/update.html'))
    if (!contents) return undefined
    const state = await inspect(contents)
    return state.theme === 'light' && state.text?.trim() ? contents : undefined
  }, 10_000)
  const updateState = await inspect(update)
  assert.notEqual(updateState.background, 'rgb(32, 32, 36)')
  await save('update-light', update)
  console.log('CANDIDATE_SECONDARY_THEME_PASSED')
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
    await until('product hero', () => harness.executeJavaScript(`!!document.querySelector('[data-insight-desktop-hero-title]')`))
    const hero = await inspect(harness)
    assert.match(hero.text, /以专业为引擎，让团队与AI共成长/)
    assert.doesNotMatch(hero.text, /探索未至之境|预览版/)
    assert.equal(await harness.executeJavaScript(`!!document.querySelector('[data-phase="hero"] [data-insight-desktop-brand-mark] img')`), true)
    await save('workspace-open', harness)
    console.log('CANDIDATE_WORKSPACE_OPENED')
    // File navigation/preview belongs to Core's session-scoped native panel.
    // Its interaction coverage lives in the Core sidebar suites; this Shell
    // smoke keeps the session blank and never sends fixture credentials to a model.
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
