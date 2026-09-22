import { execFile as execFileCallback } from 'node:child_process'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify as verifySignature
} from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import semver from 'semver'
import { createGithubOssClient } from './github-oss-client.mjs'
import {
  acquirePublisherLock,
  assertNoOssCredentialEnvironment
} from './publish-update-to-oss.mjs'
import { buildV2Index } from './build-update-v2-index.mjs'
import {
  UPDATE_V2_SCHEMAS,
  UPDATE_V2_TARGET_IDS,
  assertCandidateRecoveryCompatible,
  canonicalJsonBytes,
  parseCanonicalV2Envelope,
  parseV2ReleaseIndex,
  parseV2RolloutPayload,
  parseV2TargetManifest,
  sha512
} from './update-v2-contract.mjs'
import { verifyV2TargetAssets } from './verify-update-v2-assets.mjs'

const execFile = promisify(execFileCallback)
const repository = 'Boxser567/insight-desktop-shell'
const updateOrigin = 'https://updates.insight-aigc.com/'
const immutableCache = 'public,max-age=31536000,immutable'
const pointerCache = 'public,max-age=60,must-revalidate'
const targetCommands = new Set(['stage-target', 'publish-candidate', 'accept-target'])
const allCommands = new Set([
  ...targetCommands,
  'promote-stable',
  'reject-version'
])

function usage() {
  return [
    'Usage:',
    '  publish-update-v2-to-oss.mjs stage-target --version <final-semver> --target <target>',
    '  publish-update-v2-to-oss.mjs publish-candidate --version <final-semver> --target <target>',
    '  publish-update-v2-to-oss.mjs accept-target --version <final-semver> --target <target>',
    '  publish-update-v2-to-oss.mjs promote-stable --version <final-semver> --confirm-version <final-semver>',
    '  publish-update-v2-to-oss.mjs reject-version --version <final-semver> --confirm-version <final-semver> --reason <text>'
  ].join('\n')
}

export function parseV2PublisherArguments(argv) {
  const [command, ...rest] = argv
  if (!allCommands.has(command)) throw new Error(usage())
  const allowed = new Set(['--version', '--target', '--confirm-version', '--reason'])
  const values = new Map()
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]
    const value = rest[index + 1]
    if (!allowed.has(name) || !value || values.has(name)) throw new Error(usage())
    values.set(name, value)
  }
  const version = values.get('--version')
  const parsed = semver.parse(version)
  if (
    semver.valid(version) !== version || !parsed ||
    parsed.prerelease.length > 0 || parsed.build.length > 0
  ) throw new Error('v2 release version must be a final semantic version.')
  const target = values.get('--target')
  if (targetCommands.has(command)) {
    if (!UPDATE_V2_TARGET_IDS.includes(target)) throw new Error('v2 update target is invalid.')
  } else if (target !== undefined) {
    throw new Error(`${command} does not accept a target.`)
  }
  const confirmation = values.get('--confirm-version')
  if (command === 'promote-stable' || command === 'reject-version') {
    if (confirmation !== version) throw new Error('Version confirmation does not match.')
  } else if (confirmation !== undefined) {
    throw new Error(`${command} does not accept a version confirmation.`)
  }
  const reason = values.get('--reason')
  if (command === 'reject-version') {
    if (!reason || reason.length > 500) throw new Error('A concise rejection reason is required.')
  } else if (reason !== undefined) {
    throw new Error(`${command} does not accept a rejection reason.`)
  }
  return { command, version, target, reason }
}

function targetPrefix(version, target) {
  return `desktop/releases/v${version}/targets/${target}/`
}

function pointerKey(track, target) {
  return track === 'stable'
    ? 'desktop/stable/current.json'
    : `desktop/candidate-v2/${target}/current.json`
}

function acceptanceKey(version, target) {
  return `desktop/releases/v${version}/acceptance/${target}.json`
}

function rejectionKey(version) {
  return `desktop/releases/v${version}/rejection.json`
}

function auditSignatureKey(key) {
  return `${key}.sig`
}

function digest(bytes) {
  return createHash('sha512').update(bytes).digest('base64')
}

function byteIdentity(bytes) {
  return { size: bytes.length, sha512: digest(bytes) }
}

async function fileDigest(path) {
  const hash = createHash('sha512')
  let size = 0
  for await (const chunk of createReadStream(path)) {
    size += chunk.length
    hash.update(chunk)
  }
  return { size, sha512: hash.digest('base64') }
}

async function run(file, args) {
  try {
    return await execFile(file, args, {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) =>
        !name.startsWith('OSS_') && !name.startsWith('ALIYUN_'))),
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30 * 60_000,
      windowsHide: true
    })
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr).trim()
      : ''
    throw new Error(`${file} failed${stderr ? `: ${stderr}` : '.'}`)
  }
}

async function readRemoteObject(oss, key, directory, label, { includeBytes = true } = {}) {
  const objects = await oss.listObjects(key)
  const exact = objects.filter((object) => object.key === key)
  if (exact.length === 0) return undefined
  if (exact.length !== 1) throw new Error(`${label} has duplicate objects.`)
  const path = join(directory, `${createHash('sha256').update(key).digest('hex')}.object`)
  await oss.getObject(key, path)
  const identity = await fileDigest(path)
  if (identity.size !== exact[0].size) throw new Error(`${label} size changed during verification.`)
  return {
    key,
    path,
    ...identity,
    ...(includeBytes ? { bytes: await readFile(path) } : {})
  }
}

