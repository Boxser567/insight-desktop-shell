import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

function section(workflow, name, next) {
  const pattern = next
    ? new RegExp(`  ${name}:\\r?\\n[\\s\\S]*?(?=\\r?\\n  ${next}:)`, 'u')
    : new RegExp(`  ${name}:\\r?\\n[\\s\\S]*$`, 'u')
  const value = pattern.exec(workflow)?.[0]
  if (!value) throw new Error(`Release workflow is missing job: ${name}`)
  return value
}

function requireText(value, text, label) {
  if (!value.includes(text)) throw new Error(`${label} is missing: ${text}`)
}

async function main() {
  const [workflowPath, packagePath, ...rest] = process.argv.slice(2)
  if (!workflowPath || !packagePath || rest.length > 0) {
    throw new Error('Usage: verify-release-workflow.mjs <workflow-yml> <package-json>')
  }
  const resolvedPackagePath = resolve(packagePath)
  const [workflow, packageJson, osxSignPatch] = await Promise.all([
    readFile(resolve(workflowPath), 'utf8'),
    readFile(resolvedPackagePath, 'utf8').then(JSON.parse),
    readFile(join(dirname(resolvedPackagePath), 'patches', '@electron+osx-sign+1.3.3.patch'), 'utf8')
  ])
  const preflight = section(workflow, 'release-preflight', 'macos-apple-silicon')
  const appleSilicon = section(workflow, 'macos-apple-silicon', 'macos-intel')
  const intel = section(workflow, 'macos-intel', 'windows-x64')
  const windows = section(workflow, 'windows-x64', 'macos-sonoma-compatibility')
  const sonomaCompatibility = section(workflow, 'macos-sonoma-compatibility', 'publish')
  const publish = section(workflow, 'publish')

  requireText(workflow, 'candidate_tag:', 'Release workflow')
  requireText(workflow, 'target:', 'Release workflow')
  for (const target of ['all', 'macos-arm64', 'macos-x64', 'windows-x64']) {
    requireText(workflow, `- ${target}`, 'Release workflow target choices')
  }
  requireText(workflow, 'cancel-in-progress: false', 'Release workflow concurrency')
  const permissions = /^permissions:\r?\n((?:  [^\r\n]+\r?\n?)*)/mu.exec(workflow)?.[1]?.trim()
  if (permissions !== 'contents: write') {
    throw new Error('Release workflow must grant only contents: write.')
  }
  requireText(preflight, 'verify-release-preflight.mjs', 'Release preflight')
  requireText(
    preflight,
    '--service-environment build/client-service-environment.json',
    'Release preflight client service environment'
  )
  requireText(preflight, 'verify-release-workflow.mjs', 'Release preflight')
  requireText(preflight, 'node --check scripts/verify-macos-distribution.mjs', 'Release preflight')
  if (/npm ci|vitest|rollup|esbuild/u.test(preflight)) {
    throw new Error('Release preflight must not install dependencies or load native build tools.')
  }
  for (const [name, job] of [
    ['macos-apple-silicon', appleSilicon],
    ['macos-intel', intel],
    ['windows-x64', windows]
  ]) {
    requireText(job, 'needs: release-preflight', name)
    requireText(job, '- name: Test prepared Runtime', name)
    requireText(job, 'run: npm test', name)
    if (job.indexOf('- name: Test prepared Runtime') < job.lastIndexOf('npm run package:')) {
      throw new Error(`${name} must test after packaging prepares the locked Runtime.`)
    }
  }
  requireText(appleSilicon, "inputs.target == 'macos-arm64'", 'macos-apple-silicon')
  requireText(intel, "inputs.target == 'macos-x64'", 'macos-intel')
  requireText(windows, "inputs.target == 'windows-x64'", 'windows-x64')
  for (const [name, job] of [
    ['macos-apple-silicon', appleSilicon],
    ['macos-intel', intel]
  ]) {
    requireText(job, 'APPLE_TEAM_ID: ${{ secrets.DESKTOP_APPLE_TEAM_ID }}', name)
    requireText(job, 'CSC_NAME: ${{ steps.signing_keychain.outputs.identity }}', name)
    requireText(job, 'ulimit -n 65536', name)
    requireText(job, 'Record macOS build environment', name)
    requireText(job, 'sw_vers', name)
    requireText(job, 'xcodebuild -version', name)
    requireText(job, 'xcrun --find codesign_allocate', name)
    requireText(job, "Print :CFBundleIdentifier", `${name} production macOS Bundle ID`)
    requireText(
      job,
      "test \"$bundle_id\" = 'com.insight-aigc.desktop'",
      `${name} production macOS Bundle ID`
    )
    requireText(job, "Print :CFBundleName", `${name} production macOS bundle name`)
    requireText(job, "test \"$bundle_name\" = '因赛AI'", `${name} production macOS bundle name`)
    requireText(job, 'TeamIdentifier=', `${name} production macOS signing Team ID`)
    requireText(
      job,
      'test "$team_id" = "$APPLE_TEAM_ID"',
      `${name} production macOS signing Team ID`
    )
    requireText(job, 'node scripts/verify-macos-distribution.mjs "$RELEASE_APP"', name)
    if (job.includes('spctl --assess --type execute')) {
      throw new Error(`${name} must use syspolicy_check for the application bundle.`)
    }
  }
  requireText(windows, "$PSNativeCommandUseErrorActionPreference = $true", 'windows-x64')
  requireText(windows, '$appExecutable', 'windows-x64')
  requireText(
    windows,
    'finalize-windows-release.mjs $releaseDir $env:RELEASE_VERSION $appExecutable',
    'windows-x64'
  )
  requireText(sonomaCompatibility, '- release-preflight', 'macos-sonoma-compatibility')
  requireText(sonomaCompatibility, '- macos-apple-silicon', 'macos-sonoma-compatibility')
  requireText(sonomaCompatibility, "inputs.target == 'macos-arm64'", 'macos-sonoma-compatibility')
  requireText(sonomaCompatibility, 'runs-on: macos-14', 'macos-sonoma-compatibility')
  requireText(sonomaCompatibility, 'actions/checkout@v4', 'macos-sonoma-compatibility')
  requireText(sonomaCompatibility, 'persist-credentials: false', 'macos-sonoma-compatibility')
  requireText(sonomaCompatibility, 'name: macos-apple-silicon', 'macos-sonoma-compatibility')
  requireText(
    sonomaCompatibility,
    'hdiutil attach "release-assets/insight-$RELEASE_VERSION-mac-arm64.dmg"',
    'macos-sonoma-compatibility'
  )
  requireText(
    sonomaCompatibility,
    'codesign --verify --deep --strict --verbose=4 "$app_path"',
    'macos-sonoma-compatibility'
  )
  requireText(
    sonomaCompatibility,
    'node scripts/verify-macos-distribution.mjs "$app_path"',
    'macos-sonoma-compatibility'
  )
  requireText(sonomaCompatibility, 'xcrun stapler validate "$app_path"', 'macos-sonoma-compatibility')
  requireText(sonomaCompatibility, 'if: always()', 'macos-sonoma-compatibility')
  requireText(sonomaCompatibility, 'mount_path="$RUNNER_TEMP/insight-dmg"', 'macos-sonoma-compatibility')
  requireText(sonomaCompatibility, 'hdiutil detach "$RUNNER_TEMP/insight-dmg" || true', 'macos-sonoma-compatibility')
  if (workflow.includes('${{ runner.temp }}')) {
    throw new Error('Workflow dispatch cannot resolve runner.temp from job-level configuration.')
  }
  requireText(publish, 'environment: desktop-release', 'Publish job')
  requireText(publish, "inputs.target == 'all'", 'Publish job')
  requireText(publish, "inputs.target == 'macos-arm64'", 'Publish job')
  for (const dependency of [
    '- release-preflight',
    '- macos-apple-silicon',
    '- macos-intel',
    '- windows-x64',
    '- macos-sonoma-compatibility'
  ]) {
    requireText(publish, dependency, 'Publish job')
  }
  requireText(
    publish,
    "needs.macos-sonoma-compatibility.result == 'success'",
    'Publish job'
  )
  requireText(publish, 'secrets.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY', 'Publish job')
  requireText(publish, '--scope "$RELEASE_SCOPE"', 'Publish job')
  if (workflow.slice(0, workflow.indexOf('\n  publish:')).includes('DESKTOP_UPDATE_SIGNING_PRIVATE_KEY')) {
    throw new Error('The update signing private key may only be used by the publish job.')
  }
  for (const forbidden of [
    'windows_prerelease_tag',
    'sign-windows',
    'DESKTOP_WINDOWS_SIGNING_PIN',
    'dshdesktop.com',
    'FEISHU_RELEASE_WEBHOOK',
    '--clobber',
    '--draft=false',
    'id-token: write',
    'OSS_ACCESS_KEY',
    'insight-desktop-updates',
    'desktop-updates-publisher',
    'ossutil '
  ]) {
    if (workflow.includes(forbidden)) throw new Error(`Release workflow contains ${forbidden}.`)
  }
  requireText(publish, 'create_args=(--draft', 'Publish job')

  const scripts = packageJson.scripts ?? {}
  if (scripts.postinstall !== 'install-electron --no && patch-package') {
    throw new Error('Postinstall must apply locked dependency patches after installing Electron.')
  }
  if (!osxSignPatch.includes('-        return await Promise.all(children.map(async (child) => {') ||
      !osxSignPatch.includes('+        for (const child of children) {')) {
    throw new Error('The osx-sign patch must serialize binary file inspection.')
  }
  for (const [name, expected] of Object.entries({
    'package:candidate:mac:arm64': {
      builder: 'electron-builder --mac dmg zip --arm64',
      finalize: 'finalize-mac-release.mjs dist-candidate candidate $npm_package_version arm64'
    },
    'package:candidate:mac:x64': {
      builder: 'electron-builder --mac dmg zip --x64',
      finalize: 'finalize-mac-release.mjs dist-candidate candidate $npm_package_version x64'
    },
    'package:mac:arm64': {
      builder: 'electron-builder --mac dmg zip --arm64',
      finalize: 'finalize-mac-release.mjs dist stable $npm_package_version arm64'
    },
    'package:mac:x64': {
      builder: 'electron-builder --mac dmg zip --x64',
      finalize: 'finalize-mac-release.mjs dist stable $npm_package_version x64'
    }
  })) {
    const command = scripts[name]
    if (typeof command !== 'string' || !command.includes(expected.finalize)) {
      throw new Error(`Package script ${name} does not finalize macOS update metadata.`)
    }
    if (!command.includes(expected.builder) || command.match(/(?:^|&& )electron-builder --/gu)?.length !== 1) {
      throw new Error(`Package script ${name} must build DMG and ZIP in one electron-builder invocation.`)
    }
  }
  if (packageJson.build?.artifactName !== 'insight-${version}-${os}-${arch}.${ext}' ||
      packageJson.build?.nsis?.artifactName !== 'insight-${version}-windows-${arch}-setup.${ext}') {
    throw new Error('Stable release asset names must include the release version.')
  }
  console.log('Release workflow contract is valid.')
}

await main()
