import { createServer } from 'node:net'

/** Keep browser storage on one loopback origin, falling back if another app owns it. */
export async function reserveHarnessPort(preferredPort = 43129): Promise<number> {
  const reserve = (port: number): Promise<number> => new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a local port.'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
  try { return await reserve(preferredPort) } catch (error) {
    if (preferredPort === 0 || !['EADDRINUSE', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    return reserve(0)
  }
}