async function putImmutableFile(oss, key, source, directory) {
  const expected = await fileDigest(source)
  const existing = await readRemoteObject(
    oss,
    key,
    directory,
    'Immutable release object',
    { includeBytes: false }
  )
  if (existing) {
    if (existing.size !== expected.size || existing.sha512 !== expected.sha512) {
      throw new Error(`Immutable release object conflicts: ${key}`)
    }
    return { key, ...expected, action: 'verified' }
  }
  await oss.uploadReleaseObject(key, source, {
    'x-oss-forbid-overwrite': 'true',
    'cache-control': immutableCache,
    ...(key.endsWith('.dmg') || key.endsWith('.exe')
      ? { 'content-disposition': `attachment; filename="${basename(key)}"` }
      : {})
  })
  const committed = await readRemoteObject(
    oss,
    key,
    directory,
    'Immutable release object',
    { includeBytes: false }
  )
  if (!committed || committed.size !== expected.size || committed.sha512 !== expected.sha512) {
    throw new Error(`Immutable release object verification failed: ${key}`)
  }
  return { key, ...expected, action: 'uploaded' }
}

async function putImmutableBytes(oss, key, bytes, directory) {
  const source = join(directory, `${createHash('sha256').update(`${key}-source`).digest('hex')}.source`)
  await writeFile(source, bytes, { mode: 0o600 })
  return putImmutableFile(oss, key, source, directory)
}

async function putSignedAuditRecord(input, key, bytes) {
  if (!input.privateKeyPath) throw new Error('Product update signing key is required.')
  const privateKey = createPrivateKey(await readFile(input.privateKeyPath, 'utf8'))
  const signature = sign(null, bytes, privateKey)
  await putImmutableBytes(input.oss, auditSignatureKey(key), signature, input.temporaryDirectory)
  await putImmutableBytes(input.oss, key, bytes, input.temporaryDirectory)
}

async function readSignedAuditRecord(input, key, label) {
  const record = await readRemoteObject(input.oss, key, input.temporaryDirectory, label)
  if (!record) return undefined
  const signature = await readRemoteObject(
    input.oss,
    auditSignatureKey(key),
    input.temporaryDirectory,
    `${label} signature`
  )
  if (!signature) throw new Error(`${label} signature is missing.`)
  const publicKey = createPublicKey(await readFile(input.publicKeyPath, 'utf8'))
  if (!verifySignature(null, record.bytes, publicKey, signature.bytes)) {
    throw new Error(`${label} signature is invalid.`)
  }
  return record.bytes
}

function parseRejection(bytes, version) {
  const rejection = JSON.parse(bytes.toString('utf8'))
  const keys = Object.keys(rejection).sort().join(',')
  if (
    keys !== 'actor,reason,rejectedAt,schema,version,workflowRun' ||
    rejection?.schema !== 'insight-desktop-rejection/v1' ||
    rejection.version !== version ||
    typeof rejection.reason !== 'string' || rejection.reason.length === 0 ||
    typeof rejection.actor !== 'string' || rejection.actor.length === 0 ||
    !/^\d+$/u.test(rejection.workflowRun) ||
    !Number.isFinite(Date.parse(rejection.rejectedAt))
  ) throw new Error('Rejection record is invalid.')
  return rejection
}

async function assertVersionNotRejected(input) {
  const bytes = await readSignedAuditRecord(
    input,
    rejectionKey(input.version),
    'Rejection record'
  )
  if (!bytes) return
  const rejection = parseRejection(bytes, input.version)
  throw new Error(`v2 release version was rejected: ${rejection.reason}`)
}

export async function verifyCdnBytes(key, expected, {
  fetch: fetchImplementation = globalThis.fetch,
  wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  attempts = 7
} = {}) {
  const url = new URL(key, updateOrigin)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const requestUrl = new URL(url)
      requestUrl.searchParams.set('publisher-check', String(Date.now()))
      if (expected.requireRange) {
        const head = await fetchImplementation(requestUrl, {
          method: 'HEAD',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(30_000)
        })
        if (head.status !== 200 || head.headers.get('content-length') !== String(expected.size)) {
          throw new Error('CDN recovery installer HEAD verification failed.')
        }
        const range = await fetchImplementation(requestUrl, {
          headers: { Range: 'bytes=0-0' },
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(30_000)
        })
        let rangeSize = 0
        if (range.status === 206 && range.body) {
          for await (const chunk of range.body) {
            rangeSize += chunk.byteLength
            if (rangeSize > 1) break
          }
        }
        if (
          range.status !== 206 ||
          range.headers.get('content-range') !== `bytes 0-0/${expected.size}` ||
          rangeSize !== 1
        ) throw new Error('CDN recovery installer Range verification failed.')
      }
      const response = await fetchImplementation(requestUrl, {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000)
      })
      if (response.ok && response.body) {
        const hash = createHash('sha512')
        let size = 0
        for await (const chunk of response.body) {
          size += chunk.byteLength
          if (size > expected.size) throw new Error('CDN response exceeds expected size.')
          hash.update(chunk)
        }
        if (size === expected.size && hash.digest('base64') === expected.sha512) return
      }
    } catch {
      // Retry only within the bounded CDN convergence window.
    }
    if (attempt + 1 < attempts) await wait(10_000)
  }
  throw new Error(`CDN did not converge to the verified bytes: ${key}`)
}

