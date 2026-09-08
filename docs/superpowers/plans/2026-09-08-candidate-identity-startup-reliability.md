# 因赛AI Candidate 身份与启动可靠性 Implementation Plan

> 2026-09-09 整合说明：本计划关于 Candidate 与 Stable 共用产品身份、App ID 和用户数据目录的结论继续有效；其中无版本号的制品名示例已被后续 OSS 不可变资产契约取代。当前统一使用 `insight-<version>-...`，Candidate 由 SemVer 的 `-rc.N` 与签名 Manifest channel 区分。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `v0.1.2-rc.2` 以正式产品身份验证升级链，在支持范围内消除 macOS 钥匙串授权弹窗，并让启动全程保持可见反馈且具备可定位的阶段耗时。

**Architecture:** Candidate 与 Stable 共用应用名称、Bundle ID、安装目标和用户数据目录，更新通道只保留在构建元数据与 GitHub prerelease 中；Dev 继续使用独立身份。发布链在上传前验证最终 DMG 内的应用，并增加 Sonoma 消费端校验。启动侧由 Shell 独立维护阶段状态，Harness WebContentsView 加载期间继续展示 Shell 状态页；先记录耗时，再决定是否启用 Profile 快速路径。

**Tech Stack:** Electron 43、electron-builder 26、React 18、TypeScript 5.9、Vitest、GitHub Actions、macOS codesign/notarytool/Gatekeeper。

## Global Constraints

- 修复分支必须从 `v0.1.2-rc.1` 的 `1f0b001068d32bdded8967ee85fb4f8a9b5414b3` 创建，不包含 `codex/bundled-plugin-market` 的未提交改动。
- 用户可见产品名统一为 `因赛AI`；`Candidate` 只能出现在更新通道、`-rc.N` 版本、GitHub prerelease 和内部构建目录中。
- Candidate 与 Stable 共用 `com.insight.desktop` 和 `insight-desktop`；Dev 保持 `因赛AI Dev`、开发 App ID 和 `insight-desktop-dev`。
- 不迁移 `insight-desktop-candidate` 中的加密凭据；首次进入统一身份的 Candidate 允许重新登录一次。
- 不禁用 Electron `safeStorage`，不保存明文 Token，不把“始终允许”作为验收步骤。
- 不在没有用户明确决策时提高 macOS 最低版本；Electron 43 当前仍支持 macOS 12。
- Windows 继续构建未签名 x64 安装包，本计划不引入 Windows 证书。
- 不修改 Core Runtime 或 upstream Harness；启动状态通信由 Shell 与出厂 `@insight-ai/desktop-integration` 完成。
- 本地检查、Dev 验收和本地 DMG 验收全部通过前，不推送标签、不运行 GitHub Release。
- 每个阶段独立提交；失败时停在当前阶段，保留上一阶段可回退提交。

---

### Task 1: 统一 Candidate 产品身份

**Files:**
- Modify: `electron-builder.candidate.cjs`
- Modify: `package.json`
- Modify: `scripts/finalize-mac-release.mjs`
- Modify: `scripts/verify-release-workflow.mjs`
- Modify: `.github/workflows/release.yml`
- Modify: `src/main/index.ts`
- Modify: `test/release.test.ts`
- Modify: `test/finalize-mac-release.test.ts`

**Interfaces:**
- Consumes: `insightDesktopChannel: 'candidate'` 作为 Candidate 唯一运行时标识。
- Produces: 用户可见名称、Bundle ID、安装目标、产物文件名和 `userData` 与 Stable 一致的 Candidate 构建。

- [ ] **Step 1: 写入失败的产品身份测试**

将 Candidate 断言改为：

```ts
expect(candidateConfig).toContain("appId: 'com.insight.desktop'")
expect(candidateConfig).toContain("productName: '因赛AI'")
expect(candidateConfig).toContain("name: 'insight-desktop'")
expect(candidateConfig).toContain("insightDesktopAppId: 'com.insight.desktop'")
expect(candidateConfig).toContain("insightDesktopChannel: 'candidate'")
expect(candidateConfig).not.toContain('因赛AI Candidate')
expect(candidateConfig).not.toContain('com.insight.desktop.candidate')
expect(candidateConfig).not.toContain('insight-candidate-${os}-${arch}')
```

