import { readFile } from 'node:fs/promises'

function requireText(source, text) {
  if (!source.includes(text)) throw new Error(`v2 publish workflow is missing: ${text}`)
}

const path = process.argv[2]
if (!path || process.argv.length !== 3) {
  throw new Error('Usage: verify-publish-v2-workflow.mjs <workflow>')
}
const source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
for (const text of [
  'stage-target',
  'publish-candidate',
  'accept-target',
  'promote-stable',
  'reject-version',
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
  'group: desktop-update-publish',
  'environment: desktop-release',
  'id-token: write',
  'persist-credentials: false',
  'scripts/publish-update-v2-to-oss.mjs',
  'scripts/verify-publish-v2-workflow.mjs',
  'git show "refs/tags/v$VERSION:build/update-release-policy.json"',
  'secrets.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY',
  "inputs.command == 'publish-candidate' || inputs.command == 'accept-target' || inputs.command == 'promote-stable' || inputs.command == 'reject-version'"
]) requireText(source, text)

for (const forbidden of [
  'OSS_ACCESS_KEY',
  'OSS_ACCESS_KEY_SECRET',
  'ALIYUN_',
  '--clobber',
  'package:candidate:',
  'electron-builder.candidate.cjs'
]) {
  if (source.includes(forbidden)) throw new Error(`v2 publish workflow contains ${forbidden}.`)
}

console.log('Publish v2 workflow contract is valid.')
