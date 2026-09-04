const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'com.insight.desktop.candidate',
  productName: '因赛AI Candidate',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-candidate'
  },
  extraMetadata: {
    name: 'insight-desktop-candidate',
    productName: '因赛AI Candidate',
    insightDesktopAppId: 'com.insight.desktop.candidate',
    insightDesktopChannel: 'candidate'
  },
  artifactName: 'insight-candidate-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'insight-candidate-windows-${arch}-setup.${ext}'
  },
  publish: null
}
