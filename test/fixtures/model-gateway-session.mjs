// Real shipped Core + Gateway. Only the upstream HTTP responses are simulated.
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import BasicCompaction from '@deepseek-ai/dsh-compaction-basic'
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { createModelGatewayAdapter, MODEL_PROVIDER, MODEL_ID } from './model-gateway.mjs'

const ctx = new Context()
const requests = []
let reply = 'normal'
const answer = 'Long answer. '.repeat(4000)
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  requests.push(body)
  assert.equal(body.model, MODEL_ID)
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-token')
  if (reply === 'overflow') {
    reply = 'normal'
    return new Response(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'maximum context length exceeded' } }), { status: 400 })
  }
  const summary = body.max_tokens === 8192
  const delta = reply === 'tool-length'
    ? { content: 'Partial answer retained.', tool_calls: [{ index: 0, id: 'truncated', type: 'function', function: { name: 'must_not_run', arguments: '{"incomplete":' } }] }
    : { content: summary ? 'Checkpoint: preserve user goal and continue.' : answer }
  const finish = reply.endsWith('length') ? 'length' : 'stop'
  const promptTokens = Math.ceil(JSON.stringify(body.messages).length / 4)
  return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: promptTokens, completion_tokens: summary ? 20 : 12000 } })}\n\ndata: [DONE]\n\n`)
}
async function send(agent, text) {
  const idle = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { dispose(); reject(new Error('Agent did not return to idle')) }, 10000)
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { clearTimeout(timer); dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await idle
  const reason = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason
  if (reason.kind === 'error') console.error('fixture turn failure', reason)
  return reason
}
try {
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(BasicCompaction)
  ctx.llm.registerAdapter([MODEL_PROVIDER], createModelGatewayAdapter(ctx, async () => 'fixture-token'))
  assert.equal(ctx.compaction.config.auto, true)
  assert.equal(ctx.compaction.config.thresholdRatio, 0.8)
  const agent = await ctx.agentLoop.create('gateway-continuation', { provider: MODEL_PROVIDER, model: MODEL_ID })
  reply = 'length'
  assert.equal((await send(agent, 'Write a long answer')).kind, 'max-tokens')
  assert.equal(requests[0].max_tokens, resolveAdapterOptions({}).maxTokens)
  reply = 'normal'
  assert.equal((await send(agent, 'Continue')).kind, 'completed')
  assert(requests.at(-1).messages.some(message => message.role === 'assistant' && message.content === answer))
  reply = 'tool-length'
  assert.equal((await send(agent, 'Use a tool')).kind, 'max-tokens')
  assert.equal(agent.session.snapshotEvents().filter(event => event.type === 'tool/call').length, 0)
  reply = 'normal'
  assert.equal((await send(agent, 'Continue after truncated tool')).kind, 'completed')
  assert(requests.at(-1).messages.every(message => !message.tool_calls?.some(call => call.id === 'truncated')))
  assert(requests.at(-1).messages.some(message => message.content === 'Partial answer retained.'))
  // A provider-confirmed context failure must compact and retry, even below 80%.
  reply = 'overflow'
  const before = requests.length
  assert.equal((await send(agent, 'Continue after context overflow')).kind, 'completed')
  assert(requests.length >= before + 3, 'expected failed request, summary and retried request')
  assert(agent.session.snapshotEvents().some(event => event.type.includes('compact')))
  const pressureAgent = await ctx.agentLoop.create('gateway-pressure', { provider: MODEL_PROVIDER, model: MODEL_ID })
  const start = requests.length
  for (let i = 0; i < 8 && !pressureAgent.session.snapshotEvents().some(event => event.type.includes('compact')); i++) {
    assert.equal((await send(pressureAgent, `Recent instruction ${i}: preserve the project goal. ` + 'history '.repeat(80000))).kind, 'completed')
    if (i === 0) assert.equal(requests.slice(start).filter(request => request.max_tokens === 8192).length, 0)
  }
  assert(pressureAgent.session.snapshotEvents().some(event => event.type.includes('compact')), 'official pressure compaction must run on long Gateway sessions')
  assert(requests.at(-1).messages.some(message => String(message.content).includes('Recent instruction')))
  console.log('gateway session continuation and overflow assertions passed')
} finally {
  await ctx.fiber.dispose()
}
