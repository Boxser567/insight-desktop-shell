import { execFile as execFileCallback } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const attempts = 3
const retryDelayMs = 5_000

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

export function isInternalXprotectFailure(status, output) {
  const fatalCount = output.match(/Severity:\s*Fatal/gu)?.length ?? 0
  return status === 70 &&
    fatalCount === 1 &&
    output.includes('Internal Xprotect Error') &&
    output.includes('Passed codesign --verify -R="notarized" --check-notarization') &&
    output.includes('Passed Gatekeeper scan')
}

async function runSyspolicyCheck(appPath) {
  try {
    const result = await execFile('syspolicy_check', [
      'distribution',
      '--verbose',
      appPath
    ], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60_000
    })
    return { status: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (!error || typeof error !== 'object') throw error
    return {
      status: Number.isInteger(error.code) ? error.code : 1,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : ''
    }
  }
}

export async function verifyMacosDistribution(appPath, {
  run = runSyspolicyCheck,
  delay = wait,
  writeOutput = (stdout, stderr) => {
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
  },
  writeWarning = (message) => process.stderr.write(`::warning::${message}\n`)
} = {}) {
  if (typeof appPath !== 'string' || appPath.trim() === '') {
    throw new Error('macOS application path is required.')
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await run(appPath)
    const stdout = typeof result?.stdout === 'string' ? result.stdout : ''
    const stderr = typeof result?.stderr === 'string' ? result.stderr : ''
    const status = Number.isInteger(result?.status) ? result.status : 1
    writeOutput(stdout, stderr)
    if (status === 0) return { degraded: false, attempts: attempt }
    const output = `${stdout}\n${stderr}`
    if (!isInternalXprotectFailure(status, output)) {
      throw new Error(`syspolicy_check failed with exit code ${status}.`)
    }
    if (attempt < attempts) {
      writeWarning(`syspolicy_check hit an internal XProtect error; retrying (${attempt}/${attempts}).`)
      await delay(retryDelayMs)
    }
  }
  writeWarning(
    'syspolicy_check could not run its XProtect subcheck after 3 attempts; ' +
    'codesign/notarization and Gatekeeper passed, so independent stapler and DMG checks will continue.'
  )
  return { degraded: true, attempts }
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error('Usage: verify-macos-distribution.mjs <application-path>')
  }
  await verifyMacosDistribution(process.argv[2])
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
