import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import semver from 'semver'
import { z } from 'zod'
import { verifyReleaseManifest } from './release-manifest'
import type {
  SignedReleaseManifest,
  UpdateTarget
} from '../../shared/update-contracts'

const cachedPolicySchema = z.object({
  schema: z.literal(1),
  manifestBase64: z.string().min(1),
  signatureBase64: z.string().min(1)
}).strict()

interface RequiredPolicyInput {
  path: string
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
  publicKeyPem: string
  target: UpdateTarget
}

export interface ReadRequiredPolicyInput {
  path: string
  publicKeyPem: string
  target: UpdateTarget
  currentVersion: string
  warn?: (message: string, error: unknown) => void
}

export interface AuthenticatedRequiredPolicy {
  manifest: SignedReleaseManifest
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
}

export function requiredUpdatePolicyPath(userData: string): string {
  return join(userData, 'updates', 'required-policy.json')
}

export async function writeRequiredUpdatePolicy(input: RequiredPolicyInput): Promise<void> {
  const manifest = verifyReleaseManifest(input)
  if (manifest.policy.mode !== 'required') {
    throw new Error('只有强制更新才能写入强制策略缓存。')
  }
  await atomicWrite(input.path, `${JSON.stringify({
    schema: 1,
    manifestBase64: Buffer.from(input.manifestBytes).toString('base64'),
    signatureBase64: Buffer.from(input.signatureBytes).toString('base64')
  })}\n`)
}

export async function readRequiredUpdatePolicy(
  input: ReadRequiredPolicyInput
): Promise<AuthenticatedRequiredPolicy | undefined> {
  const warn = input.warn ?? defaultWarning
  let raw: string
  try {
    raw = await readFile(input.path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return undefined
    await discardInvalidPolicy(input.path, warn, error)
    return undefined
  }

  try {
    const cached = cachedPolicySchema.parse(JSON.parse(raw))
    const manifestBytes = decodeCanonicalBase64(cached.manifestBase64)
    const signatureBytes = decodeCanonicalBase64(cached.signatureBase64)
    const manifest = verifyReleaseManifest({
      manifestBytes,
      signatureBytes,
      publicKeyPem: input.publicKeyPem,
      target: input.target
    })
    if (manifest.policy.mode !== 'required') {
      throw new Error('缓存的更新策略不是强制更新。')
    }
    if (semver.valid(input.currentVersion) !== input.currentVersion) {
      throw new Error('当前客户端版本不是合法语义版本。')
    }
    if (semver.gte(input.currentVersion, manifest.policy.minimumSupportedVersion)) {
      await rm(input.path, { force: true })
      return undefined
    }
    return { manifest, manifestBytes, signatureBytes }
  } catch (error) {
    await discardInvalidPolicy(input.path, warn, error)
    return undefined
  }
}

async function discardInvalidPolicy(
  path: string,
  warn: (message: string, error: unknown) => void,
  error: unknown
): Promise<void> {
  warn('已忽略无效的强制更新策略缓存。', error)
  await rm(path, { force: true }).catch((removalError: unknown) => {
    warn('无法删除无效的强制更新策略缓存。', removalError)
  })
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('缓存字段不是合法 Base64。')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    throw new Error('缓存字段不是规范 Base64。')
  }
  return bytes
}

async function atomicWrite(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temporaryPath, value, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function defaultWarning(message: string, error: unknown): void {
  console.warn(`[desktop] ${message}`, error)
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
