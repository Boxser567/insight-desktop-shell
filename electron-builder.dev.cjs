const packageJson = require('./package.json')

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
  artifactName: 'insight-dev-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'insight-dev-windows-${arch}-setup.${ext}'
  },
  publish: null
}
