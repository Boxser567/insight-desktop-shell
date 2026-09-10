const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'com.insight-aigc.desktop',
  productName: '因赛AI',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-candidate'
  },
  extraMetadata: {
    name: 'insight-desktop',
    productName: '因赛AI',
    insightDesktopAppId: 'com.insight-aigc.desktop',
    insightDesktopChannel: 'candidate'
  }
}
