import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extract } from 'tar'
import { afterEach, expect, it } from 'vitest'
import { adaptMemoryEvolvePackage, MEMORY_COMPAT_VERSION } from '../scripts/adapt-memory-evolve.mjs'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memory-compatibility-'))
  directories.push(root)
  await extract({ file: join(process.cwd(), 'vendor/plugins/dsh-memory-evolve-0.1.0.tgz'), cwd: root })
  return { root, directory: join(root, 'package') }
}

it('extracts the pinned archive with its UTF-8 PAX filename', async () => {
  const { directory } = await fixture()
  await expect(readFile(join(directory, 'README-详细说明.md'))).resolves.not.toHaveLength(0)
})

it('adapts the reviewed client, preserves stores byte for byte, and is repeatable', async () => {
  const { directory } = await fixture()
  const store = await readFile(join(directory, 'lib/store.js'))
  await adaptMemoryEvolvePackage(directory)
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  expect(manifest.version).toBe(MEMORY_COMPAT_VERSION)
  expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-workspace')
  expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-runtime')
  const client = await readFile(join(directory, 'lib/client.js'), 'utf8')
  expect(client).not.toContain('ctx.sessions.open(')
  expect(client.match(/ctx.uiWorkspace.openSession\(/g)).toHaveLength(2)
  expect(client).toContain('"uiConversation", "uiWorkspace"')
  expect(await readFile(join(directory, 'lib/store.js'))).toEqual(store)
  await adaptMemoryEvolvePackage(directory)
  expect(await readFile(join(directory, 'lib/client.js'), 'utf8')).toBe(client)
})

it('refuses a changed upstream integration before changing package metadata', async () => {
  const { directory } = await fixture()
  const path = join(directory, 'lib/client.js')
  await writeFile(path, (await readFile(path, 'utf8')).replace('var inject = [', 'var changedInject = ['))
  await expect(adaptMemoryEvolvePackage(directory)).rejects.toThrow('Review the pinned')
  expect(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).version).toBe('0.1.0')
})

it('rejects unauthenticated reads and forwards the same request to Core authentication', async () => {
  const { directory } = await fixture()
  await adaptMemoryEvolvePackage(directory)
  const { authorizeMemoryRequest } = await import(pathToFileURL(join(directory, 'lib/insight-auth.js')).href)
  const request = { headers: {} }
  for (const code of [401, 403, undefined]) {
    const responses: unknown[] = []
    const ctx = { get(name: string) { expect(name).toBe('connection'); return { requestRejection(req: unknown) { expect(req).toBe(request); return code } } } }
    expect(authorizeMemoryRequest(ctx, request, { writeHead: (status: number) => responses.push(status), end: () => responses.push('end') })).toBe(code === undefined)
    expect(responses).toEqual(code === undefined ? [] : [code, 'end'])
  }
  expect(authorizeMemoryRequest({ get: () => undefined }, request, { writeHead() {}, end() {} })).toBe(false)
  for (const file of ['api.js', 'skills-manager.js', 'notify-web.js', 'canvas.js', 'bookmarks.js', 'ui-settings.js', 'coi/api.js', 'coi/broadcast-api.js', 'prompts.js', 'advisor/api.js', 'mermaid.js']) {
    expect(await readFile(join(directory, 'lib', file), 'utf8')).toContain('if (!authorizeMemoryRequest(ctx, req, res)) return')
  }
})

it('retains existing daily and project entries when the original tool executes a batch add', async () => {
  const { root, directory } = await fixture()
  await adaptMemoryEvolvePackage(directory)
  const { memoryTool, resolveConfig } = await import(pathToFileURL(join(directory, 'lib/index.js')).href)
  const { MemoryStore, SuggestionQueue, ArchiveStore } = await import(pathToFileURL(join(directory, 'lib/store.js')).href)
  const config = resolveConfig({ memoryDir: join(root, 'memories') })
  const store = new MemoryStore(config.memoryDir)
  const agent = { id: 'memory-compatibility', session: { header: { cwd: root } } }
  const tool = memoryTool({ get: () => undefined }, config, store, new SuggestionQueue(config.suggestionsFile), () => config, new ArchiveStore(config.memoryDir))
  const exec = { agent, callId: 'test-memory', signal: new AbortController().signal }
  for (const target of ['daily', 'project']) expect(store.add(target, 'existing ' + target, agent).ok).toBe(true)
  const result = await tool.execute({ action: 'add', target: 'daily', entries: [{ target: 'daily', content: 'new daily' }, { target: 'project', content: 'new project' }] }, exec)
  expect(result.ok).toBe(true)
  for (const target of ['daily', 'project']) {
    const listed = await tool.execute({ action: 'list', target }, exec)
    expect(listed.ok).toBe(true)
    expect(JSON.stringify(listed)).toContain('existing ' + target)
    expect(JSON.stringify(listed)).toContain('new ' + target)
  }
})
