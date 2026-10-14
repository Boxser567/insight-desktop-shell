import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, relative, dirname } from 'node:path'
import vm from 'node:vm'

const dist = resolve('/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/dist')
const manifest = JSON.parse(await readFile(resolve(dist, 'canvas-service-manifest.json'), 'utf8'))
const requests = []
const origin = 'http://127.0.0.1:3000'
let domCreates = 0
const sandbox = {
  console, URL, URLSearchParams, Headers, Response, Request, AbortController, AbortSignal, FormData,
  TextEncoder, TextDecoder, crypto: globalThis.crypto, Event, setTimeout, clearTimeout, queueMicrotask,
  navigator: { userAgent: 'Node fixture' },
  document: { createElement(tag) { domCreates++; throw new Error(`Service created DOM at bootstrap: ${tag}`) } },
  window: { location: { origin }, addEventListener() {}, removeEventListener() {} },
  fetch: async (url, config) => {
    requests.push(String(url))
    const path = new URL(String(url), origin).pathname
    if (path.endsWith('/api/canvas/get')) {
      assert.equal(config.credentials, 'same-origin')
      assert.equal(config.headers.has('token'), false)
      return Response.json({ code: 'SUCCESS', data: { name: 'fixture', data: '{"nodes":[],"edges":[]}', versionNumber: '18', taskStatus: 'FINISHED' } })
    }
    if (path.endsWith('/listNodeSetting')) return Response.json({ code: 'SUCCESS', data: [{ config: '{}' }] })
    if (path.endsWith('/listModelNodeSetting') || path.endsWith('/listToolNodeSetting')) return Response.json({ code: 'SUCCESS', data: [] })
    if (path.endsWith('/model-params') || String(url).endsWith('/model.json')) return Response.json({})
    throw new Error(`Unexpected request ${url}`)
  },
}
const context = vm.createContext(sandbox)
const modules = new Map()
async function load(filename) {
  const full = resolve(dist, filename)
  assert.ok(!relative(dist, full).startsWith('..'))
  if (modules.has(full)) return modules.get(full)
  const module = new vm.SourceTextModule(await readFile(full, 'utf8'), {
    context, identifier: full,
    initializeImportMeta(meta) { meta.url = `${origin}/desktop-canvas/${relative(dist, full)}` },
    importModuleDynamically() { throw new Error('Unexpected dynamic UI import during service preparation') },
  })
  modules.set(full, module)
  return module
}
const entry = await load(manifest.entry)
await entry.link(async (specifier, parent) => load(relative(dist, resolve(dirname(parent.identifier), specifier))))
await entry.evaluate()
assert.equal(domCreates, 0)
assert.equal(requests.length, 0)
const service = entry.namespace.createCanvasServiceRuntime()
assert.equal(domCreates, 0)
const [a, b] = await Promise.all([
  service.ensureContext({ canvasId: '2873', capability: 'read' }),
  service.ensureContext({ canvasId: '2873', capability: 'read' }),
])
assert.equal(a.contextId, b.contextId)
assert.deepEqual(JSON.parse(JSON.stringify(a.readiness.capabilities)), { read: true, edit: false, run: false })
assert.equal(requests.filter(url => url.endsWith('/api/canvas/get')).length, 1)
assert.equal(requests.filter(url => url.endsWith('/listModelNodeSetting')).length, 1)
assert.equal(requests.filter(url => url.endsWith('/listToolNodeSetting')).length, 1)
assert.equal(domCreates, 0)
assert.equal(modules.size, manifest.staticChunks.length)
service.dispose()
assert.throws(() => service.getContextInfo('2873'), { code: 'FRAME_GONE' })
console.log(JSON.stringify({ result: 'passed', runtime: process.version, staticChunks: modules.size, domCreated: domCreates, requests: requests.length, duplicateGraphLoads: 0, proof: 'built ESM evaluated and real context initialized using fixture API; no view/DOM/UI import' }, null, 2))
