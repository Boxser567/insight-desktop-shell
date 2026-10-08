import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { smokePackagedHarness } from './smoke-packaged-harness.mjs'
import { verifySessionRecovery } from './verify-session-recovery.mjs'

const project = fileURLToPath(new URL('../', import.meta.url))
const json = async file => JSON.parse(await readFile(file, 'utf8'))
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex')

/** Verify the actual formal package, then rehearse historical migration and recovery on isolated data. */
export async function verifyPackagedRecovery(resources, previousRuntime, reportPath) {
  const root = resolve(resources)
  const [source, packaged, lock, runtime, manifest, compatibility] = await Promise.all([
    json(join(project, 'package.json')), json(join(root, 'app/package.json')),
    json(join(project, 'core-runtime.lock.json')), json(join(root, 'runtime/runtime.json')),
    json(join(root, 'runtime-manifest.json')), json(join(project, 'build/update-compatibility.json'))
  ])
  assert.equal(packaged.version, source.version)
  assert.equal(packaged.insightDesktopAppId, 'com.insight-aigc.desktop')
  assert.equal(packaged.insightDesktopChannel, 'stable')
  const target = `${process.platform}-${process.arch}`
  const selected = lock.targets[target]
  assert.ok(selected, 'The public Runtime lock must contain this target')
  assert.deepEqual(runtime.core, selected.core)
  assert.deepEqual(runtime.target, { platform: process.platform, arch: process.arch })
  assert.equal(manifest.core.releaseTag, lock.releaseTag)
  assert.equal(manifest.core.commit, selected.core.commit)
  assert.equal(manifest.checksums.archiveSha256, selected.sha256)
  const profile = join(root, 'bundled-profile/web')
  assert.equal((await json(join(profile, 'node_modules/dsh-prompt-enhance/package.json'))).version, '0.2.7')
  assert.ok(!(await lstat(join(profile, 'node_modules/@insight-ai/desktop-integration'))).isSymbolicLink(), 'The first-party entry must be portable files')
  for (const file of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
    const expected = await hash(join(project, 'packages/insight-desktop-integration', file))
    for (const entry of ['packages/insight-desktop-integration', 'node_modules/@insight-ai/desktop-integration']) {
      assert.equal(await hash(join(profile, entry, file)), expected, `Packaged integration mismatch: ${entry}/${file}`)
    }
  }
  await smokePackagedHarness(root)
  const proof = await verifySessionRecovery({
    candidateRuntime: join(root, 'runtime'), recoveryRuntime: join(project, 'build/core-runtime'), previousRuntime
  })
  assert.equal(proof.phases.find(phase => phase.phase === 'candidate').writer, ({ 1: 3, 2: 4 })[compatibility.writesDataSchema], 'Declared data schema must match the actual Session writer')
  await mkdir(dirname(resolve(reportPath)), { recursive: true })
  await writeFile(resolve(reportPath), JSON.stringify({ ...proof, desktopVersion: packaged.version, target,
    appId: packaged.insightDesktopAppId, runtimeTag: lock.releaseTag,
    archiveSha256: selected.sha256, packagedStartup: 'passed' }, null, 2) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [resources, previousRuntime, report] = process.argv.slice(2)
  if (!resources || !previousRuntime || !report || process.argv.length !== 5) {
    throw new Error('Usage: verify-packaged-recovery.mjs <resources> <previous-v3-runtime> <report.json>')
  }
  await verifyPackagedRecovery(resources, previousRuntime, report)
}
