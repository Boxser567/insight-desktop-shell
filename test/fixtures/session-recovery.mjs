// Exercise the shipped JSONL provider in an isolated process; no network or user data.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [runtime, root, phase, withPrevious] = process.argv.slice(2)
const load = name => import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai', name, 'lib/index.js')))
const { Context } = await load('cordis')
const { default: Persistence } = await load('dsh-session-persistence-jsonl')
const { SESSION_FORMAT_VERSION: version } = await load('dsh-session')
const ctx = new Context()
const ids = withPrevious === 'true' ? ['migrated-recovery', 'native-recovery'] : ['native-recovery']
const expectedPath = join(root, 'expected.json')

function turn(start, number, { tools = false, developer = false } = {}) {
  const rows = []
  const add = (type, data, surface = false) => rows.push({
    type, seq: start + rows.length, time: 1000 + start + rows.length, data,
    ...(surface ? { surfaceOp: 'append' } : {})
  })
  const step = { turn: number, step: 1 }
  add('turn/start', { turn: number })
  add('step/start', step)
  const headerSeq = start + rows.length
  add('request/header', { reason: number === 1 ? 'initial' : 'resume', header: {
    config: { provider: 'recovery-fixture', model: 'recovery-fixture' },
    ...(developer ? { tools: [{ name: 'read', description: 'Read', parameters: {}, deferLoading: true }] } : {})
  } })
  add('user/message', { id: `user-${number}`, role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: `保留会话与继续对话 ${number}` }] }, true)
  if (developer) add('developer/message', { ...step, headerSeq, message: {
    id: `developer-${number}`, role: 'developer', source: { kind: 'tool-registry' },
    content: [{ type: 'tool-addition', toolName: 'read' }]
  } }, true)
  if (tools) {
    const callId = `call-${number}`
    add('assistant/message', { ...step, stream: [], message: {
      id: `assistant-${number}`, role: 'assistant', source: { kind: 'model', provider: 'recovery-fixture', model: 'recovery-fixture' },
      content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{}' }]
    } }, true)
    add('tool/call', { ...step, callId, name: 'read', arguments: '{}' })
    const content = [{ type: 'text', text: '工具结果：必须完整保留' }]
    add('tool/result', { ...step, message: {
      id: `tool-${number}`, role: version === 3 ? 'user' : 'tool', source: { kind: 'tool', callId },
      ...(version === 3 ? { content: [{ type: 'tool-result', toolCallId: callId, content }] } : { toolCallId: callId, content })
    }, meta: { fixture: 'preserve-tool-card' } }, true)
  }
  add('step/end', step)
  add('turn/end', { turn: number, reason: { kind: 'completed' } })
  return rows
}

async function read(id) {
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try { return structuredClone((await handle.read()).events) } finally { await handle.close() }
}

async function append(id, rows, create = false) {
  const handle = create
    ? await ctx.sessionPersistence.create({ version, id, createdAt: 1000, isSeeded: false, delegationDepth: 0 })
    : await ctx.sessionPersistence.open(id, 'write')
  try { await handle.append(rows); await handle.flush() } finally { await handle.close() }
}

try {
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  if (phase === 'previous') {
    assert.equal(version, 3, 'Historical probe requires a real v3 writer')
    await append('migrated-recovery', turn(0, 1, { tools: true }), true)
    await read('migrated-recovery')
  } else {
    if (phase === 'candidate') assert.equal(version, 4, 'Candidate probe requires a real v4 writer')
    const expected = phase === 'candidate' ? {} : JSON.parse(await readFile(expectedPath, 'utf8'))
    for (const id of ids) {
      if (phase === 'candidate') {
        const inherited = id === 'migrated-recovery' ? await read(id) : []
        if (inherited.length) {
          const result = inherited.find(event => event.type === 'tool/result')
          assert.equal(result.data.message.role, 'tool')
          assert.equal(result.data.message.content[0].text, '工具结果：必须完整保留')
          assert.deepEqual(result.data.meta, { fixture: 'preserve-tool-card' })
        }
        const next = turn(inherited.length, inherited.length ? 2 : 1, { tools: true, developer: true })
        await append(id, next, inherited.length === 0)
        expected[id] = [...inherited, ...next]
      } else if (phase === 'recovery') {
        assert.deepEqual(await read(id), expected[id], 'Recovery must preserve every admitted event')
        const number = expected[id].filter(event => event.type === 'turn/end').length + 1
        const next = turn(expected[id].length, number)
        await append(id, next)
        expected[id].push(...next)
      } else assert.equal(phase, 'verify')
      assert.deepEqual(await read(id), expected[id], 'Restart must preserve history and continuation')
    }
    await writeFile(expectedPath, JSON.stringify(expected))
  }
  const sessions = []
  for (const id of phase === 'previous' ? ['migrated-recovery'] : ids) {
    const rows = await read(id)
    sessions.push({ id, events: rows.length, toolResults: rows.filter(row => row.type === 'tool/result').length,
      developerMessages: rows.filter(row => row.type === 'developer/message').length,
      turns: rows.filter(row => row.type === 'turn/end').length })
  }
  console.log(JSON.stringify({ phase, writer: version, sessions }))
} finally { await ctx.fiber.dispose() }
