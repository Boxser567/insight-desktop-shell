import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []
const verifier = path.join(process.cwd(), 'scripts', 'verify-release-workflow.mjs')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

function run(workflow: string, packageJson = path.join(process.cwd(), 'package.json')) {
  return spawnSync(process.execPath, [verifier, workflow, packageJson], { encoding: 'utf8' })
}

async function readReleaseWorkflow(): Promise<string> {
  return (await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'release.yml'),
    'utf8'
  )).replaceAll('\r\n', '\n')
}

describe('release workflow verifier', () => {
  it('accepts the dependency-free complete release workflow', () => {
    const result = run(path.join(process.cwd(), '.github', 'workflows', 'release.yml'))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('contract is valid')
  })

  it('rejects native preflight dependencies and inherited release services', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'insight-release-workflow-'))
    temporaryDirectories.push(directory)
    const source = await readReleaseWorkflow()
    const workflow = path.join(directory, 'release.yml')
    await writeFile(workflow, source.replace(
      'node scripts/verify-release-workflow.mjs',
      'npm ci && node scripts/verify-release-workflow.mjs'
    ))
    expect(run(workflow).stderr).toContain('must not install dependencies')

    await writeFile(workflow, source.replace('permissions:', 'FEISHU_RELEASE_WEBHOOK: forbidden\n\npermissions:'))
    expect(run(workflow).stderr).toContain('FEISHU_RELEASE_WEBHOOK')

    await writeFile(workflow, source.replace(
      'permissions:\n  contents: write',
      'permissions:\n  contents: write\n  id-token: write'
    ))
    expect(run(workflow).stderr).toContain('must grant only contents')
  })

  it('requires every platform job to test the prepared Runtime', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'insight-release-workflow-'))
    temporaryDirectories.push(directory)
    const source = await readReleaseWorkflow()
    const workflow = path.join(directory, 'release.yml')
    await writeFile(workflow, source.replace(
      '      - name: Test prepared Runtime\n        run: npm test\n',
      ''
    ))

    expect(run(workflow).stderr).toContain('Test prepared Runtime')
  })

  it('requires final macOS bundles to verify the production Keychain identity', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'insight-release-workflow-'))
    temporaryDirectories.push(directory)
    const source = await readReleaseWorkflow()
    const workflow = path.join(directory, 'release.yml')
    await writeFile(workflow, source.replaceAll(
      "          test \"$bundle_id\" = 'com.insight-aigc.desktop' || { echo \"::error::Unexpected macOS Bundle ID: $bundle_id\"; exit 1; }\n",
      ''
    ))

    expect(run(workflow).stderr).toContain('production macOS Bundle ID')
  })
})