async function verifyTargetDirectory(targetDir, version, target, publicKeyPath) {
  return verifyV2TargetAssets({ targetDir, version, target, publicKeyPath })
}

export async function stageV2Target(input) {
  await assertVersionNotRejected(input)
  const manifest = await verifyTargetDirectory(
    input.targetDir,
    input.version,
    input.target,
    input.publicKeyPath
  )
  const files = (await readdir(input.targetDir, { withFileTypes: true }))
  if (files.some((entry) => !entry.isFile())) throw new Error('Target directory may contain files only.')
  const prefix = targetPrefix(input.version, input.target)
  const expectedKeys = files.map(({ name }) => `${prefix}${name}`).sort()
  const existing = await input.oss.listObjects(prefix)
  if (existing.some(({ key }) => !expectedKeys.includes(key))) {
    throw new Error('Immutable target prefix contains unexpected objects.')
  }
  const uploaded = []
  for (const entry of files.sort((left, right) => left.name.localeCompare(right.name))) {
    uploaded.push(await putImmutableFile(
      input.oss,
      `${prefix}${entry.name}`,
      join(input.targetDir, entry.name),
      input.temporaryDirectory
    ))
  }
  const finalObjects = await input.oss.listObjects(prefix)
  if (
    finalObjects.length !== expectedKeys.length ||
    finalObjects.map(({ key }) => key).sort().some((key, index) => key !== expectedKeys[index])
  ) throw new Error('Immutable target prefix is incomplete after staging.')
  return { manifest, manifestSha512: digest(await readFile(join(input.targetDir, 'insight-target.json'))), uploaded }
}

async function downloadVerifiedTarget(input, target) {
  const prefix = targetPrefix(input.version, target)
  const objects = await input.oss.listObjects(prefix)
  if (objects.length === 0) throw new Error(`Target has not been staged: ${target}`)
  const directory = join(input.temporaryDirectory, `verified-${target}`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  for (const object of objects) {
    const name = object.key.slice(prefix.length)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(name)) {
      throw new Error(`Target prefix contains an invalid object: ${object.key}`)
    }
    await input.oss.getObject(object.key, join(directory, name))
  }
  const manifest = await verifyTargetDirectory(
    directory,
    input.version,
    target,
    input.publicKeyPath
  )
  const manifestBytes = await readFile(join(directory, 'insight-target.json'))
  return { directory, manifest, manifestBytes, prefix, objects }
}

async function readAuthenticatedPointer(input, key, { allowLegacy = false } = {}) {
  const object = await readRemoteObject(input.oss, key, input.temporaryDirectory, 'Update pointer')
  if (!object) return undefined
  let value
  try {
    value = JSON.parse(object.bytes.toString('utf8'))
  } catch {
    throw new Error(`Update pointer is not valid JSON: ${key}`)
  }
  if (allowLegacy && value?.schemaVersion === 1 && semver.valid(value.version) === value.version) {
    const expectedChannel = key === pointerKey('stable') ? 'stable' : 'candidate'
    if (
      value.channel !== expectedChannel ||
      Object.keys(value).sort().join(',') !== 'channel,schemaVersion,version'
    ) throw new Error(`Legacy update pointer is invalid: ${key}`)
    if (key !== 'desktop/candidate/current.json' || value.version !== '1.0.0-rc.19') {
      throw new Error('Legacy update pointer must be the signed rc.19 recovery bridge.')
    }
    return { ...object, version: value.version, legacy: true, value }
  }
  const authenticated = parseCanonicalV2Envelope(object.bytes)
  const publicKey = createPublicKey(await readFile(input.publicKeyPath, 'utf8'))
  if (!verifySignature(
    null,
    authenticated.payloadBytes,
    publicKey,
    authenticated.signatureBytes
  )) throw new Error(`Update pointer signature is invalid: ${key}`)
  if (key === pointerKey('stable')) {
    if (authenticated.payload.track !== 'stable' || authenticated.payload.target !== undefined) {
      throw new Error('Stable pointer payload identity is invalid.')
    }
  } else if (key.startsWith('desktop/candidate-v2/')) {
    const target = key.split('/')[2]
    if (authenticated.payload.track !== 'candidate' || authenticated.payload.target !== target) {
      throw new Error('Candidate pointer payload identity is invalid.')
    }
  }
  return {
    ...object,
    version: authenticated.payload.version,
    legacy: false,
    value: authenticated.payload
  }
}

async function authoritativePointers(input) {
  const entries = [
    ['stable', pointerKey('stable')],
    ['legacy-candidate', 'desktop/candidate/current.json'],
    ...UPDATE_V2_TARGET_IDS.map((target) => [target, pointerKey('candidate', target)])
  ]
  const result = []
  for (const [name, key] of entries) {
    const pointer = await readAuthenticatedPointer(input, key, {
      allowLegacy: name === 'legacy-candidate'
    })
    if (pointer) result.push({ name, key, ...pointer })
  }
  return result
}

