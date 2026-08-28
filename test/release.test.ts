import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

const releaseAssets = [
  'insight-mac-arm64.dmg',
  'insight-mac-x64.dmg',
  'insight-windows-x64-setup.exe'
]

describe('GitHub release contract', () => {
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
        extraResources: Array<{ from: string; to: string }>
        win: { target: Array<{ target: string; arch: string[] }> }
        nsis: { artifactName: string; include: string }
        portable?: unknown
      }
    }

    expect(packageJson.build.artifactName).toBe('insight-${os}-${arch}.${ext}')
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
      'insight-windows-${arch}-setup.${ext}'
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

  it('exposes trusted local plugin import without configuring a marketplace', async () => {
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')

    expect(main).toContain("label: isChinese ? '导入本地插件…' : 'Import Local Plugin…'")
    expect(main).toContain('resolveLocalPluginImport(selectedPath)')
    expect(main).toContain('addProfilePluginWithDsh(')
    expect(main).not.toMatch(/marketplace|plugin market/i)
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

  it('does not configure automatic updates', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as {
      dependencies: Record<string, string>
      build: {
        publish?: unknown
        win: { verifyUpdateCodeSignature: boolean }
      }
    }
    expect(packageJson.dependencies['electron-updater']).toBeUndefined()
    expect(packageJson.build.publish).toBeUndefined()
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
      'package:dev:win'
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
    const main = await readFile(path.join(projectRoot, 'src', 'main', 'index.ts'), 'utf8')

    expect(packageJson.scripts['package:dev:dir']).toContain('npm run build')
    expect(packageJson.scripts['package:dev:dir']).toContain('electron-builder.dev.cjs')
    expect(packageJson.scripts['package:dev:mac:arm64']).toContain('verify-target.mjs darwin arm64')
    expect(packageJson.scripts['package:dev:mac:arm64']).toContain('electron-builder.dev.cjs')
    expect(packageJson.scripts['package:dev:mac:x64']).toContain('verify-target.mjs darwin x64')
    expect(packageJson.scripts['package:dev:mac:x64']).toContain('electron-builder.dev.cjs')
    expect(packageJson.scripts['package:mac:arm64']).toContain('electron-builder --mac dmg --arm64')
    expect(packageJson.scripts['package:mac:arm64']).toContain('electron-builder --mac zip --arm64')
    expect(packageJson.scripts['package:dev:win']).toContain('verify-target.mjs win32 x64')
    expect(packageJson.scripts['package:dev:win']).toContain('electron-builder.dev.cjs')
    expect(packageJson.scripts['package:dev:win']).toContain('--publish never')
    expect(developmentConfig).toContain("appId: 'com.insight.desktop.dev'")
    expect(developmentConfig).toContain("productName: '因赛AI Dev'")
    expect(developmentConfig).toContain("output: 'dist-dev'")
    expect(developmentConfig).toContain("dshDesktopChannel: 'development'")
    expect(developmentConfig).toContain(
      "artifactName: 'insight-dev-${os}-${arch}.${ext}'"
    )
    expect(developmentConfig).toContain(
      "artifactName: 'insight-dev-windows-${arch}-setup.${ext}'"
    )
    expect(main).toContain("app.setPath('userData', join(app.getPath('appData'), 'insight-desktop-dev'))")
    expect(main).toContain("app.setPath('userData', join(app.getPath('appData'), 'insight-desktop'))")
    expect(main).toContain('const developmentBuild = isDevelopmentBuild()')
  })

  it('builds and publishes every supported platform', async () => {
    const workflow = await readFile(
      path.join(projectRoot, '.github', 'workflows', 'release.yml'),
      'utf8'
    )

    expect(workflow).toContain('runs-on: macos-15')
    expect(workflow).toContain('runs-on: macos-15-intel')
    expect(workflow).toContain('runs-on: windows-2022')
    expect(workflow).toContain('npm run package:dev:win')
    expect(workflow).toContain('Smoke test packaged Windows Harness')
    expect(workflow).toContain("Join-Path $env:APPDATA 'insight-desktop-dev'")
    expect(workflow).toContain("$executable = 'dist-dev\\win-unpacked\\因赛AI Dev.exe'")
    expect(workflow).toContain('if (-not [string]::IsNullOrEmpty($log))')
    expect(workflow).toContain('Packaged Windows Harness smoke test passed.')
    expect(workflow).toContain("Invoke-HarnessRpc 'workspace.create'")
    expect(workflow).toContain("Invoke-HarnessRpc 'session.create'")
    expect(workflow).toContain('Harness process exited after workspace and session creation.')
    expect(workflow).toContain('windows_prerelease_tag:')
    expect(workflow).toContain('Publish validated Windows development pre-release')
    expect(workflow).toContain('gh release create $env:PRERELEASE_TAG')
    expect(workflow).toContain('--prerelease')
    expect(workflow).toContain('name: windows-x64-dev')
    expect(workflow).toContain('dist-dev/insight-dev-windows-x64-setup.exe')
    for (const asset of releaseAssets) expect(workflow).toContain(asset)
    expect(
      workflow.match(
        /npm version --no-git-tag-version --allow-same-version "\$\{\{ github\.ref_name \}\}"/g
      )
    ).toHaveLength(3)
  })

  it('signs and notarizes both macOS architectures on tag releases', async () => {
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
    expect(workflow.match(/xcrun stapler validate/g)).toHaveLength(4)
    expect(workflow.match(/xcrun notarytool submit/g)).toHaveLength(2)
    expect(workflow.match(/CSC_IDENTITY_AUTO_DISCOVERY: 'false'/g)).toHaveLength(2)
    expect(workflow).not.toContain("CSC_LINK: ''")
    expect(workflow).toMatch(
      /macos-apple-silicon:\r?\n\s+name: macOS Apple Silicon\r?\n(?:[\s\S]*?)runs-on: macos-15\r?\n\s+steps:/
    )
    expect(workflow).toMatch(
      /macos-intel:\r?\n\s+name: macOS Intel\r?\n(?:[\s\S]*?)runs-on: macos-15-intel\r?\n\s+steps:/
    )
    expect(workflow).toMatch(
      /windows-x64:\r?\n\s+name: Windows x64\r?\n(?:[\s\S]*?)runs-on: windows-2022\r?\n\s+steps:/
    )
  })

  it('signs Windows installers on the local UKey runner before publishing', async () => {
    const workflow = await readFile(
      path.join(projectRoot, '.github', 'workflows', 'release.yml'),
      'utf8'
    )

    expect(workflow).toContain('name: windows-x64-unsigned')
    expect(workflow).toContain('Sign Windows package locally with UKey')
    expect(workflow).toContain('runs-on: [self-hosted, macOS, ARM64]')
    expect(workflow).toContain('--storetype ETOKEN')
    expect(workflow).toContain('--storepass "file:$pin_file"')
    expect(workflow).toContain('--tsmode RFC3161')
    expect(workflow).toContain('secrets.DESKTOP_WINDOWS_SIGNING_PIN')
    expect(workflow).toContain(`printf '%s' "$WINDOWS_SIGNING_PIN" > "$pin_file"`)
    expect(workflow).toContain('unset WINDOWS_SIGNING_PIN')
    expect(workflow).not.toContain('security find-generic-password')
    expect(workflow).not.toContain('WINDOWS_SIGNING_KEYCHAIN_SERVICE')
    expect(workflow).toContain('finalize-windows-release.mjs')
    expect(workflow).toContain('version="${GITHUB_REF_NAME#v}"')
    expect(workflow).toContain('pattern: macos-*')
    expect(workflow).toMatch(
      /publish:[\s\S]*?needs\.sign-windows\.result == 'success'[\s\S]*?- sign-windows/
    )
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
