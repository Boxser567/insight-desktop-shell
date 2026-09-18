import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { HarnessRuntime } from '../src/main/runtime/harness-runtime'

it.each(['legacy', 'token', 'missing-token'])('starts %s Core with the correct authentication requirement', async (mode) => {
  const home = await mkdtemp(join(tmpdir(), 'insight-runtime-auth-'))
  const entry = join(home, 'cli.mjs')
  const patch = join(home, 'desktop.yml')
  await writeFile(patch, '[]')
  await writeFile(entry, `import { createServer } from 'node:http'
export async function runCli() {
  const port = Number(process.argv[process.argv.indexOf('--port') + 1])
  const server = createServer((_req, res) => { res.writeHead(${mode === 'legacy' ? 200 : 401}); res.end('ok') })
  server.listen(port, '127.0.0.1', () => {
    ${mode === 'token' ? "process.stdout.write('dsh web: http://127.0.0.1:1/?token=wrong\\n'); setTimeout(() => { process.stdout.write('dsh web: http://127.0.0.1:' + port + '/?token=local-secret\\n') }, 250)" : ''}
  })
}
`)
  const runtime = new HarnessRuntime({
    dshEntryPath: entry, nodeExecutablePath: process.execPath,
    nodeEntryPath: join(process.cwd(), 'build/harness-node-entry.mjs'), dshPatchPath: patch,
    dshHome: home, logPath: join(home, 'runtime.log'), startupTimeoutMs: 1800,
    requiresLaunchToken: mode !== 'legacy',
    launchProcess: (executable, args, options) => {
      expect(options.env?.INSIGHT_BUNDLED_NODE_PATH).toBe(process.execPath)
      const child = spawn(executable, args, options)
      return Object.assign(child, { stdout: child.stdout!, stderr: child.stderr! })
    },
    onChanged() {}
  })
  try {
    await runtime.start(home)
    const snapshot = runtime.snapshot()
    if (mode === 'missing-token') {
      expect(snapshot.phase).toBe('failed')
      expect(snapshot.url).toBeUndefined()
    } else {
      expect(snapshot.phase).toBe('ready')
      expect(snapshot.url).not.toContain('token')
      expect(new URL(runtime.authenticatedUrl(snapshot.url!)).searchParams.get('token')).toBe(mode === 'token' ? 'local-secret' : null)
      expect(() => runtime.authenticatedUrl('http://localhost:1')).toThrow('active runtime')
    }
    expect(JSON.stringify(snapshot)).not.toContain('local-secret')
    expect(JSON.stringify(snapshot)).not.toContain('token=wrong')
    await runtime.stop()
    expect(await readFile(join(home, 'runtime.log'), 'utf8')).not.toContain('local-secret')
    expect(() => runtime.authenticatedUrl('http://localhost:1')).toThrow()
  } finally {
    await runtime.stop()
    await rm(home, { recursive: true, force: true })
  }
}, 12_000)
