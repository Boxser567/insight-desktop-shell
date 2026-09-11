import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function requireText(value, expected, label) {
  if (!value.includes(expected)) throw new Error(`${label} is missing: ${expected}`)
}

async function main() {
  const [workflowPath, clientPath, ...rest] = process.argv.slice(2)
  if (!workflowPath || !clientPath || rest.length > 0) {
    throw new Error('Usage: verify-publish-workflow.mjs <workflow-yml> <github-oss-client>')
  }
  const [workflow, client] = await Promise.all([
    readFile(resolve(workflowPath), 'utf8'),
    readFile(resolve(clientPath), 'utf8')
  ])

  const trigger = /^on:\r?\n([\s\S]*?)(?=^permissions:)/mu.exec(workflow)?.[1] ?? ''
  requireText(trigger, 'workflow_dispatch:', 'Publish workflow trigger')
  for (const forbidden of ['pull_request:', 'push:', 'schedule:', 'repository_dispatch:']) {
    if (trigger.includes(forbidden)) throw new Error(`Publish workflow contains ${forbidden}`)
  }
  requireText(trigger, 'command:', 'Publish workflow inputs')
  requireText(trigger, '- stage', 'Publish workflow command choices')
  requireText(trigger, '- promote', 'Publish workflow command choices')
  requireText(trigger, 'tag:', 'Publish workflow inputs')
  requireText(trigger, 'scope:', 'Publish workflow inputs')
  requireText(trigger, '- macos-arm64', 'Publish workflow scope choices')
  requireText(trigger, 'confirm_version:', 'Publish workflow inputs')

  const permissions = /^permissions:\r?\n((?:  [^\r\n]+\r?\n?)*)/mu.exec(workflow)?.[1]
    ?.trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .sort()
  if (permissions?.join(',') !== ['contents: write', 'id-token: write'].sort().join(',')) {
    throw new Error('Publish workflow permissions must be exactly contents: write and id-token: write.')
  }

  for (const required of [
    'group: desktop-update-publish',
    'cancel-in-progress: false',
    'environment: desktop-release',
    'persist-credentials: false',
    'node-version: 22',
    "test \"$GITHUB_REF\" = 'refs/heads/main'",
    'npm ci --ignore-scripts',
    'node scripts/verify-publish-workflow.mjs',
    'node scripts/publish-update-to-oss.mjs',
    '--scope "$SCOPE"',
    'GH_TOKEN: ${{ github.token }}',
    'if: always()',
    'uses: actions/upload-artifact@v4',
    'path: release-reports/'
  ]) {
    requireText(workflow, required, 'Publish workflow')
  }
  for (const forbidden of [
    'OSS_ACCESS_KEY_ID',
    'OSS_ACCESS_KEY_SECRET',
    'OSS_SESSION_TOKEN',
    'ossutil',
    'pull_request_target:',
    'secrets.'
  ]) {
    if (workflow.includes(forbidden)) throw new Error(`Publish workflow contains ${forbidden}.`)
  }

  for (const required of [
    "const expectedRepository = 'Boxser567/insight-desktop-shell'",
    "const expectedRepositoryId = '1344679131'",
    "const expectedBucket = 'insight-desktop-updates'",
    "const expectedRegion = 'oss-cn-guangzhou'",
    "const expectedEndpoint = 'oss-cn-guangzhou.aliyuncs.com'",
    "const expectedWorkflowRef = 'Boxser567/insight-desktop-shell/.github/workflows/publish-update.yml@refs/heads/main'",
    "const gatewayBaseUrl = 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway'",
    "const oidcAudience = 'insight-harness-oss-upload'"
  ]) {
    if (!client.includes(required)) {
      const label = required.includes('gatewayBaseUrl') ? 'fixed test Gateway' : 'fixed publisher boundary'
      throw new Error(`GitHub OSS client is missing ${label}: ${required}`)
    }
  }
  if (!client.includes("body: '{}'")) {
    throw new Error('GitHub OSS client must request directory-level STS with an empty JSON object.')
  }
  requireText(client, "'SecurityTokenExpired'", 'GitHub OSS client')
  requireText(client, "'InvalidSecurityToken'", 'GitHub OSS client')
  requireText(client, 'refreshBeforeExpirationMs = 180_000', 'GitHub OSS client')

  console.log('Desktop update publish workflow contract is valid.')
}

await main()
