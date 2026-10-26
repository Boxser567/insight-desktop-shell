import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

async function modelToken() {
  assert.ok(process.send, 'The smoke process needs a private IPC channel')
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Model credential IPC timed out')), 2_000)
    process.once('message', message => {
      clearTimeout(timer)
      try {
        assert.equal(message.type, 'insight:model-token:response')
        assert.equal(message.id, id)
        assert.equal(typeof message.token, 'string')
        assert.ok(message.token.length > 0)
        resolve(message.token)
      } catch (error) { reject(error) }
    })
    process.send({ type: 'insight:model-token:request', id })
  })
}

createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const { rpcId, method } = JSON.parse(Buffer.concat(chunks).toString())
  try {
    if (method === 'session.modelCatalog') await modelToken()
    response.end(JSON.stringify({ rpcId, result: { ok: true, value: method === 'session.modelCatalog' ? {
      default: { provider: 'yinsai-gateway', model: 'deepseek-flash' },
      routableProviders: ['yinsai-gateway'],
      groups: [{ id: 'yinsai-gateway', models: [{ id: 'deepseek-flash' }] }],
      failures: [], pid: process.pid
    } : {} } }))
  } catch (error) {
    response.end(JSON.stringify({ rpcId, result: { ok: false, error: { code: 'AUTH', message: error.message } } }))
  }
}).listen(Number(process.argv[2]), '127.0.0.1')
