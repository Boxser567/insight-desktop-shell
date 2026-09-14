import assert from 'node:assert/strict'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { createModelGatewayAdapter, MODEL_PROVIDER, MODEL_ID } from './model-gateway.mjs'
import { createModelCredentialClient, parentCredentialTransport } from './model-credential-client.mjs'

const credentials = createModelCredentialClient(parentCredentialTransport())
const ref = { attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
const services = {
  attachments: {
    imageHostPath: () => '/host/normalized.png',
    readImageRequest: async attachment => ({ attachment, variantId: `sha256:${'b'.repeat(64)}`, data: Uint8Array.of(1, 2, 3),
      mediaType: 'image/png', bytes: 3, width: 1, height: 1, depth: 'uchar', space: 'srgb', hasAlpha: true })
  },
  fs: { processPathFromHostPath: path => { assert.equal(path, '/host/normalized.png'); return '/tool/normalized.png' } }
}
const adapter = createModelGatewayAdapter({ get: name => process.env.TEST_MODE === 'images' ? services[name] : undefined }, () => credentials.getToken())
const events = [
  { choices: [{ delta: { role: 'assistant', content: 'connected' } }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }
]
let fetches = 0
let mode = process.env.TEST_MODE
let expectedModel = MODEL_ID
let expectedEffort
globalThis.fetch = async (url, init) => {
  ++fetches
  if (mode === 'images' && String(url).endsWith('/files')) return new Response('{}', { status: 404 })
  assert.equal(url, 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1/chat/completions')
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-user-center-token')
  const body = JSON.parse(init.body)
  assert.equal(body.model, expectedModel)
  assert.equal(body.stream, true)
  assert.equal(body.tools[0].function.name, 'inspect_workspace')
  if (mode === 'parameters') {
    assert.equal(body.max_tokens, 16384)
    assert.equal(body.thinking.type, expectedEffort === 'off' ? 'disabled' : 'enabled')
    assert.equal(body.reasoning_effort, expectedEffort === 'off' ? undefined : expectedEffort)
  }
  if (mode === 'images') {
    assert.match(JSON.stringify(body.messages), /\/tool\/normalized.png/)
    assert.match(JSON.stringify(body.messages), /data:image\/png;base64,AQID/)
  }
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
  if (mode === 'capabilities') {
    assert.equal(MODEL_ID, 'deepseek-flash')
    const official = resolveAdapterOptions({})
    const flash = official.models.find(model => model.id === MODEL_ID)
    assert(flash)
    assert.deepEqual((await adapter.listModels(MODEL_PROVIDER)).map(model => model.id), [MODEL_ID])
    for (const id of [MODEL_ID, 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
      const model = await adapter.resolveModel(MODEL_PROVIDER, id)
      assert.equal(model.name, 'DeepSeek-V4.1-Flash')
      assert.equal(model.context.contextWindow, flash.contextWindow)
      assert.equal(model.defaultMaxTokens, flash.maxTokens ?? official.maxTokens)
      assert.deepEqual(model.inputModalities, flash.inputModalities)
      assert.deepEqual(model.reasoning.efforts.map(effort => effort.id), ['off', 'low', 'high', 'max'])
    }
  } else if (mode === 'parameters') {
    for (const effort of ['off', 'low', 'high', 'max']) {
      expectedEffort = effort
      await collect({ ...request, maxTokens: 16384, reasoningEffort: effort })
    }
    for (const model of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
      expectedModel = model
      await collect({ ...request, model, maxTokens: 16384, reasoningEffort: 'max' })
    }
  } else if (mode === 'images') {
    const prices = adapter.imageRequestPricing(MODEL_PROVIDER, MODEL_ID).priceImages(
      Array(resolveAdapterOptions({}).maxImagesPerRequest + 1).fill(ref))
    assert(prices.some(price => price.visualTokens === 0 && price.text.includes('/tool/normalized.png')))
    await collect({ ...request, messages: [createUserMessage({ content: [{ type: 'image', attachment: ref }], source: { kind: 'user' } })] })
    assert.equal(fetches, 2, 'Files rejection should fall back to inline once')
  } else if (mode === 'unavailable') {
    await assert.rejects(collect(), error => error.code === 'TRANSPORT' && !error.message.includes('test-secret'))
    assert.equal(fetches, 0)
  } else if (mode === 'expired') {
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
