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

describe('release workflow verifier', () => {
  it('accepts the dependency-free complete release workflow', () => {
    const result = run(path.join(process.cwd(), '.github', 'workflows', 'release.yml'))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('contract is valid')
  })

  it('rejects native preflight dependencies and inherited release services', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'insight-release-workflow-'))
    temporaryDirectories.push(directory)
    const source = await readFile(
      path.join(process.cwd(), '.github', 'workflows', 'release.yml'),
      'utf8'
    )
    const workflow = path.join(directory, 'release.yml')
    await writeFile(workflow, source.replace(
      'node scripts/verify-release-workflow.mjs',
      'npm ci && node scripts/verify-release-workflow.mjs'
    ))
    expect(run(workflow).stderr).toContain('must not install dependencies')

    await writeFile(workflow, source.replace('permissions:', 'FEISHU_RELEASE_WEBHOOK: forbidden\n\npermissions:'))
    expect(run(workflow).stderr).toContain('FEISHU_RELEASE_WEBHOOK')
  })
})
