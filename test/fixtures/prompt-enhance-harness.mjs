// Test-only upstream responses. Core, plugin routing and credential IPC remain real.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const output = process.env.INSIGHT_SMOKE_OUTPUT
const entry = process.env.INSIGHT_SMOKE_HARNESS_ENTRY
assert(output && entry)
const requests = []
const nativeFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input))
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(input, init)
  assert.equal(url.pathname, '/insight-harness-llm-gateway/v1/chat/completions', 'Unexpected external request')
  const body = JSON.parse(init.body)
  assert.equal(body.model, 'deepseek-flash')
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-account-1')
  const mode = readFileSync(join(output, 'prompt-enhance-mode'), 'utf8').trim()
  requests.push({ model: body.model, stream: body.stream, mode, authenticated: true })
  writeFileSync(join(output, 'prompt-enhance-requests.json'), JSON.stringify(requests, null, 2))
  if (mode === 'cancel') {
    return new Promise((_resolve, reject) => {
      const aborted = () => {
        writeFileSync(join(output, 'prompt-enhance-aborted'), 'aborted\n')
        reject(init.signal.reason)
      }
      if (init.signal.aborted) aborted()
      else init.signal.addEventListener('abort', aborted, { once: true })
    })
  }
  if (mode === 'error') return new Response(JSON.stringify({ error: { message: 'fixture upstream failure' } }), { status: 401 })
  const text = '请为产品发布撰写三条文案，突出目标用户、核心价值与行动建议。'
  const events = [
    { id: 'fixture-enhance', choices: [{ delta: { role: 'assistant', content: text } }] },
    { id: 'fixture-enhance', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }
  ]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
}
await import(pathToFileURL(entry).href)
