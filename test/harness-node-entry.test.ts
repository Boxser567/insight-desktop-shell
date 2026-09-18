import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
const run = promisify(execFile)
it.each(['legacy', 'explicit'])('runs the %s Core CLI exactly once through the diagnostic wrapper', async (mode) => {
  const directory = await mkdtemp(join(tmpdir(), 'insight-cli-entry-'))
  const entry = join(directory, 'cli.mjs')
  try {
    const body = "process.stdout.write('CLI_EXECUTED\\n')"
    await writeFile(entry, mode === 'legacy' ? body : `export async function runCli() { ${body} }`)
    const result = await run(process.execPath, [join(process.cwd(), 'build/harness-node-entry.mjs'), entry, '--test'])
    expect(result.stdout.match(/CLI_EXECUTED/g)).toHaveLength(1)
    expect(result.stderr).toBe('')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