同时要求 `src/main/index.ts` 中 Candidate 和 Stable 都设置 `insight-desktop`，但 Development 仍使用 `insight-desktop-dev`。更新 macOS metadata fixture，使 RC 版本接受 `insight-mac-arm64.zip` 并拒绝旧的 `insight-candidate-mac-arm64.zip`。

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run:

```bash
npm test -- test/release.test.ts test/finalize-mac-release.test.ts test/runtime.test.ts
```

Expected: Candidate 名称、App ID、用户目录和产物前缀断言失败。

- [ ] **Step 3: 最小化修改 Candidate 构建配置**

`electron-builder.candidate.cjs` 只覆盖输出目录、Candidate 通道和 `publish: null`：

```js
module.exports = {
  ...packageJson.build,
  appId: 'com.insight.desktop',
  productName: '因赛AI',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-candidate'
  },
  extraMetadata: {
    name: 'insight-desktop',
    productName: '因赛AI',
    insightDesktopAppId: 'com.insight.desktop',
    insightDesktopChannel: 'candidate'
  },
  publish: null
}
```

Candidate 的 macOS 和 Windows 命令继续写入 `dist-candidate`，但产物使用 `insight-mac-*`、`insight-windows-*`，应用和可执行文件使用 `因赛AI`。

- [ ] **Step 4: 统一运行时用户目录**

`configureAppIdentity()` 保留 Development 分支；所有已打包通道执行：

```ts
app.setName('因赛AI')
app.setPath('userData', join(app.getPath('appData'), 'insight-desktop'))
```

通道仍由打包后的 `insightDesktopChannel` 决定，不再根据可见名称或 Candidate App ID 推断。

- [ ] **Step 5: 统一发布工作流路径**

Candidate 分支仍执行 `package:candidate:*`，但设置：

```bash
RELEASE_APP=dist-candidate/mac-arm64/因赛AI.app
RELEASE_BASENAME=insight-mac-arm64
```

Intel 使用 `dist-candidate/mac/因赛AI.app` 和 `insight-mac-x64`；Windows 使用 `dist-candidate/win-unpacked/因赛AI.exe` 和 `insight-windows-x64-setup.exe`。

- [ ] **Step 6: 运行聚焦测试并确认通过**

Run:

```bash
npm test -- test/release.test.ts test/finalize-mac-release.test.ts test/runtime.test.ts
npm run typecheck
```

Expected: 全部退出 0。

- [ ] **Step 7: 提交阶段 A**

```bash
git add electron-builder.candidate.cjs package.json scripts/finalize-mac-release.mjs scripts/verify-release-workflow.mjs .github/workflows/release.yml src/main/index.ts test/release.test.ts test/finalize-mac-release.test.ts
git commit -m "fix(release): unify candidate product identity"
```

### Task 2: 增加最终 DMG 与 Sonoma 签名兼容门禁

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/verify-release-workflow.mjs`
- Modify: `test/release.test.ts`
- Modify: `docs/release-runbook.md`
- Modify: `docs/client-build-runbook.md`
- Modify: `docs/incidents/2026-08-27-core-runtime-sidebar-build.md`

**Interfaces:**
- Consumes: `macos-apple-silicon` 上传的 `insight-mac-arm64.dmg` Artifact。
- Produces: 发布前的最终镜像内 App 校验和临时 `macos-14` 消费端兼容信号。

- [ ] **Step 1: 写入失败的工作流门禁测试**

要求两个 macOS 构建 Job 记录 `ImageOS`、`ImageVersion`、`sw_vers`、`xcodebuild -version` 和 `xcrun --find codesign_allocate`；要求新增 `macos-sonoma-compatibility` Job：

```yaml
needs:
  - release-preflight
  - macos-apple-silicon
runs-on: macos-14
```

该 Job 必须下载 `macos-apple-silicon` Artifact、只读挂载 `insight-mac-arm64.dmg`，并对挂载后的 `因赛AI.app` 执行 `codesign --verify --deep --strict`、`syspolicy_check distribution` 和 `xcrun stapler validate`。`publish` 必须依赖该 Job。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- test/release.test.ts
node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json
```