function assertVersionAtGlobalFloor(version, pointers) {
  for (const pointer of pointers) {
    if (semver.gt(pointer.version, version)) {
      throw new Error(`Release version is below authoritative pointer ${pointer.name}.`)
    }
  }
}

async function requiredRemoteBytes(input, key, label) {
  const object = await readRemoteObject(input.oss, key, input.temporaryDirectory, label)
  if (!object) throw new Error(`${label} is missing.`)
  return object.bytes
}

async function verifyRecoveryInstaller(input, prefix, manifest, target) {
  const [platform, arch] = target.split('-')
  const kind = platform === 'darwin' ? 'dmg' : 'nsis'
  const installer = manifest?.artifacts?.find((artifact) =>
    artifact.platform === platform && artifact.arch === arch && artifact.kind === kind)
  if (
    !installer || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(installer.name) ||
    !Number.isSafeInteger(installer.size) || installer.size <= 0 ||
    !/^[A-Za-z0-9+/]{86}==$/u.test(installer.sha512)
  ) throw new Error('Recovery installer declaration is invalid.')
  const key = `${prefix}${installer.name}`
  const object = await readRemoteObject(
    input.oss,
    key,
    input.temporaryDirectory,
    'Recovery installer',
    { includeBytes: false }
  )
  if (
    !object || object.size !== installer.size || object.sha512 !== installer.sha512
  ) throw new Error('Recovery installer bytes are unavailable or invalid.')
  await input.verifyCdn(key, {
    size: installer.size,
    sha512: installer.sha512,
    requireRange: true
  })
}

