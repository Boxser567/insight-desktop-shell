import assert from 'node:assert/strict'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createModelGatewayAdapter, MODEL_PROVIDER, MODEL_ID } from './model-gateway.mjs'
import { createModelCredentialClient, parentCredentialTransport } from './model-credential-client.mjs'

const credentials = createModelCredentialClient(parentCredentialTransport())
const adapter = createModelGatewayAdapter({ get: () => undefined }, () => credentials.getToken())
const events = [
  { choices: [{ delta: { role: 'assistant', content: 'connected' } }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }
]
let fetches = 0
let mode = process.env.TEST_MODE
globalThis.fetch = async (url, init) => {
  ++fetches
  assert.equal(url, 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/chat/completions')
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-user-center-token')
  const body = JSON.parse(init.body)
  assert.equal(body.model, MODEL_ID)
  assert.equal(body.stream, true)
  assert.equal(body.tools[0].function.name, 'inspect_workspace')
  if (mode === 'gateway401') return new Response('{"error":{"message":"upstream rejected"}}', { status: 401 })
  if (mode === 'cancel') {
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  }
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' }
  })
}
const request = {
  provider: MODEL_PROVIDER, model: MODEL_ID,
  messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'plugin', plugin: 'test' } })],
  tools: [{ name: 'inspect_workspace', description: 'Inspect workspace', parameters: { type: 'object', properties: {} } }]
}
async function collect(options = request) {
  const prepared = await adapter.prepareCall(options.provider, options.model, options.signal)
  const chunks = []
  for await (const chunk of prepared.stream(options)) chunks.push(chunk)
  return chunks
}
try {
  if (mode === 'expired') {
    await assert.rejects(collect(), error => error.code === 'AUTH' && !error.message.includes('test-user-center-token'))
    assert.equal(fetches, 0)
  } else if (mode === 'gateway401') {
    await assert.rejects(collect(), error => error.code === 'AUTH')
    assert.equal(fetches, 1)
  } else if (mode === 'cancel') {
    const controller = new AbortController()
    const pending = collect({ ...request, signal: controller.signal })
    const assertion = assert.rejects(pending, error => error.code === 'ABORTED')
    const timer = setInterval(() => { if (fetches) controller.abort() }, 5)
    try { await assertion } finally { clearInterval(timer) }
  } else {
    const chunks = await collect()
    assert(chunks.some(chunk => chunk.type === 'text-delta'))
    assert(chunks.some(chunk => chunk.type === 'finish'))
    await collect()
    assert.equal(fetches, 2)
  }
  console.log('model-gateway runtime assertions passed')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  credentials.dispose()
  if (process.disconnect) process.disconnect()
  else process.exit(process.exitCode ?? 0)
}
