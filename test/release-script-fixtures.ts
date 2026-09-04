import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stringify } from 'yaml'

export function createZipFixture(content = 'fixture'): Buffer {
  const name = Buffer.from('fixture.txt')
  const data = Buffer.from(content)
  const local = Buffer.alloc(30 + name.length + data.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)
  data.copy(local, 30 + name.length)

  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  name.copy(central, 46)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(local.length, 16)
  return Buffer.concat([local, central, eocd])
}

export function createPeFixture(machine = 0x8664): Buffer {
  const bytes = Buffer.alloc(128)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(0x40, 0x3c)
  bytes.write('PE\0\0', 0x40, 'binary')
  bytes.writeUInt16LE(machine, 0x44)
  return bytes
}

export function sha512(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('base64')
}

export async function writeReleaseFixture(
  root: string,
  version = '0.1.2',
  channel: 'candidate' | 'stable' = 'stable'
): Promise<{
  releaseDir: string
  runtimeManifest: string
  compatibility: string
  policy: string
  privateKey: string
  publicKey: string
}> {
  const releaseDir = path.join(root, 'release')
  const configDir = path.join(root, 'config')
  await Promise.all([
    mkdir(releaseDir, { recursive: true }),
    mkdir(configDir, { recursive: true })
  ])
  const prefix = channel === 'candidate' ? 'insight-candidate' : 'insight'
  const macArm64 = `${prefix}-mac-arm64`
  const macX64 = `${prefix}-mac-x64`
  const windows = channel === 'candidate'
    ? 'insight-candidate-windows-x64-setup.exe'
    : 'insight-windows-x64-setup.exe'
  const files = new Map<string, Buffer>([
    [`${macArm64}.dmg`, Buffer.from('arm64 dmg')],
    [`${macArm64}.zip`, createZipFixture('arm64')],
    [`${macArm64}.zip.blockmap`, Buffer.from('arm64 blockmap')],
    [`${macX64}.dmg`, Buffer.from('x64 dmg')],
    [`${macX64}.zip`, createZipFixture('x64')],
    [`${macX64}.zip.blockmap`, Buffer.from('x64 blockmap')],
    [windows, createPeFixture()],
    [`${windows}.blockmap`, Buffer.from('windows blockmap')]
  ])
  await Promise.all([...files].map(([name, bytes]) => writeFile(path.join(releaseDir, name), bytes)))

  const macFiles = [`${macArm64}.zip`, `${macX64}.zip`].map((name) => ({
    url: name,
    sha512: sha512(files.get(name)!),
    size: files.get(name)!.length
  }))
  const windowsFile = {
    url: windows,
    sha512: sha512(files.get(windows)!),
    size: files.get(windows)!.length
  }
  const primaryMacFile = macFiles[0]
  if (!primaryMacFile) throw new Error('macOS release fixture is incomplete.')
  await Promise.all([
    writeFile(path.join(releaseDir, 'latest-mac.yml'), stringify({
      version,
      files: macFiles,
      path: primaryMacFile.url,
      sha512: primaryMacFile.sha512,
      releaseDate: '2026-09-04T03:00:00.000Z'
    })),
    writeFile(path.join(releaseDir, 'latest.yml'), stringify({
      version,
      files: [windowsFile],
      path: windowsFile.url,
      sha512: windowsFile.sha512,
      releaseDate: '2026-09-04T03:00:00.000Z'
    }))
  ])

  const runtimeManifest = path.join(configDir, 'runtime-manifest.json')
  const compatibility = path.join(configDir, 'compatibility.json')
  const policy = path.join(configDir, 'policy.json')
  await Promise.all([
    writeFile(runtimeManifest, JSON.stringify({
      core: {
        releaseTag: 'insight-runtime-v0.1.1-rc.10',
        commit: 'b'.repeat(40)
      }
    })),
    writeFile(compatibility, JSON.stringify({
      profileSchema: 1,
      accountStorageSchema: 1,
      minimumReadableDataSchema: 1,
      maximumReadableDataSchema: 1
    })),
    writeFile(policy, JSON.stringify({
      schema: 1,
      releaseVersion: version,
      channel,
      mode: 'optional',
      minimumSupportedVersion: '0.1.1'
    }))
  ])

  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPath = path.join(root, 'update-private.pem')
  const publicKeyPath = path.join(root, 'update-public.pem')
  await Promise.all([
    writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 }),
    writeFile(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }))
  ])
  return {
    releaseDir,
    runtimeManifest,
    compatibility,
    policy,
    privateKey: privateKeyPath,
    publicKey: publicKeyPath
  }
}
