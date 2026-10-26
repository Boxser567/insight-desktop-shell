import { execFile as execFileCallback } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function runCommand(action, path) {
  try {
    const result = await execFile('xcrun', ['stapler', action, path], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024
    })
    return { status: 0, ...result }
  } catch (error) {
    return { status: Number.isInteger(error.code) ? error.code : 1,
      stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

/** Retry only transient Apple ticket-service transport failures; never waive stapler checks. */
export async function runStapler(action, path, {
  run = runCommand,
  delay = wait,
  writeOutput = (stdout, stderr) => {
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
  },
  writeWarning = message => process.stderr.write(`::warning::${message}\n`)
} = {}) {
  if (!['staple', 'validate'].includes(action) || typeof path !== 'string' || !path.trim()) {
    throw new Error('Usage: run-stapler.mjs <staple|validate> <path>')
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { status, stdout = '', stderr = '' } = await run(action, path)
    writeOutput(stdout, stderr)
    if (status === 0) return
    const output = `${stdout}\n${stderr}`
    if (attempt === 5 || status !== 68 || !output.includes('https://api.apple-cloudkit.com/') ||
        !/NSURLErrorDomain Code=-(?:1001|1003|1004|1005|1006|1009)\b/u.test(output)) {
      throw new Error(`stapler ${action} failed with exit code ${status}.`)
    }
    writeWarning(`Apple ticket service connection failed; retrying stapler ${action} (${attempt}/5).`)
    await delay(15_000)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: run-stapler.mjs <staple|validate> <path>')
  await runStapler(process.argv[2], process.argv[3])
}
