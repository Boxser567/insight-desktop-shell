import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []
const verifier = path.join(process.cwd(), 'scripts', 'verify-publish-workflow.mjs')
const workflow = path.join(process.cwd(), '.github', 'workflows', 'publish-update.yml')
const client = path.join(process.cwd(), 'scripts', 'github-oss-client.mjs')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

function run(workflowPath = workflow, clientPath = client) {
  return spawnSync(process.execPath, [verifier, workflowPath, clientPath], { encoding: 'utf8' })
}

describe('desktop update publish workflow verifier', () => {
  it('accepts the manual OIDC publisher with fixed service boundaries', () => {
    const result = run()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('contract is valid')
  })

  it('rejects broader permissions, untrusted triggers, and OSS secrets', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'insight-publish-workflow-'))
    temporaryDirectories.push(directory)
    const source = await readFile(workflow, 'utf8')
    const candidate = path.join(directory, 'publish-update.yml')

    await writeFile(candidate, source.replace(
      '  id-token: write',
      '  id-token: write\n  actions: write'
    ))
    expect(run(candidate).stderr).toContain('permissions')

    await writeFile(candidate, source.replace('  workflow_dispatch:', '  pull_request:\n  workflow_dispatch:'))
    expect(run(candidate).stderr).toContain('pull_request')

    await writeFile(candidate, source.replace(
      'GH_TOKEN: ${{ github.token }}',
      'GH_TOKEN: ${{ github.token }}\n          OSS_ACCESS_KEY_SECRET: ${{ secrets.OSS_KEY }}'
    ))
    expect(run(candidate).stderr).toContain('OSS_ACCESS_KEY_SECRET')
  })

  it('rejects a mutable Gateway or filename-scoped STS request', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'insight-publish-client-'))
    temporaryDirectories.push(directory)
    const source = await readFile(client, 'utf8')
    const candidate = path.join(directory, 'github-oss-client.mjs')

    await writeFile(candidate, source.replace(
      "const gatewayBaseUrl = 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway'",
      "const gatewayBaseUrl = process.env.GATEWAY_URL"
    ))
    expect(run(workflow, candidate).stderr).toContain('test Gateway')

    await writeFile(candidate, source.replace("body: '{}'", "body: JSON.stringify({ fileName: 'asset.dmg' })"))
    expect(run(workflow, candidate).stderr).toContain('directory-level STS')
  })
})