Expected: Sonoma Job、最终 DMG 内 App 检查和 Publish 依赖缺失。

- [ ] **Step 3: 增加签名环境证据**

在签名前输出非敏感环境信息：

```bash
echo "ImageOS=${ImageOS:-unknown}"
echo "ImageVersion=${ImageVersion:-unknown}"
sw_vers
xcodebuild -version
xcrun --find codesign_allocate
```

不把“固定 Xcode”当作未经证明的修复；Electron 是预编译二进制，`codesign` 也来自 Runner 系统。环境信息用于将后续差异落到具体版本。

- [ ] **Step 4: 验证最终 DMG 内应用**

Sonoma Job 使用独立挂载目录，并在 `if: always()` 步骤卸载：

```bash
mkdir -p "$RUNNER_TEMP/insight-dmg"
hdiutil attach release-assets/insight-mac-arm64.dmg \
  -nobrowse -readonly -mountpoint "$RUNNER_TEMP/insight-dmg"
codesign --verify --deep --strict --verbose=4 "$RUNNER_TEMP/insight-dmg/因赛AI.app"
syspolicy_check distribution --verbose "$RUNNER_TEMP/insight-dmg/因赛AI.app"
xcrun stapler validate "$RUNNER_TEMP/insight-dmg/因赛AI.app"
```

- [ ] **Step 5: 连接 Publish 门禁并更新文档**

`publish.needs` 加入 `macos-sonoma-compatibility`，成功条件同时要求该 Job 为 `success`。文档明确：GitHub `macos-14` 只提供临时 Sonoma 信号，最终仍必须在当前 macOS 14.5 目标机启用 quarantine 后连续启动三次；GitHub 停止提供该 Runner 前必须替换为维护中的真实消费端验证环境。

- [ ] **Step 6: 运行阶段 B 本地检查**

Run:

```bash
npm test -- test/release.test.ts
node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json
git diff --check
```

Expected: 全部退出 0。

- [ ] **Step 7: 提交阶段 B**

```bash
git add .github/workflows/release.yml scripts/verify-release-workflow.mjs test/release.test.ts docs/release-runbook.md docs/client-build-runbook.md docs/incidents/2026-08-27-core-runtime-sidebar-build.md
git commit -m "ci(release): verify Sonoma distribution compatibility"
```

### Task 3: 建立 Shell 启动阶段状态与计时

**Files:**
- Create: `src/shared/startup-contracts.ts`
- Create: `src/main/startup/startup-tracker.ts`
- Create: `src/main/startup/startup-ipc.ts`
- Create: `src/shared/startup-api.ts`
- Modify: `src/preload/shell.ts`
- Modify: `src/preload/global.d.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/App.tsx`
- Test: `test/startup-tracker.test.ts`
- Test: `test/authenticated-sidebar-contract.test.ts`

**Interfaces:**
- Produces: `ShellStartupApi.current(): Promise<StartupView>` 与 `subscribe(listener): () => void`。
- Consumes: 主进程启动路径中的阶段变更；Renderer 不读取 Runtime、Profile 或 Token。

- [ ] **Step 1: 定义启动状态**

```ts
export type StartupPhase =
  | 'restoring-session'
  | 'preparing-profile'
  | 'repairing-profile'
  | 'auditing-runtime'
  | 'starting-runtime'
  | 'loading-client'
  | 'ready'

export interface StartupView {
  phase: StartupPhase
  detail: string
  elapsedMs: number
}
```

`StartupTracker.transition(phase, detail)` 使用 `performance.now()` 计算从启动开始的单调时间，将一行 `[desktop] startup phase ...` 写入现有 Harness 日志回调并广播状态；日志不得包含 Token、URL 查询参数或 API 响应。

- [ ] **Step 2: 写入 Tracker 和 IPC 失败测试**

测试阶段顺序、单调耗时、订阅释放以及非法倒退被拒绝。更新契约测试，要求已认证但 `startup.phase !== 'ready'` 时继续渲染 `StatusPage`，不能直接显示空的 `authenticated-host`。

- [ ] **Step 3: 运行测试并确认失败**

Run:

