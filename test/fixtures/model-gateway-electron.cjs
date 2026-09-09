const assert = require('node:assert/strict')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, utilityProcess } = require('electron')

app.whenReady().then(async () => {
  const { bindModelCredentialBridge } = await import(pathToFileURL(join(__dirname, 'model-credential-bridge.mjs')))
  const peer = utilityProcess.fork(join(__dirname, 'run.mjs'), [], {
    env: { ...process.env, DSH_HOME: join(__dirname, 'utility-process'), TEST_MODE: 'success' },
    stdio: 'pipe'
  })
  let requests = 0
  const dispose = bindModelCredentialBridge(peer, async () => {
    ++requests
    return 'test-user-center-token'
  }, () => true)
  peer.stdout.on('data', chunk => process.stdout.write(chunk))
  peer.stderr.on('data', chunk => process.stderr.write(chunk))
  peer.once('exit', code => {
    dispose()
    try { assert.equal(code, 0); assert.equal(requests, 2); app.exit(0) }
    catch (error) { console.error(error); app.exit(1) }
  })
  peer.once('error', () => app.exit(1))
}).catch(error => { console.error(error); app.exit(1) })
