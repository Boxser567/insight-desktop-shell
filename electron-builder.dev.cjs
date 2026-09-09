const packageJson = require('./package.json')
const { rename, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

async function configureMacosDevelopmentLauncher(context) {
  if (context.electronPlatformName !== 'darwin') return

  const executableName = context.packager.appInfo.productFilename
  const macosDirectory = join(
    context.appOutDir,
    `${executableName}.app`,
    'Contents',
    'MacOS'
  )
  const launcherPath = join(macosDirectory, executableName)
  const electronExecutableName = `${executableName} Electron`
  await rename(launcherPath, join(macosDirectory, electronExecutableName))
  await writeFile(
    launcherPath,
    `#!/bin/sh\nexec "$(dirname "$0")/${electronExecutableName}" --use-mock-keychain "$@"\n`,
    { mode: 0o755 }
  )
}

module.exports = {
  ...packageJson.build,
  appId: 'com.insight.desktop.dev',
  productName: '因赛AI Dev',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-dev'
  },
  extraMetadata: {
    name: 'insight-desktop-dev',
    productName: '因赛AI Dev',
    insightDesktopAppId: 'com.insight.desktop.dev',
    insightDesktopChannel: 'development'
  },
  mac: {
    ...packageJson.build.mac,
    identity: null
  },
  artifactName: 'insight-dev-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'insight-dev-windows-${arch}-setup.${ext}'
  },
  publish: null,
  afterPack: configureMacosDevelopmentLauncher
}