```bash
npm test -- test/startup-tracker.test.ts test/authenticated-sidebar-contract.test.ts
```

Expected: 启动 Tracker 和 Renderer 启动状态不存在。

- [ ] **Step 4: 接入主进程阶段**

按既有顺序在 `authManager.restore()`、`initializeBundledProfile()`、`repairProfilePackages()`、一致性与 LaunchAgent 检查、`runtime.start()` 和 `openHarness()` 前后切换状态。`HarnessWorkspaceView.open()` 完成并显示 Core 的启动页后进入 `loading-client`；当前阶段不声称插件 UI 已 Ready。

- [ ] **Step 5: 让 Shell 启动页覆盖空白期**

Renderer 同时订阅认证和启动状态：未认证沿用现有登录分支；已认证但启动状态不是 `ready` 时显示品牌状态页和对应阶段文本。Harness WebContentsView 可见后会覆盖 Shell 页面，因此不增加第二套侧边栏或业务 UI。

- [ ] **Step 6: 运行阶段 C 验证**

Run:

```bash
npm test -- test/startup-tracker.test.ts test/authenticated-sidebar-contract.test.ts test/auth-session-manager.test.ts test/harness-workspace-view.test.ts
npm run typecheck
npm run dev
```

Manual expected: 从登录恢复到 Harness `Loading plugins…` 之间始终显示状态文本，没有纯色空白；`harness.log` 能看到各阶段单调耗时。

- [ ] **Step 7: 提交阶段 C**

```bash
git add src/shared/startup-contracts.ts src/shared/startup-api.ts src/main/startup/startup-tracker.ts src/main/startup/startup-ipc.ts src/preload/shell.ts src/preload/global.d.ts src/main/index.ts src/renderer/src/App.tsx test/startup-tracker.test.ts test/authenticated-sidebar-contract.test.ts
git commit -m "feat(startup): keep visible progress through runtime launch"
```

### Task 4: 只在计时证明后优化热启动

**2026-09-08 决策结果：跳过本 Task。** 隔离 Dev 首次实测从 `repairing-profile` 3ms 到 `auditing-runtime` 61ms，Profile 修复阶段约 58ms，低于 300ms 门槛。当前约 4.4s 的 Harness 视图接管时间主要发生在 `starting-runtime` 之后；该结果不支持在本分支增加 Profile 缓存复杂度。

**Files:**
- Modify: `src/main/state/bundled-profile.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/state/profile-install-marker.ts`
- Test: `test/bundled-profile.test.ts`
- Test: `test/profile-install-marker.test.ts`
- Test: `test/profile-repair.test.ts`

**Interfaces:**
- Consumes: Task 3 记录的 `preparing-profile`、`repairing-profile` 与 `auditing-runtime` 耗时。
- Produces: 完整 Profile 声明未变化时跳过递归 `node_modules` 扫描的热启动路径。

- [ ] **Step 1: 执行决策门禁**

在同一账号、同一版本连续启动三次。如果第二、三次任一次 `repairing-profile` 小于 300ms，则跳过本 Task，只在构建说明记录“Profile 扫描不是当前主瓶颈”。如果达到或超过 300ms，则执行余下步骤。

- [ ] **Step 2: 写入失败的完整性标记测试**

标记内容升级为 JSON，并同时记录声明指纹和检查版本：

```ts
interface ProfileInstallMarker {
  version: 2
  declarationFingerprint: string
  repairScanVersion: 1
}
```

测试要求：声明未变化且 `repairScanVersion` 当前时可跳过扫描；清除标记、声明变化或旧文本标记必须执行扫描；任何插件增删命令在调用 pnpm 前清除标记，成功后重新写入。

- [ ] **Step 3: 实现可信快速路径**

`repairProfilePackages()` 先读取当前 JSON 标记；只有标记缺失、声明变化或扫描版本落后时才调用 `clearDamagedPackageDirectories()`。本轮涉及的导入、卸载和恢复流程在改变 Profile 前撤销标记，成功后重新建立，保证异常中断不会留下“完整”声明。

- [ ] **Step 4: 避免无变化的出厂集成重写**

