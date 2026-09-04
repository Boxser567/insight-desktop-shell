import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function section(workflow, name, next) {
  const pattern = next
    ? new RegExp(`  ${name}:\\r?\\n[\\s\\S]*?(?=\\r?\\n  ${next}:)`, 'u')
    : new RegExp(`  ${name}:\\r?\\n[\\s\\S]*$`, 'u')
  const value = pattern.exec(workflow)?.[0]
  if (!value) throw new Error(`Release workflow is missing job: ${name}`)
  return value
}

function requireText(value, text, label) {
  if (!value.includes(text)) throw new Error(`${label} is missing: ${text}`)
}

async function main() {
  const [workflowPath, packagePath, ...rest] = process.argv.slice(2)
  if (!workflowPath || !packagePath || rest.length > 0) {
    throw new Error('Usage: verify-release-workflow.mjs <workflow-yml> <package-json>')
  }
  const [workflow, packageJson] = await Promise.all([
    readFile(resolve(workflowPath), 'utf8'),
    readFile(resolve(packagePath), 'utf8').then(JSON.parse)
  ])
  const preflight = section(workflow, 'release-preflight', 'macos-apple-silicon')
  const appleSilicon = section(workflow, 'macos-apple-silicon', 'macos-intel')
  const intel = section(workflow, 'macos-intel', 'windows-x64')
  const windows = section(workflow, 'windows-x64', 'publish')
  const publish = section(workflow, 'publish')

  requireText(workflow, 'candidate_tag:', 'Release workflow')
  requireText(preflight, 'verify-release-preflight.mjs', 'Release preflight')
  requireText(preflight, 'verify-release-workflow.mjs', 'Release preflight')
  if (/npm ci|vitest|rollup|esbuild/u.test(preflight)) {
    throw new Error('Release preflight must not install dependencies or load native build tools.')
  }
  for (const [name, job] of [
    ['macos-apple-silicon', appleSilicon],
    ['macos-intel', intel],
    ['windows-x64', windows]
  ]) {
    requireText(job, 'needs: release-preflight', name)
  }
  for (const [name, job] of [
    ['macos-apple-silicon', appleSilicon],
    ['macos-intel', intel]
  ]) {
    requireText(job, 'APPLE_TEAM_ID: ${{ secrets.DESKTOP_APPLE_TEAM_ID }}', name)
    requireText(job, 'CSC_NAME: ${{ steps.signing_keychain.outputs.identity }}', name)
    requireText(job, 'ulimit -n 10240', name)
  }
  requireText(windows, "$PSNativeCommandUseErrorActionPreference = $true", 'windows-x64')
  requireText(windows, '$appExecutable', 'windows-x64')
  requireText(
    windows,
    'finalize-windows-release.mjs $releaseDir $env:RELEASE_VERSION $appExecutable',
    'windows-x64'
  )
  requireText(publish, 'environment: desktop-release', 'Publish job')
  for (const dependency of [
    '- release-preflight',
    '- macos-apple-silicon',
    '- macos-intel',
    '- windows-x64'
  ]) {
    requireText(publish, dependency, 'Publish job')
  }
  requireText(publish, 'secrets.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY', 'Publish job')
  if (workflow.slice(0, workflow.indexOf('\n  publish:')).includes('DESKTOP_UPDATE_SIGNING_PRIVATE_KEY')) {
    throw new Error('The update signing private key may only be used by the publish job.')
  }
  for (const forbidden of [
    'windows_prerelease_tag',
    'sign-windows',
    'DESKTOP_WINDOWS_SIGNING_PIN',
    'dshdesktop.com',
    'FEISHU_RELEASE_WEBHOOK',
    '--clobber'
  ]) {
    if (workflow.includes(forbidden)) throw new Error(`Release workflow contains ${forbidden}.`)
  }

  const scripts = packageJson.scripts ?? {}
  for (const [name, command] of Object.entries({
    'package:candidate:mac:arm64': 'finalize-mac-release.mjs dist-candidate insight-candidate-mac-arm64.zip',
    'package:candidate:mac:x64': 'finalize-mac-release.mjs dist-candidate insight-candidate-mac-x64.zip',
    'package:mac:arm64': 'finalize-mac-release.mjs dist insight-mac-arm64.zip',
    'package:mac:x64': 'finalize-mac-release.mjs dist insight-mac-x64.zip'
  })) {
    if (typeof scripts[name] !== 'string' || !scripts[name].includes(command)) {
      throw new Error(`Package script ${name} does not finalize macOS update metadata.`)
    }
  }
  console.log('Release workflow contract is valid.')
}

await main()
