import { createServer } from 'node:net'
import { expect, it } from 'vitest'
import { reserveHarnessPort } from '../src/main/runtime/harness-port'
it('reuses an available preferred port and falls back when occupied', async () => {
  const preferred = await reserveHarnessPort(0)
  expect(await reserveHarnessPort(preferred)).toBe(preferred)
  const server = createServer()
  await new Promise<void>(resolve => server.listen(preferred, '127.0.0.1', resolve))
  try { expect(await reserveHarnessPort(preferred)).not.toBe(preferred) }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