async function legacyRecoveryReads(input, pointer, channel) {
  if (channel === 'candidate' && pointer.version !== '1.0.0-rc.19') {
    throw new Error('The recovery bridge must be exactly v1.0.0-rc.19.')
  }
  const prefix = `desktop/releases/v${pointer.version}/`
  const [manifestBytes, signatureBytes, publicKeyPem] = await Promise.all([
    requiredRemoteBytes(input, `${prefix}insight-update.json`, 'Legacy recovery Manifest'),
    requiredRemoteBytes(input, `${prefix}insight-update.json.sig`, 'Legacy recovery signature'),
    readFile(input.publicKeyPath, 'utf8')
  ])
  if (!verifySignature(null, manifestBytes, createPublicKey(publicKeyPem), signatureBytes)) {
    throw new Error('Legacy recovery Manifest signature is invalid.')
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const compatibility = manifest?.compatibility
  if (
    manifest?.schema !== 'insight-desktop-update/v1' ||
    manifest.version !== pointer.version || manifest.channel !== channel ||
    !Number.isSafeInteger(compatibility?.minimumReadableDataSchema) ||
    !Number.isSafeInteger(compatibility?.maximumReadableDataSchema) ||
    compatibility.minimumReadableDataSchema > compatibility.maximumReadableDataSchema
  ) throw new Error('Legacy recovery Manifest is invalid.')
  await verifyRecoveryInstaller(input, prefix, manifest, input.target)
  return {
    minimum: compatibility.minimumReadableDataSchema,
    maximum: compatibility.maximumReadableDataSchema
  }
}

async function recoveryReads(input, pointers) {
  const stable = pointers.find((pointer) => pointer.name === 'stable')
  if (stable) {
    const releasePrefix = `desktop/releases/v${stable.version}/`
    const [indexBytes, indexSignature, publicKeyPem] = await Promise.all([
      requiredRemoteBytes(input, `${releasePrefix}insight-release.json`, 'Stable Release Index'),
      requiredRemoteBytes(input, `${releasePrefix}insight-release.json.sig`, 'Stable Release Index signature'),
      readFile(input.publicKeyPath, 'utf8')
    ])
    const publicKey = createPublicKey(publicKeyPem)
    if (
      digest(indexBytes) !== stable.value.referencedSha512 ||
      !verifySignature(null, indexBytes, publicKey, indexSignature)
    ) throw new Error('Stable Release Index trust chain is invalid.')
    const index = parseV2ReleaseIndex(JSON.parse(indexBytes.toString('utf8')))
    if (index.version !== stable.version) throw new Error('Stable Release Index version is invalid.')
    const reference = index.targets.find(({ id }) => id === input.target)
    if (!reference) throw new Error('Stable Release Index is missing the Candidate target.')
    const targetPrefixValue = targetPrefix(stable.version, input.target)
    const [manifestBytes, manifestSignature] = await Promise.all([
      requiredRemoteBytes(input, `${targetPrefixValue}insight-target.json`, 'Stable Target Manifest'),
      requiredRemoteBytes(input, `${targetPrefixValue}insight-target.json.sig`, 'Stable Target signature')
    ])
    if (
      digest(manifestBytes) !== reference.manifestSha512 ||
      !verifySignature(null, manifestBytes, publicKey, manifestSignature)
    ) throw new Error('Stable Target Manifest trust chain is invalid.')
    const manifest = parseV2TargetManifest(JSON.parse(manifestBytes.toString('utf8')))
    if (
      manifest.version !== stable.version ||
      `${manifest.target.platform}-${manifest.target.arch}` !== input.target ||
      manifest.shellCommit !== index.shellCommit ||
      manifest.coreRuntime.tag !== index.coreRuntime.tag ||
      manifest.coreRuntime.commit !== index.coreRuntime.commit
    ) throw new Error('Stable Target Manifest identity is invalid.')
    await verifyRecoveryInstaller(input, targetPrefixValue, manifest, input.target)
    return manifest.compatibility.readsDataSchema
  }
  const bridge = pointers.find((pointer) => pointer.name === 'legacy-candidate')
  if (!bridge?.legacy) throw new Error('The validated rc.19 recovery bridge is unavailable.')
  return legacyRecoveryReads(input, bridge, 'candidate')
}

async function readReleasePolicy(path, version) {
  const policy = JSON.parse(await readFile(path, 'utf8'))
  if (
    policy?.schema !== 1 || policy.releaseVersion !== version ||
    !['optional', 'required'].includes(policy.mode) ||
    semver.valid(policy.minimumSupportedVersion) !== policy.minimumSupportedVersion
  ) throw new Error('Update release policy does not match the requested v2 release.')
  return policy
}

async function signedRollout(input, referencedBytes, track, policy, options = {}) {
  const privateKey = createPrivateKey(await readFile(input.privateKeyPath, 'utf8'))
  const payload = parseV2RolloutPayload({
    schema: UPDATE_V2_SCHEMAS.rollout,
    state: options.state ?? 'active',
    track,
    version: input.version,
    ...(track === 'candidate' ? { target: options.target ?? input.target } : {}),
    referencedSha512: sha512(referencedBytes),
    policy,
    publishedAt: options.publishedAt ?? input.now().toISOString()
  })
  const payloadBytes = canonicalJsonBytes(payload)
  return canonicalJsonBytes({
    schema: UPDATE_V2_SCHEMAS.envelope,
    payloadBase64: payloadBytes.toString('base64'),
    signatureBase64: sign(null, payloadBytes, privateKey).toString('base64')
  })
}

async function commitPointer(input, key, bytes, before) {
  const current = await readRemoteObject(input.oss, key, input.temporaryDirectory, 'Update pointer')
  const unchanged = before === undefined
    ? current === undefined
    : current !== undefined && current.bytes.equals(before)
  if (!unchanged) throw new Error(`Update pointer changed during publication: ${key}`)
  const source = join(input.temporaryDirectory, 'next-pointer.json')
  await writeFile(source, bytes, { mode: 0o600 })
  await input.oss.putObject(key, source, { 'cache-control': pointerCache })
  const committed = await readRemoteObject(input.oss, key, input.temporaryDirectory, 'Update pointer')
  if (!committed?.bytes.equals(bytes)) throw new Error(`Update pointer commit failed: ${key}`)
  await input.verifyCdn(key, byteIdentity(bytes))
}

export async function publishV2Candidate(input) {
  await assertVersionNotRejected(input)
  const target = await downloadVerifiedTarget(input, input.target)
  const pointers = await authoritativePointers(input)
  const verifiedRecoveryReads = await recoveryReads(input, pointers)
  assertVersionAtGlobalFloor(input.version, pointers)
  assertCandidateRecoveryCompatible({
    recoveryReads: verifiedRecoveryReads,
    candidateWrites: target.manifest.compatibility.writesDataSchema
  })
  const stableAtVersion = pointers.find((pointer) =>
    pointer.name === 'stable' && pointer.version === input.version)
  if (stableAtVersion) throw new Error('A Stable version cannot be republished as Candidate.')
  for (const pointer of pointers.filter((entry) =>
    UPDATE_V2_TARGET_IDS.includes(entry.name) &&
    entry.name !== input.target &&
    entry.version === input.version)) {
    const peer = await downloadVerifiedTarget(input, pointer.name)
    if (
      peer.manifest.shellCommit !== target.manifest.shellCommit ||
      JSON.stringify(peer.manifest.coreRuntime) !== JSON.stringify(target.manifest.coreRuntime) ||
      JSON.stringify(peer.manifest.compatibility) !== JSON.stringify(target.manifest.compatibility)
    ) throw new Error('Candidate targets for one version do not share one release identity.')
  }
  const key = pointerKey('candidate', input.target)
  const current = pointers.find((pointer) => pointer.key === key)
  const manifestDigest = digest(target.manifestBytes)
  if (current?.version === input.version) {
    if (
      current.legacy || current.value.state !== 'active' ||
      current.value.referencedSha512 !== manifestDigest
    ) {
      throw new Error('Candidate pointer already uses this version with different bytes.')
    }
    await input.verifyCdn(key, byteIdentity(current.bytes))
    return { pointerBefore: current.value, pointerAfter: current.value, alreadyPublished: true }
  }
  if (current && !semver.gt(input.version, current.version)) {
    throw new Error('Candidate pointer version must increase monotonically.')
  }
  const policy = await readReleasePolicy(input.policyPath, input.version)
  const bytes = await signedRollout(input, target.manifestBytes, 'candidate', {
    mode: 'optional',
    minimumSupportedVersion: policy.minimumSupportedVersion
  })
  await commitPointer(input, key, bytes, current?.bytes)
  return {
    pointerBefore: current?.value ?? null,
    pointerAfter: parseCanonicalV2Envelope(bytes).payload,
    alreadyPublished: false
  }
}

function parseAcceptance(bytes, version, target) {
  const value = JSON.parse(bytes.toString('utf8'))
  const keys = Object.keys(value).sort().join(',')
  if (
    keys !== 'acceptedAt,actor,manifestSha512,schema,target,version,workflowRun' ||
    value.schema !== 'insight-desktop-acceptance/v1' ||
    value.version !== version || value.target !== target ||
    !/^[A-Za-z0-9+/]{86}==$/u.test(value.manifestSha512) ||
    typeof value.actor !== 'string' || value.actor.length === 0 ||
    !/^\d+$/u.test(value.workflowRun) ||
    !Number.isFinite(Date.parse(value.acceptedAt))
  ) throw new Error(`Target acceptance record is invalid: ${target}`)
  return value
}

export async function acceptV2Target(input) {
  await assertVersionNotRejected(input)
  const target = await downloadVerifiedTarget(input, input.target)
  const key = pointerKey('candidate', input.target)
  const pointer = await readAuthenticatedPointer(input, key)
  const manifestDigest = digest(target.manifestBytes)
  if (
    !pointer || pointer.value.track !== 'candidate' || pointer.value.target !== input.target ||
    pointer.value.state !== 'active' || pointer.version !== input.version ||
    pointer.value.referencedSha512 !== manifestDigest
  ) throw new Error('Candidate pointer does not reference the target being accepted.')
  for (const object of target.objects) {
    const localName = object.key.slice(target.prefix.length)
    await input.verifyCdn(object.key, await fileDigest(join(target.directory, localName)))
  }
  await input.verifyCdn(key, byteIdentity(pointer.bytes))
  const record = canonicalJsonBytes({
    schema: 'insight-desktop-acceptance/v1',
    version: input.version,
    target: input.target,
    manifestSha512: manifestDigest,
    actor: input.actor,
    workflowRun: input.workflowRun,
    acceptedAt: input.now().toISOString()
  })
  const recordKey = acceptanceKey(input.version, input.target)
  const existing = await readSignedAuditRecord(input, recordKey, 'Acceptance record')
  if (existing) {
    const accepted = parseAcceptance(existing, input.version, input.target)
    if (accepted.manifestSha512 !== manifestDigest) {
      throw new Error('Existing acceptance record references another Target Manifest.')
    }
    return { acceptance: accepted, alreadyAccepted: true }
  }
  await putSignedAuditRecord(input, recordKey, record)
  return { acceptance: parseAcceptance(record, input.version, input.target), alreadyAccepted: false }
}

async function requireAcceptedTargets(input) {
  const targets = []
  for (const targetId of UPDATE_V2_TARGET_IDS) {
    const pointer = await readAuthenticatedPointer(input, pointerKey('candidate', targetId))
    if (
      !pointer || pointer.value.track !== 'candidate' || pointer.value.target !== targetId ||
      pointer.value.state !== 'active' || pointer.version !== input.version
    ) throw new Error(`Stable promotion requires Candidate target ${targetId}.`)
    const target = await downloadVerifiedTarget(input, targetId)
    const manifestDigest = digest(target.manifestBytes)
    if (pointer.value.referencedSha512 !== manifestDigest) {
      throw new Error(`Candidate pointer digest does not match: ${targetId}`)
    }
    const acceptanceBytes = await readSignedAuditRecord(
      input,
      acceptanceKey(input.version, targetId),
      'Acceptance record'
    )
    if (!acceptanceBytes) throw new Error(`Stable promotion requires acceptance: ${targetId}`)
    const acceptance = parseAcceptance(acceptanceBytes, input.version, targetId)
    if (acceptance.manifestSha512 !== manifestDigest) {
      throw new Error(`Acceptance digest does not match: ${targetId}`)
    }
    targets.push({ id: targetId, pointer, target, acceptance })
  }
  return targets
}

async function githubReleaseState(version) {
  const tag = `v${version}`
  const result = await run('gh', [
    'release', 'view', tag, '--repo', repository,
    '--json', 'tagName,isDraft,isPrerelease,name,assets'
  ])
  const value = JSON.parse(result.stdout)
  if (value.tagName !== tag) {
    throw new Error('GitHub Release identity is invalid for v2 promotion.')
  }
  return value
}

async function appendGithubIndex(version, releaseRoot, temporaryDirectory) {
  const tag = `v${version}`
  const files = ['insight-release.json', 'insight-release.json.sig']
  let state = await githubReleaseState(version)
  if (state.isPrerelease) throw new Error('Rejected GitHub Release cannot be modified.')
  for (const name of files) {
    const source = join(releaseRoot, name)
    const asset = state.assets?.find((entry) => entry.name === name)
    if (asset) {
      const downloadDirectory = join(temporaryDirectory, `github-${name}`)
      await mkdir(downloadDirectory, { recursive: true, mode: 0o700 })
      await run('gh', [
        'release', 'download', tag, '--repo', repository,
        '--dir', downloadDirectory, '--pattern', name
      ])
      const [local, remote] = await Promise.all([
        fileDigest(source),
        fileDigest(join(downloadDirectory, name))
      ])
      if (local.size !== remote.size || local.sha512 !== remote.sha512) {
        throw new Error(`GitHub Release Index asset conflicts: ${name}`)
      }
      continue
    }
    if (!state.isDraft) throw new Error(`Published GitHub Release is missing ${name}.`)
    await run('gh', ['release', 'upload', tag, source, '--repo', repository])
    state = await githubReleaseState(version)
  }
}

async function publishGithubRelease(version) {
  const state = await githubReleaseState(version)
  if (state.isPrerelease) throw new Error('Rejected GitHub Release cannot be published.')
  if (!state.isDraft) return false
  await run('gh', [
    'release', 'edit', `v${version}`, '--repo', repository,
    '--draft=false', '--prerelease=false', '--latest'
  ])
  return true
}

export async function promoteV2Stable(input) {
  await assertVersionNotRejected(input)
  const targets = await requireAcceptedTargets(input)
  const releaseRoot = join(input.temporaryDirectory, `release-v${input.version}`)
  await mkdir(join(releaseRoot, 'targets'), { recursive: true, mode: 0o700 })
  for (const entry of targets) {
    await rename(entry.target.directory, join(releaseRoot, 'targets', entry.id))
  }
  const index = await buildV2Index({
    releaseDir: releaseRoot,
    version: input.version,
    privateKeyPath: input.privateKeyPath
  })
  const indexBytes = await readFile(join(releaseRoot, 'insight-release.json'))
  const signatureBytes = await readFile(join(releaseRoot, 'insight-release.json.sig'))
  await putImmutableBytes(
    input.oss,
    `desktop/releases/v${input.version}/insight-release.json`,
    indexBytes,
    input.temporaryDirectory
  )
  await putImmutableBytes(
    input.oss,
    `desktop/releases/v${input.version}/insight-release.json.sig`,
    signatureBytes,
    input.temporaryDirectory
  )

  const key = pointerKey('stable')
  const current = await readAuthenticatedPointer(input, key)
  if (current?.version === input.version) {
    if (current.legacy || current.value.referencedSha512 !== digest(indexBytes)) {
      throw new Error('Stable pointer already uses this version with different bytes.')
    }
    await input.appendGithubIndex(input.version, releaseRoot, input.temporaryDirectory)
    const releaseState = input.githubReleaseState ?? githubReleaseState
    const state = await releaseState(input.version)
    if (state.isDraft || state.isPrerelease) {
      throw new Error('Stable pointer references a GitHub Draft; manual investigation is required.')
    }
    await input.verifyCdn(
      `desktop/releases/v${input.version}/insight-release.json`,
      byteIdentity(indexBytes)
    )
    await input.verifyCdn(
      `desktop/releases/v${input.version}/insight-release.json.sig`,
      byteIdentity(signatureBytes)
    )
    await input.verifyCdn(key, byteIdentity(current.bytes))
    return { index, pointerBefore: current.value, pointerAfter: current.value, alreadyPromoted: true }
  }
  if (current && !semver.gt(input.version, current.version)) {
    throw new Error('Stable pointer version must increase monotonically.')
  }
  const policy = await readReleasePolicy(input.policyPath, input.version)
  const pointerBytes = await signedRollout(input, indexBytes, 'stable', {
    mode: policy.mode,
    minimumSupportedVersion: policy.minimumSupportedVersion
  })
  await input.verifyCdn(
    `desktop/releases/v${input.version}/insight-release.json`,
    byteIdentity(indexBytes)
  )
  await input.verifyCdn(
    `desktop/releases/v${input.version}/insight-release.json.sig`,
    byteIdentity(signatureBytes)
  )
  await input.appendGithubIndex(input.version, releaseRoot, input.temporaryDirectory)
  const githubPublished = await input.publishGithubRelease(input.version)
  await commitPointer(input, key, pointerBytes, current?.bytes)
  return {
    index,
    githubPublished,
    pointerBefore: current?.value ?? null,
    pointerAfter: parseCanonicalV2Envelope(pointerBytes).payload,
    alreadyPromoted: false
  }
}

export async function rejectV2Version(input) {
  const releaseState = input.githubReleaseState ?? githubReleaseState
  const state = await releaseState(input.version)
  const stablePointer = await readAuthenticatedPointer(input, pointerKey('stable'))
  if (stablePointer?.version === input.version) {
    throw new Error('A version already published to Stable cannot be rejected.')
  }
  const key = rejectionKey(input.version)
  const existing = await readSignedAuditRecord(input, key, 'Rejection record')
  let rejectionBytes
  let rejection
  if (existing) {
    rejection = parseRejection(existing, input.version)
    if (rejection.reason !== input.reason) {
      throw new Error('Existing rejection record conflicts with this request.')
    }
    rejectionBytes = existing
  } else {
    rejectionBytes = canonicalJsonBytes({
      schema: 'insight-desktop-rejection/v1',
      version: input.version,
      actor: input.actor,
      workflowRun: input.workflowRun,
      reason: input.reason,
      rejectedAt: input.now().toISOString()
    })
    await putSignedAuditRecord(input, key, rejectionBytes)
    rejection = parseRejection(rejectionBytes, input.version)
  }
  for (const target of UPDATE_V2_TARGET_IDS) {
    const candidateKey = pointerKey('candidate', target)
    const pointer = await readAuthenticatedPointer(input, candidateKey)
    if (!pointer || pointer.version !== input.version) continue
    if (pointer.value.state === 'rejected') {
      if (pointer.value.referencedSha512 !== digest(rejectionBytes)) {
        throw new Error(`Rejected Candidate pointer conflicts: ${target}`)
      }
      await input.verifyCdn(candidateKey, byteIdentity(pointer.bytes))
      continue
    }
    const tombstone = await signedRollout(
      { ...input, target },
      rejectionBytes,
      'candidate',
      pointer.value.policy,
      {
        state: 'rejected',
        target,
        publishedAt: rejection.rejectedAt
      }
    )
    await commitPointer(input, candidateKey, tombstone, pointer.bytes)
  }
  const rejectGithubRelease = input.rejectGithubRelease ?? (async (version) => run('gh', [
    'release', 'edit', `v${version}`, '--repo', repository,
    '--title', `因赛AI v${version} [REJECTED]`,
    '--prerelease', '--latest=false'
  ]))
  await rejectGithubRelease(input.version)
  return { rejected: true, reason: input.reason }
}

async function downloadGithubTarget(version, target, temporaryDirectory) {
  const state = await githubReleaseState(version)
  if (!state.isDraft || state.isPrerelease) {
    throw new Error('Target staging requires a GitHub Draft Release.')
  }
  const downloadDirectory = join(temporaryDirectory, 'github-target')
  await mkdir(downloadDirectory, { recursive: true, mode: 0o700 })
  await run('gh', [
    'release', 'download', `v${version}`, '--repo', repository,
    '--dir', downloadDirectory, '--pattern', `${target}--*`
  ])
  const entries = await readdir(downloadDirectory, { withFileTypes: true })
  const prefix = `${target}--`
  if (entries.length === 0 || entries.some((entry) =>
    !entry.isFile() || !entry.name.startsWith(prefix))) {
    throw new Error('GitHub Draft target assets are incomplete or invalid.')
  }
  const targetDirectory = join(temporaryDirectory, 'target-assets')
  await mkdir(targetDirectory, { mode: 0o700 })
  for (const entry of entries) {
    const name = entry.name.slice(prefix.length)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(name)) {
      throw new Error('GitHub Draft target asset name is invalid.')
    }
    await rename(join(downloadDirectory, entry.name), join(targetDirectory, name))
  }
  return targetDirectory
}