`initializeBundledProfile()` 比较模板与目标 `packages/insight-desktop-integration/package.json` 和 `lib/client.js` 的 SHA-256；两者一致、Profile 版本为 3、依赖和 workspace 声明已存在时直接返回 `false`，不执行删除、复制或重写。发现任一不一致时沿用现有刷新流程。

- [ ] **Step 5: 运行阶段 D 验证**

Run:

```bash
npm test -- test/bundled-profile.test.ts test/profile-install-marker.test.ts test/profile-repair.test.ts test/profile-plugin-command.test.ts
npm run typecheck
```

Manual expected: 第二、三次启动日志显示 Profile 快速路径，且导入插件后强制执行一次完整检查；Sidebar、用户插件与账号隔离不变。

- [ ] **Step 6: 提交阶段 D**

```bash
git add src/main/state/bundled-profile.ts src/main/state/profile-install-marker.ts src/main/index.ts test/bundled-profile.test.ts test/profile-install-marker.test.ts test/profile-repair.test.ts
git commit -m "perf(startup): trust completed profiles on warm launch"
```

### Task 5: 形成 `v0.1.2-rc.2` 验收候选

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/release-runbook.md`
- Modify: `docs/client-build-runbook.md`
- Modify: `docs/incidents/2026-08-27-core-runtime-sidebar-build.md`

**Interfaces:**
- Consumes: Tasks 1–4 中实际执行并通过的提交。
- Produces: 可推送但尚未打标签的 `0.1.2-rc.2` 分支。

- [ ] **Step 1: 固化版本和实际结论**

将两个 package 版本字段更新为 `0.1.2-rc.2`。文档只写已经观测到的阶段耗时和签名结果；不得把 GitHub Runner 通过替代当前 macOS 14.5 的人工验证。

- [ ] **Step 2: 运行本地发布曲线**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run package:candidate:mac:arm64
git diff --check
```

Expected: 全部退出 0，本地 `dist-candidate/insight-mac-arm64.dmg` 内应用显示名为 `因赛AI`。本地没有 Developer ID 身份时，该 DMG 只用于功能与品牌验收，不冒充分发签名验收。

- [ ] **Step 3: 人工本地验收并停止等待确认**

验证登录、退出、登录恢复、Sidebar、设置、Markdown/HTML 打开、更新入口、菜单栏名称和连续三次启动页面。任何回归都在本地修复，不推送标签。

- [ ] **Step 4: 提交 RC 版本准备**

```bash
git add package.json package-lock.json docs/release-runbook.md docs/client-build-runbook.md docs/incidents/2026-08-27-core-runtime-sidebar-build.md
git commit -m "chore(release): prepare v0.1.2-rc.2"
```

- [ ] **Step 5: 推送分支但不创建标签**

```bash
git push -u origin codex/v0.1.2-rc.2-fixes
```

Expected: 远端只出现修复分支，不触发 `Release desktop installers`。

- [ ] **Step 6: 用户确认后运行唯一一次 Candidate Release**

```bash
gh workflow run release.yml \
  --repo Boxser567/insight-desktop-shell \
  --ref codex/v0.1.2-rc.2-fixes \
  -f candidate_tag=v0.1.2-rc.2
```

Expected: 两个 macOS 签名构建、Windows 未签名构建和 Sonoma 兼容 Job 全部通过后，才发布 GitHub prerelease。

- [ ] **Step 7: 当前目标机最终验收**

下载确切 `insight-mac-arm64.dmg`，保留 quarantine 覆盖安装。连续启动三次，要求：零钥匙串密码弹窗、名称仅为 `因赛AI`、无纯色空白、登录与账号数据正确、Sidebar 和更新入口正常。记录 Run URL、Shell commit、Core Runtime tag、DMG SHA-256 和三次启动阶段耗时。

## Self-Review

- Spec coverage: 钥匙串触发的签名兼容、Candidate 名称、启动空白、插件加载等待、阶段验证和回退隔离均有对应 Task。
- Placeholder scan: 计划不含待填内容；Profile 优化由 300ms 的明确门禁决定执行或跳过。
- Type consistency: `StartupPhase`、`StartupView`、`ShellStartupApi` 与阶段调用名称在 Task 3 中保持一致；Candidate 通道始终来自 `insightDesktopChannel`。
