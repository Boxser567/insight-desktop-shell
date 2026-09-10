import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const projectRoot = path.resolve(import.meta.dirname, '..')

const releaseAssets = [
  'insight-mac-arm64.dmg',
  'insight-mac-x64.dmg',
  'insight-windows-x64-setup.exe'
]

describe('GitHub release contract', () => {
  it('keeps the approved bundle identities aligned with packaged metadata', () => {
    const require = createRequire(import.meta.url)
    const stable = require('../package.json').build
    const candidate = require('../electron-builder.candidate.cjs')
    const development = require('../electron-builder.dev.cjs')
    for (const [config, appId, productName, channel] of [
      [stable, 'com.insight-aigc.desktop', '因赛AI', 'stable'],
      [candidate, 'com.insight-aigc.desktop', '因赛AI', 'candidate'],
      [development, 'com.insight-aigc.desktop.dev', '因赛AI Dev', 'development']
    ] as const) {
      expect(config.appId).toBe(appId)
      expect(config.extraMetadata.insightDesktopAppId).toBe(appId)
      expect(config.extraMetadata.insightDesktopChannel).toBe(channel)
      expect(config.productName).toBe(productName)
    }
    expect(development.mac.identity).toBeNull()
    expect(candidate.mac).toEqual(stable.mac)
  })

  it('generates update signing keys outside the repository with a private mode', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'insight-update-keys-'))
    try {
      const privateKey = path.join(directory, 'private.pem')
      const publicKey = path.join(directory, 'public.pem')
      const script = path.join(projectRoot, 'scripts', 'generate-update-signing-keypair.mjs')
      const generated = spawnSync(process.execPath, [
        script,
        '--private-key', privateKey,
        '--public-key', publicKey
      ], { encoding: 'utf8' })
      expect(generated.status, generated.stderr).toBe(0)
      if (process.platform !== 'win32') {
        expect((await stat(privateKey)).mode & 0o777).toBe(0o600)
      }
      expect(await readFile(publicKey, 'utf8')).toContain('BEGIN PUBLIC KEY')

      const rejected = spawnSync(process.execPath, [
        script,
        '--private-key', path.join(projectRoot, 'build', 'forbidden-private.pem'),
        '--public-key', path.join(directory, 'unused-public.pem')
      ], { encoding: 'utf8' })
      expect(rejected.status).not.toBe(0)
      expect(rejected.stderr).toContain('outside the repository')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('uses the Insight repository identity without inheriting the reference upstream author', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as {
      author?: string
      repository?: { url?: string }
      bugs?: { url?: string }
      homepage?: string
    }

    expect(packageJson.repository?.url).toBe(
      'git+https://github.com/Boxser567/insight-desktop-shell.git'
    )
    expect(packageJson.bugs?.url).toBe(
      'https://github.com/Boxser567/insight-desktop-shell/issues'
    )
    expect(packageJson.homepage).toBe(
      'https://github.com/Boxser567/insight-desktop-shell#readme'
    )
    expect(packageJson.author).toBeUndefined()
  })

  it('keeps the package and lockfile versions aligned', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { version: string }
    const packageLock = JSON.parse(
      await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8')
    ) as { version: string; packages: Record<string, { version?: string }> }

    expect(packageLock.version).toBe(packageJson.version)
    expect(packageLock.packages['']?.version).toBe(packageJson.version)
  })

  it('locks the platform Rollup binaries used by release runners', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { optionalDependencies?: Record<string, string> }
    const packageLock = JSON.parse(
      await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8')
    ) as { packages: Record<string, { version?: string }> }

    expect(packageJson.optionalDependencies?.['@rollup/rollup-darwin-x64']).toBe('4.62.4')
    expect(packageJson.optionalDependencies?.['@rollup/rollup-win32-x64-msvc']).toBe('4.62.4')
    expect(packageLock.packages['node_modules/@rollup/rollup-darwin-x64']?.version).toBe('4.62.4')
    expect(packageLock.packages['node_modules/@rollup/rollup-win32-x64-msvc']?.version).toBe('4.62.4')
  })

  it('does not reinstall the Core Runtime from the npm registry', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> }

    expect(Object.keys(packageJson.dependencies).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))).toEqual([])
    expect(packageJson.dependencies.node).toBeUndefined()
    expect(packageJson.dependencies.pnpm).toBeUndefined()
  })

  it('uses stable platform-specific artifact names', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as {
      build: {
        artifactName: string
        extraMetadata: { insightDesktopAppId: string; insightDesktopChannel: string }
        extraResources: Array<{ from: string; to: string }>
        win: { target: Array<{ target: string; arch: string[] }> }
        nsis: { artifactName: string; include: string }
        portable?: unknown
      }
    }

    expect(packageJson.build.artifactName).toBe('insight-${version}-${os}-${arch}.${ext}')
    expect(packageJson.build.extraMetadata.insightDesktopAppId).toBe('com.insight-aigc.desktop')
    expect(packageJson.build.extraMetadata.insightDesktopChannel).toBe('stable')
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/app-icon.png',
      to: 'icon.png'
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/splash.html',
      to: 'splash.html'
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/brand-wordmark.svg',
      to: 'brand-wordmark.svg'
    })
    expect(packageJson.build.extraResources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: expect.stringContaining('dsh-loader') }),
        expect.objectContaining({ from: 'build/insight-logo.svg' })
      ])
    )
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/dsh-desktop.patch.yml',
      to: 'dsh-desktop.patch.yml'
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/runtime-manifest.json',
      to: 'runtime-manifest.json'
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/update-signing-public.pem',
      to: 'update-signing-public.pem'
    })
    expect(JSON.stringify(packageJson.build.extraResources)).not.toMatch(/private.*key|private.*pem/i)
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/core-runtime',
      to: 'runtime'
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/core-runtime/node_modules',
      to: 'runtime/node_modules'
    })
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/bundled-profile',
      to: 'bundled-profile',
      filter: ['**/*', '!**/.DS_Store', '!**/__MACOSX/**']
    })
    expect(packageJson.build.nsis.artifactName).toBe(
      'insight-${version}-windows-${arch}-setup.${ext}'
    )
    expect(packageJson.build.nsis.include).toBe('build/installer.nsh')
    expect(packageJson.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(packageJson.build.portable).toBeUndefined()
  })

  it('turns a selected Windows drive root into an application directory', async () => {
    const installer = await readFile(
      path.join(projectRoot, 'build', 'installer.nsh'),
      'utf8'
    )

    expect(installer).toContain('!define MUI_PAGE_CUSTOMFUNCTION_SHOW DshDirectoryPageShow')
    expect(installer).toContain('${NSD_OnChange} $DshDirectoryEdit DshDirectoryChanged')
    expect(installer).toContain('StrCpy $3 "$0\\${APP_FILENAME}"')
    expect(installer).toContain('StrCpy $3 "$0${APP_FILENAME}"')
    expect(installer).toContain('${NSD_SetText} $DshDirectoryEdit $3')
  })

  it('loads the Shell first and isolates the authenticated Harness surface', async () => {
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')
    const vite = await readFile(path.join(projectRoot, 'electron.vite.config.ts'), 'utf8')
    const patch = await readFile(
      path.join(projectRoot, 'build', 'dsh-desktop.patch.yml'),
      'utf8'
    )

    expect(main).toContain("preload: join(import.meta.dirname, '../preload/shell.cjs')")
    expect(main).toContain("preload: join(import.meta.dirname, '../preload/harness.cjs')")
    expect(main).toContain('partition: `persist:insight-harness-${scope}`')
    expect(main).toContain('await loadShell(window)')
    expect(main).toContain('await authManager.restore()')
    expect(main).toContain('applyWorkspaceForCurrentSession()')
    expect(main).toContain('authManager.subscribe(() => {')
    expect(vite).toContain("harness: resolve('src/preload/harness.ts')")
    expect(vite).toContain("shell: resolve('src/preload/shell.ts')")
    expect(main).toContain("initializeBundledProfile(desktopResourcePath('bundled-profile'), dshHome)")
    expect(main).toContain("readRuntimeManifest(desktopResourcePath('runtime-manifest.json'))")
    expect(main).toContain('nativeTheme.themeSource = harnessThemePreference()')
    expect(patch).not.toMatch(/id:\s*directory-picker/)
    expect(patch).not.toContain("name: '@deepseek-ai/dsh-host-directory-picker-native'")
    expect(patch).not.toContain("name: '@deepseek-ai/dsh-client-ui-directory-picker-native'")
  })

  it('keeps trusted local plugin import alongside the bundled marketplace', async () => {
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')
    const profile = await readFile(
      path.join(projectRoot, 'scripts', 'prepare-bundled-profile.mjs'),
      'utf8'
    )

    expect(main).toContain("label: isChinese ? '导入本地插件…' : 'Import Local Plugin…'")
    expect(main).toContain('resolveLocalPluginImport(selectedPath)')
    expect(main).toContain('addProfilePluginWithDsh(')
    expect(profile).toContain("const MARKET_PACKAGE = 'dshmarket'")
    expect(profile).toContain("const MARKET_VERSION = '1.44.0'")
    expect(profile).toContain("bundled-community-plugins.json")
    expect(profile).toContain("file:.insight-bundled-plugins/")
    expect(profile).not.toContain("packageName: 'dsh-at-file'")
  })

  it('routes manual restarts through the active plugin recovery flow', async () => {
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')

    expect(main).toContain("if (failureRecoveryVisible) resolvePluginRecoveryAction('restart')")
    expect(main).toMatch(/case 'restart-harness':\s+await restartHarness\(\)/)
    expect(main).toContain('click: () => void restartHarness().catch(showUnexpectedError)')
    expect(main).toContain("} else if (action === 'restart') {")
  })

  it('replays frontend plugin failures that arrive during an active recovery', async () => {
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')

    expect(main).toContain("resolvePluginRecoveryAction('refresh')")
    expect(main).toContain('if (applyPendingFrontendEvidence()) continue')
    expect(main).toMatch(
      /if \(failureRecoveryVisible\) \{\s+queuePendingFrontendPluginRecovery\(message\)/
    )
    expect(main).toContain('queueMicrotask(() => {')
    expect(main).toContain('logs: [...rendererPluginFailureLogs]')
  })

  it('packages OSS updater bootstrap metadata without allowing package commands to publish', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
      build: {
        publish?: Array<{ provider: string; url: string }>
        detectUpdateChannel?: boolean
        extraResources: Array<{ from: string; to: string }>
        win: { verifyUpdateCodeSignature: boolean }
      }
    }
    expect(packageJson.dependencies['electron-updater']).toBe('^6.8.9')
    expect(packageJson.build.publish).toEqual([{
      provider: 'generic',
      url: 'https://updates.insight-aigc.com/desktop/'
    }])
    expect(packageJson.build.detectUpdateChannel).toBe(false)
    expect(packageJson.build.extraResources).toEqual(expect.arrayContaining([
      { from: 'build/update-signing-public.pem', to: 'update-signing-public.pem' },
      { from: 'build/update-distribution.json', to: 'update-distribution.json' }
    ]))
    const distribution = JSON.parse(
      await readFile(path.join(projectRoot, 'build', 'update-distribution.json'), 'utf8')
    )
    expect(distribution).toEqual({
      schema: 1,
      updateOrigin: 'https://updates.insight-aigc.com'
    })
    expect(JSON.stringify(distribution)).not.toMatch(/bucket|access.?key|secret|github|downloadPage/iu)
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      if (name.startsWith('package:')) expect(command).toContain('--publish never')
    }
    expect(packageJson.build.win.verifyUpdateCodeSignature).toBe(false)
  })

  it('generates the runtime manifest before development and production builds', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts['prepare:runtime-manifest']).toBe(
      'node scripts/prepare-runtime-manifest.mjs'
    )
    expect(packageJson.scripts['prepare:core-runtime']).toBe(
      'node scripts/prepare-core-runtime.mjs'
    )
    expect(packageJson.scripts.dev).toContain('prepare:core-runtime')
    expect(packageJson.scripts.build).toContain('prepare:core-runtime')
    expect(packageJson.scripts.dev).toContain('prepare:runtime-manifest')
    expect(packageJson.scripts.build).toContain('build:prepared')
    expect(packageJson.scripts['build:prepared']).toContain('prepare:runtime-manifest')
  })

  it('keeps builder jobs from attempting implicit tag publishing', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> }

    for (const script of [
      'package:mac',
      'package:mac:arm64',
      'package:mac:x64',
      'package:win',
      'package:dev:mac:arm64',
      'package:dev:mac:x64',
      'package:dev:win',
      'package:candidate:dir',
      'package:candidate:mac:arm64',
      'package:candidate:mac:x64',
      'package:candidate:win'
    ]) {
      expect(packageJson.scripts[script]).toContain('--publish never')
    }
  })

  it('packages an isolated development channel from the current workspace', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> }
    const developmentConfig = await readFile(
      path.join(projectRoot, 'electron-builder.dev.cjs'),
      'utf8'
    )
    const candidateConfig = await readFile(
      path.join(projectRoot, 'electron-builder.candidate.cjs'),
      'utf8'
    )
    const osxSignPatch = await readFile(
      path.join(projectRoot, 'patches', '@electron+osx-sign+1.3.3.patch'),
      'utf8'
    )
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')

    expect(packageJson.scripts.postinstall).toBe('install-electron --no && patch-package')
    expect(osxSignPatch).toContain('-        return await Promise.all(children.map(async (child) => {')
    expect(osxSignPatch).toContain('+        for (const child of children) {')
    expect(packageJson.scripts['package:dev:dir']).toContain('npm run build')
    expect(packageJson.scripts['package:dev:dir']).toContain('electron-builder.dev.cjs')
    expect(packageJson.scripts['package:dev:mac:arm64']).toContain('verify-target.mjs darwin arm64')
    expect(packageJson.scripts['package:dev:mac:arm64']).toContain('electron-builder.dev.cjs')
    expect(packageJson.scripts['package:dev:mac:x64']).toContain('verify-target.mjs darwin x64')
    expect(packageJson.scripts['package:dev:mac:x64']).toContain('electron-builder.dev.cjs')
    expect(packageJson.scripts['package:dev:mac:arm64']).toContain('electron-builder --mac dmg zip --arm64')
    expect(packageJson.scripts['package:dev:mac:x64']).toContain('electron-builder --mac dmg zip --x64')
    expect(packageJson.scripts['package:mac:arm64']).toContain('electron-builder --mac dmg zip --arm64')
    expect(packageJson.scripts['package:mac:x64']).toContain('electron-builder --mac dmg zip --x64')
    for (const name of [
      'package:dev:mac:arm64',
      'package:dev:mac:x64',
      'package:candidate:mac:arm64',
      'package:candidate:mac:x64',
      'package:mac:arm64',
      'package:mac:x64'
    ]) {
      const command = packageJson.scripts[name]
      expect(command).toBeDefined()
      expect(command?.match(/(?:^|&& )electron-builder --/g)).toHaveLength(1)
    }
    expect(packageJson.scripts['package:dev:win']).toContain('verify-target.mjs win32 x64')
    expect(packageJson.scripts['package:dev:win']).toContain('electron-builder.dev.cjs')
    expect(packageJson.scripts['package:dev:win']).toContain('--publish never')
    expect(developmentConfig).toContain("appId: 'com.insight-aigc.desktop.dev'")
    expect(developmentConfig).toContain("productName: '因赛AI Dev'")
    expect(developmentConfig).toContain("output: 'dist-dev'")
    expect(developmentConfig).toContain("insightDesktopAppId: 'com.insight-aigc.desktop.dev'")
    expect(developmentConfig).toContain("insightDesktopChannel: 'development'")
    expect(developmentConfig).toContain('identity: null')
    expect(developmentConfig).toContain('--use-mock-keychain')
    expect(developmentConfig).toContain('afterPack: configureMacosDevelopmentLauncher')
    expect(developmentConfig).toContain(
      "artifactName: 'insight-dev-${os}-${arch}.${ext}'"
    )
    expect(developmentConfig).toContain(
      "artifactName: 'insight-dev-windows-${arch}-setup.${ext}'"
    )
    expect(main).toContain("app.setPath('userData', join(app.getPath('appData'), 'insight-desktop-dev'))")
    expect(main).toContain("app.setPath('userData', join(app.getPath('appData'), 'insight-desktop'))")
    expect(main).not.toContain('insight-desktop-candidate')
    expect(main).toContain('const desktopChannel = applicationChannel()')
    expect(main).toContain("app.commandLine.appendSwitch('use-mock-keychain')")
    expect(main).toContain('persistCredentials: false')
    expect(candidateConfig).toContain("appId: 'com.insight-aigc.desktop'")
    expect(candidateConfig).toContain("productName: '因赛AI'")
    expect(candidateConfig).toContain("output: 'dist-candidate'")
    expect(candidateConfig).toContain("name: 'insight-desktop'")
    expect(candidateConfig).toContain("insightDesktopAppId: 'com.insight-aigc.desktop'")
    expect(candidateConfig).toContain("insightDesktopChannel: 'candidate'")
    expect(candidateConfig).not.toContain('因赛AI Candidate')
    expect(candidateConfig).not.toContain('com.insight.desktop.candidate')
    expect(candidateConfig).not.toContain('com.insight-aigc.desktop.candidate')
    expect(candidateConfig).not.toContain('insight-candidate')
    expect(candidateConfig).not.toContain('publish: null')
    for (const name of [
      'package:candidate:dir',
      'package:candidate:mac:arm64',
      'package:candidate:mac:x64',
      'package:candidate:win'
    ]) {
      expect(packageJson.scripts[name]).toContain('electron-builder.candidate.cjs')
      expect(packageJson.scripts[name]).toContain('--publish never')
    }
    expect(packageJson.scripts['package:candidate:mac:arm64']).toContain(
      'finalize-mac-release.mjs dist-candidate candidate $npm_package_version arm64'
    )
    expect(packageJson.scripts['package:candidate:mac:x64']).toContain(
      'finalize-mac-release.mjs dist-candidate candidate $npm_package_version x64'
    )
    expect(packageJson.scripts['package:mac:arm64']).toContain(
      'finalize-mac-release.mjs dist stable $npm_package_version arm64'
    )
    expect(packageJson.scripts['package:mac:x64']).toContain(
      'finalize-mac-release.mjs dist stable $npm_package_version x64'
    )
  })

  it('preflights one complete release before starting native builds', async () => {
    const workflow = await readFile(
      path.join(projectRoot, '.github', 'workflows', 'release.yml'),
      'utf8'
    )
    const document = parseDocument(workflow)
    const preflight = workflow.match(
      /  release-preflight:\r?\n[\s\S]*?(?=\r?\n  macos-apple-silicon:)/
    )?.[0]
    const appleSilicon = workflow.match(
      /  macos-apple-silicon:\r?\n[\s\S]*?(?=\r?\n  macos-intel:)/
    )?.[0]
    const intel = workflow.match(
      /  macos-intel:\r?\n[\s\S]*?(?=\r?\n  windows-x64:)/
    )?.[0]
    const windows = workflow.match(
      /  windows-x64:\r?\n[\s\S]*?(?=\r?\n  macos-sonoma-compatibility:)/
    )?.[0]
    const sonomaCompatibility = workflow.match(
      /  macos-sonoma-compatibility:\r?\n[\s\S]*?(?=\r?\n  publish:)/
    )?.[0]

    expect(document.errors).toEqual([])
    expect(workflow).toContain('candidate_tag:')
    expect(workflow).toContain('target:')
    for (const target of ['all', 'macos-arm64', 'macos-x64', 'windows-x64']) {
      expect(workflow).toContain(`- ${target}`)
    }
    expect(workflow).not.toContain('windows_prerelease_tag:')
    expect(preflight).toContain('runs-on: ubuntu-24.04')
    expect(preflight).toContain('verify-release-preflight.mjs')
    expect(preflight).toContain('CANDIDATE_TAG: ${{ inputs.candidate_tag }}')
    expect(preflight).toContain('refs/tags/$release_tag')
    expect(preflight).not.toContain("release_tag='${{ inputs.candidate_tag }}'")
    expect(preflight).toContain('--package package.json')
    expect(preflight).toContain('--policy build/update-release-policy.json')
    expect(preflight).toContain('--runtime-lock core-runtime.lock.json')
    expect(preflight).toContain('--service-environment build/client-service-environment.json')
    expect(preflight).toContain('Run dependency-free release checks')
    expect(preflight).toContain('verify-release-workflow.mjs')
    expect(preflight).toContain('verify-publish-workflow.mjs')
    expect(preflight).toContain('node --check scripts/github-oss-client.mjs')
    expect(preflight).toContain('node --check scripts/verify-packaged-update-config.mjs')
    expect(preflight).not.toMatch(/npm ci|vitest|prepare:core-runtime/)
    expect(appleSilicon).toContain('needs: release-preflight')
    expect(appleSilicon).toContain("inputs.target == 'macos-arm64'")
    expect(intel).toContain('needs: release-preflight')
    expect(intel).toContain("inputs.target == 'macos-x64'")
    expect(windows).toContain('needs: release-preflight')
    expect(windows).toContain("inputs.target == 'windows-x64'")
    expect(sonomaCompatibility).toContain('- release-preflight')
    expect(sonomaCompatibility).toContain('- macos-apple-silicon')
    expect(sonomaCompatibility).toContain("inputs.target == 'macos-arm64'")
  })

  it('builds and validates signed macOS and unsigned Windows inputs on native runners', async () => {
    const workflow = await readFile(
      path.join(projectRoot, '.github', 'workflows', 'release.yml'),
      'utf8'
    )

    for (const secret of [
      'DESKTOP_CSC_LINK',
      'DESKTOP_CSC_KEY_PASSWORD',
      'DESKTOP_APPLE_API_KEY',
      'DESKTOP_APPLE_API_KEY_ID',
      'DESKTOP_APPLE_API_ISSUER',
      'DESKTOP_APPLE_TEAM_ID'
    ]) {
      expect(workflow).toContain(`secrets.${secret}`)
    }
    expect(workflow.match(/Prepare macOS signing keychain/g)).toHaveLength(2)
    expect(workflow.match(/Record macOS build environment/g)).toHaveLength(2)
    expect(workflow.match(/^\s+sw_vers$/gm)).toHaveLength(2)
    expect(workflow.match(/^\s+xcodebuild -version$/gm)).toHaveLength(2)
    expect(workflow.match(/^\s+xcrun --find codesign_allocate$/gm)).toHaveLength(2)
    expect(workflow.match(/CSC_NAME: \$\{\{ steps\.signing_keychain\.outputs\.identity \}\}/g)).toHaveLength(2)
    expect(workflow.match(/ulimit -n 65536/g)).toHaveLength(2)
    expect(workflow.match(/xcrun stapler validate/g)).toHaveLength(5)
    expect(workflow.match(/xcrun notarytool submit/g)).toHaveLength(2)
    expect(workflow.match(/node scripts\/verify-macos-distribution\.mjs "\$RELEASE_APP"/g)).toHaveLength(2)
    expect(workflow.match(/node scripts\/verify-packaged-update-config\.mjs "\$RELEASE_APP\/Contents\/Resources"/g)).toHaveLength(2)
    expect(workflow).not.toContain('spctl --assess --type execute')
    expect(workflow.match(/hdiutil verify/g)).toHaveLength(2)
    expect(workflow.match(/unzip -t/g)).toHaveLength(2)
    expect(workflow.match(/awk -v team="\$APPLE_TEAM_ID"/g)).toHaveLength(2)
    expect(workflow).toMatch(
      /macos-apple-silicon:\r?\n\s+name: macOS Apple Silicon\r?\n(?:[\s\S]*?)runs-on: macos-15\r?\n\s+steps:/
    )
    expect(workflow).toMatch(
      /macos-intel:\r?\n\s+name: macOS Intel\r?\n(?:[\s\S]*?)runs-on: macos-15-intel\r?\n\s+steps:/
    )
    expect(workflow).toMatch(
      /windows-x64:\r?\n\s+name: Windows x64 unsigned\r?\n(?:[\s\S]*?)runs-on: windows-2022\r?\n\s+steps:/
    )
    expect(workflow).toMatch(
      /macos-sonoma-compatibility:\r?\n\s+name: macOS Sonoma distribution compatibility\r?\n(?:[\s\S]*?)runs-on: macos-14\r?\n(?:[\s\S]*?)\s+steps:/
    )
    expect(workflow).toMatch(
      /macos-sonoma-compatibility:[\s\S]*?actions\/checkout@v4\r?\n\s+with:\r?\n\s+persist-credentials: false/
    )
    expect(workflow).toContain(
      'hdiutil attach "release-assets/insight-$RELEASE_VERSION-mac-arm64.dmg"'
    )
    expect(workflow).toContain('codesign --verify --deep --strict --verbose=4 "$app_path"')
    expect(workflow).toContain('node scripts/verify-macos-distribution.mjs "$app_path"')
    expect(workflow).toContain('mount_path="$RUNNER_TEMP/insight-dmg"')
    expect(workflow).toContain('hdiutil detach "$RUNNER_TEMP/insight-dmg" || true')
    expect(workflow).not.toContain('${{ runner.temp }}')
    expect(workflow).toContain('package:candidate:mac:arm64')
    expect(workflow).toContain('package:candidate:mac:x64')
    expect(workflow).toContain('package:candidate:win')
    expect(workflow).toContain('npm run package:mac:arm64')
    expect(workflow).toContain('npm run package:mac:x64')
    expect(workflow).toContain('npm run package:win')
    expect(workflow).toContain('latest-mac-arm64.yml')
    expect(workflow).toContain('latest-mac-x64.yml')
    expect(workflow).toContain('finalize-windows-release.mjs')
    expect(workflow).toContain('$PSNativeCommandUseErrorActionPreference = $true')
    expect(workflow).toContain('$appExecutable')
    expect(workflow).toContain("$resourcesDirectory = Join-Path (Split-Path $appExecutable) 'resources'")
    expect(workflow).toContain('node scripts/verify-packaged-update-config.mjs $resourcesDirectory')
    expect(workflow).toContain('7z t $installerPath')
    expect(workflow).toContain("Copy-Item (Join-Path $env:RELEASE_DIR 'latest.yml')")
  })

  it('creates only an authenticated complete Draft or Apple Silicon Candidate through the protected environment', async () => {
    const workflow = await readFile(
      path.join(projectRoot, '.github', 'workflows', 'release.yml'),
      'utf8'
    )
    const publish = workflow.match(/  publish:\r?\n[\s\S]*$/)?.[0]
    const beforePublish = workflow.slice(0, workflow.indexOf('\n  publish:'))
    if (!publish) throw new Error('Release workflow is missing the publish job.')

    expect(publish).toContain('environment: desktop-release')
    expect(publish).toContain("inputs.target == 'all'")
    expect(publish).toContain("inputs.target == 'macos-arm64'")
    expect(publish).toContain('- release-preflight')
    expect(publish).toContain('- macos-apple-silicon')
    expect(publish).toContain('- macos-intel')
    expect(publish).toContain('- windows-x64')
    expect(publish).toContain('- macos-sonoma-compatibility')
    expect(publish).toContain("needs.macos-sonoma-compatibility.result == 'success'")
    expect(beforePublish).not.toContain('DESKTOP_UPDATE_SIGNING_PRIVATE_KEY')
    expect(publish).toContain('secrets.DESKTOP_UPDATE_SIGNING_PRIVATE_KEY')
    expect(publish).toContain('merge-mac-update-metadata.mjs')
    expect(publish).toContain('build-update-release.mjs')
    expect(publish).toContain('verify-release-assets.mjs')
    expect(publish).toContain('--compatibility build/update-compatibility.json')
    expect(publish).toContain('--policy build/update-release-policy.json')
    expect(publish).toContain('--scope "$RELEASE_SCOPE"')
    expect(publish).toContain('gh release create "$RELEASE_TAG"')
    expect(publish).toContain('gh release upload "$RELEASE_TAG" release-assets/*')
    expect(publish.indexOf('gh release create')).toBeLessThan(publish.indexOf('gh release upload'))
    expect(publish).not.toContain('--draft=false')
    expect(publish).toContain('create_args+=(--prerelease --target "$GITHUB_SHA")')
    expect(publish).not.toContain('--clobber')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).not.toContain('id-token: write')
    expect(workflow).not.toContain('OSS_ACCESS_KEY')
    expect(workflow).not.toContain('insight-desktop-updates')
    expect(workflow).not.toContain('desktop-updates-publisher')
    expect(workflow).not.toContain('ossutil ')
  })

  it('does not retain inherited Windows signing or third-party publication services', async () => {
    const workflow = await readFile(
      path.join(projectRoot, '.github', 'workflows', 'release.yml'),
      'utf8'
    )

    for (const inheritedService of [
      'sign-windows',
      'UKey',
      'ETOKEN',
      'Jsign',
      'SafeNet',
      'ModelScope',
      'Feishu',
      'dshdesktop.com',
      'self-hosted',
      'DESKTOP_WINDOWS_SIGNING_PIN'
    ]) {
      expect(workflow).not.toContain(inheritedService)
    }
  })

  it('permits Better Sidebar’s required native build during profile preparation', async () => {
    const script = await readFile(
      path.join(projectRoot, 'scripts', 'prepare-bundled-profile.mjs'),
      'utf8'
    )

    expect(script).toContain("'--allow-build=node-pty'")
  })

  it('documents the locked Core Runtime distribution policy', async () => {
    const readmes = await Promise.all(
      ['README.md', 'README.zh.md'].map((file) =>
        readFile(path.join(projectRoot, file), 'utf8')
      )
    )

    for (const readme of readmes) {
      expect(readme).toContain('Core Runtime')
      expect(readme).not.toContain('| Platform | Package | Download |')
      expect(readme).not.toContain('| 平台 | 安装包 | 下载 |')
      expect(readme).not.toContain('Coming soon')
      expect(readme).not.toContain('即将发布')
      expect(readme).not.toContain('github.com/dataelement/dsh-desktop/releases')
      for (const asset of releaseAssets) {
        expect(readme).not.toContain(`releases/latest/download/${asset}`)
      }
    }
  })
})