async function writeReport(options, report) {
  const directory = join(resolve('.'), 'release-reports')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `v${options.version}-${options.command}${options.target ? `-${options.target}` : ''}.json`)
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return path
}

async function main() {
  const options = parseV2PublisherArguments(process.argv.slice(2))
  assertNoOssCredentialEnvironment(process.env)
  const releaseLock = await acquirePublisherLock()
  let temporaryDirectory
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'insight-desktop-v2-publish-'))
    const oss = createGithubOssClient()
    const common = {
      ...options,
      oss,
      temporaryDirectory,
      publicKeyPath: resolve('build/update-signing-public.pem'),
      privateKeyPath: process.env.UPDATE_SIGNING_PRIVATE_KEY,
      policyPath: resolve(process.env.UPDATE_RELEASE_POLICY_PATH ?? 'build/update-release-policy.json'),
      actor: process.env.GITHUB_ACTOR,
      workflowRun: process.env.GITHUB_RUN_ID,
      now: () => new Date(),
      verifyCdn: (key, expected) => verifyCdnBytes(key, expected),
      publishGithubRelease,
      appendGithubIndex,
      githubReleaseState
    }
    let result
    if (options.command === 'stage-target') {
      const targetDir = await downloadGithubTarget(options.version, options.target, temporaryDirectory)
      result = await stageV2Target({ ...common, targetDir })
    } else if (options.command === 'publish-candidate') {
      if (!common.privateKeyPath) throw new Error('Product update signing key is required.')
      result = await publishV2Candidate(common)
    } else if (options.command === 'accept-target') {
      if (!common.privateKeyPath) throw new Error('Product update signing key is required.')
      result = await acceptV2Target(common)
    } else if (options.command === 'promote-stable') {
      if (!common.privateKeyPath) throw new Error('Product update signing key is required.')
      result = await promoteV2Stable(common)
    } else {
      if (!common.privateKeyPath) throw new Error('Product update signing key is required.')
      result = await rejectV2Version(common)
    }
    const reportPath = await writeReport(options, {
      ok: true,
      action: options.command,
      version: options.version,
      target: options.target ?? null,
      ...result,
      completedAt: new Date().toISOString()
    })
    console.log(JSON.stringify({ ok: true, reportPath, action: options.command }, null, 2))
  } catch (error) {
    await writeReport(options, {
      ok: false,
      action: options.command,
      version: options.version,
      target: options.target ?? null,
      error: 'Publisher failed; inspect the redacted workflow error.',
      completedAt: new Date().toISOString()
    }).catch(() => undefined)
    throw error
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
    await releaseLock()
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
