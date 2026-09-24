import { readFile } from 'node:fs/promises'

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`${label} is missing: ${text}`)
}

async function main() {
  const path = process.argv[2]
  if (!path || process.argv.length !== 3) {
    throw new Error('Usage: verify-release-v2-workflow.mjs <workflow>')
  }
  const workflow = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
  for (const value of [
    'group: desktop-release-v2-${{ inputs.version }}',
    'ref: refs/tags/v${{ inputs.version }}',
    'darwin-arm64',
    'darwin-x64',
    'win32-x64',
    'npm run package:release:mac:arm64',
    'npm run package:release:mac:x64',
    'npm run package:release:win',
    'scripts/prepare-update-v2-draft.mjs',
    'npm run prepare:core-runtime',
    'scripts/build-update-v2-target.mjs',
    'scripts/verify-update-v2-assets.mjs',
    'scripts/upload-update-v2-target.mjs',
    'ref: ${{ github.workflow_sha }}',
    'node release-tooling/scripts/upload-update-v2-target.mjs',
    'scripts/verify-sandboxed-preload.mjs out/preload/about.cjs',
    'secrets.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY',
    'environment: desktop-release',
    'APPLE_API_KEY_CONTENT',
    'finalize-windows-release.mjs'
  ]) requireText(workflow, value, 'v2 release workflow')
  if ((workflow.match(/persist-credentials: false/gu) ?? []).length !== 6) {
    throw new Error('Every v2 release checkout must disable persisted credentials.')
  }
  requireText(workflow, 'permissions:\n  contents: read', 'v2 release workflow')
  if ((workflow.match(/permissions:\n      contents: write/gu) ?? []).length !== 2) {
    throw new Error('Only v2 release mutation jobs may request contents: write.')
  }
  for (const command of [
    'npm run typecheck',
    'npm test',
    'npm run build:desktop-integration',
    'npx electron-vite build',
    'scripts/verify-publish-v2-workflow.mjs'
  ]) requireText(workflow, command, 'v2 pre-Tag gate')
  for (const forbidden of [
    '--clobber',
    'OSS_ACCESS_KEY',
    'ALIYUN_',
    'publish-update-to-oss.mjs',
    'electron-builder.candidate.cjs',
    'package:candidate:'
  ]) {
    if (workflow.includes(forbidden)) throw new Error(`v2 release workflow contains ${forbidden}.`)
  }
  console.log('Release v2 workflow contract is valid.')
}

await main()
