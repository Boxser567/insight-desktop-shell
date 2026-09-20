const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'com.insight-aigc.desktop.rc12.local',
  productName: '因赛AI RC12',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-rc12-local'
  },
  extraMetadata: {
    name: 'insight-desktop-rc12-local',
    productName: '因赛AI RC12',
    insightDesktopAppId: 'com.insight-aigc.desktop.rc12.local',
    insightDesktopChannel: 'development',
    insightDesktopUserDataDirectory: 'insight-desktop-rc12-local'
  },
  mac: {
    ...packageJson.build.mac,
    identity: null
  },
  artifactName: 'insight-rc12-local-${os}-${arch}.${ext}',
  publish: null
}
