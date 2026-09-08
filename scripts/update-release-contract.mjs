import semver from 'semver'

const safeAssetNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u

export function assertReleaseIdentity(channel, version) {
  if (channel !== 'candidate' && channel !== 'stable') {
    throw new Error('Release channel is invalid.')
  }
  if (semver.valid(version) !== version) {
    throw new Error('Release version must be valid semver.')
  }
  const validForChannel = channel === 'candidate'
    ? /^\d+\.\d+\.\d+-rc\.\d+$/u.test(version)
    : /^\d+\.\d+\.\d+$/u.test(version)
  if (!validForChannel) throw new Error('Release version does not match its channel.')
}

export function releaseChannelForVersion(version) {
  if (semver.valid(version) !== version) {
    throw new Error('Release version must be valid semver.')
  }
  const prerelease = semver.prerelease(version)
  const channel = prerelease === null ? 'stable' : 'candidate'
  assertReleaseIdentity(channel, version)
  return channel
}

export function artifactDefinitions(channel, version) {
  assertReleaseIdentity(channel, version)
  const prefix = `insight-${version}`
  const mac = (arch) => `${prefix}-mac-${arch}`
  const windows = `${prefix}-windows-x64-setup.exe`
  return [
    ['darwin', 'arm64', 'dmg', `${mac('arm64')}.dmg`],
    ['darwin', 'arm64', 'zip', `${mac('arm64')}.zip`],
    ['darwin', 'arm64', 'blockmap', `${mac('arm64')}.zip.blockmap`],
    ['darwin', 'arm64', 'updater-metadata', 'latest-mac.yml'],
    ['darwin', 'x64', 'dmg', `${mac('x64')}.dmg`],
    ['darwin', 'x64', 'zip', `${mac('x64')}.zip`],
    ['darwin', 'x64', 'blockmap', `${mac('x64')}.zip.blockmap`],
    ['darwin', 'x64', 'updater-metadata', 'latest-mac.yml'],
    ['win32', 'x64', 'nsis', windows],
    ['win32', 'x64', 'blockmap', `${windows}.blockmap`],
    ['win32', 'x64', 'updater-metadata', 'latest.yml']
  ]
}

export function macArchiveName(channel, version, arch) {
  if (arch !== 'arm64' && arch !== 'x64') throw new Error('macOS release architecture is invalid.')
  return artifactDefinitions(channel, version).find((entry) =>
    entry[0] === 'darwin' && entry[1] === arch && entry[2] === 'zip'
  )[3]
}

export function windowsInstallerName(channel, version) {
  return artifactDefinitions(channel, version).find((entry) => entry[2] === 'nsis')[3]
}

export function releaseAssetNames(channel, version) {
  return [...new Set([
    ...artifactDefinitions(channel, version).map((entry) => entry[3]),
    'insight-update.json',
    'insight-update.json.sig'
  ])].sort()
}

export function assertSafeAssetName(name) {
  if (!safeAssetNamePattern.test(name) || name === '.' || name === '..') {
    throw new Error(`Release asset name is invalid: ${name}`)
  }
  return name
}
