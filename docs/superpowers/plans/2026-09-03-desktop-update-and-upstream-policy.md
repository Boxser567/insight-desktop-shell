# 桌面客户端更新与上游管理实施计划

> 本计划按任务顺序执行。每个阶段都有停止点；未达到当前停止点时，不得触发下一阶段的 GitHub 安装包构建。

**目标：** 将 Insight Desktop 固化为独立维护的产品分支，并为托管在 GitHub Releases 的 macOS 签名包和 Windows 未签名包增加可信整包更新能力。

**架构：** Shell 主进程负责更新调度、GitHub Release 发现、Ed25519 Manifest 验签、`electron-updater`、下载产物校验和安装前退出。独立更新窗口和有限 Preload API 在登录前、恢复模式和已登录 Harness 界面中提供更新状态。必需第一方插件和锁定的 Core Runtime 只能随完整客户端更新。

**技术栈：** Electron 43、electron-builder/electron-updater 26.15/6.x、TypeScript 5.9、React 18、Node.js Crypto Ed25519、Zod、semver、Vitest 4、GitHub Actions、GitHub Releases、NSIS、Apple Developer ID 与 Notary Service。

## 全局约束

- `dataelement/dsh-desktop` 是参考上游。不得整体合并其主分支、`package.json`、Lockfile、内置 Harness 包、dshmarket、品牌资源或发布工作流。
- `core-runtime.lock.json` 是 Shell 内置 Core Runtime 的唯一版本来源。
- 必需第一方插件、Better Sidebar、默认 Profile 和 Core Runtime 只能随完整桌面版本一起更新。
- 正式版使用 App ID `com.insight.desktop`；开发版和候选版使用独立 App ID 与 `userData`。
- 正式版和候选版 macOS 安装包必须完成 Developer ID 签名、公证和装订。
- Windows NSIS 暂不签名，允许出现 SmartScreen 提示；安装前仍必须通过 Ed25519 Manifest 与实际 EXE SHA512 校验。
- 开发版不得连接候选或正式更新源。
- 第一阶段更新源是公开的 `Boxser567/insight-desktop-shell` GitHub Releases。
- 正式 Tag 格式为 `v<major>.<minor>.<patch>`；候选 Tag 格式为 `v<major>.<minor>.<patch>-rc.<number>`。
- 正式版和候选版不能互相发现。
- 强制更新仅在当前版本低于签名策略中的 `minimumSupportedVersion` 时成立。
- 缓存的强制策略必须保存 Manifest 原始字节与签名，并在每次启动重新验签后才能阻止登录/Core。
- 生产更新私钥不得保存在仓库内，包括被 `.gitignore` 忽略的路径。
- 更新不得删除产品 `userData`、账号级 Harness Home、会话、工作区、设置、画布资产或用户导入插件。
- Linux、dshmarket、必需插件独立更新、历史版本安装和数据降级迁移不在本计划内。
- 聚焦测试、本地 Build、Fixture UI 和对应本地 Smoke 未通过前，不得触发 GitHub 安装包构建。
- 每个任务提交前只暂存该任务文件清单中的改动，不使用 `git add -A`。下文 Commit 命令均假设相关文件已经精确暂存。

## 四阶段执行路线

### 阶段 A：可信契约，不打包

执行任务 1 至任务 4。只处理产品归属、Manifest、GitHub Release 解析、状态和缓存。

停止点 A：相关 Vitest 与 TypeScript 检查通过；伪造 Manifest、伪造强制更新缓存、错误渠道和乱序 Release 都被拒绝。

### 阶段 B：本地更新闭环，不连接正式源

执行任务 5 至任务 6。使用 Fake Source 和 Fake Executor 完成主进程、IPC、菜单和更新窗口。

停止点 B：开发模式能人工查看全部更新状态；无法真实安装，也不会连接 GitHub 正式源。

### 阶段 C：发布工具和本地候选包，不发布 Release

执行任务 7 至任务 8。完成密钥、公钥、发布策略、产物验证和三渠道隔离。

停止点 C：本地候选目录检查通过，内置 Runtime、Better Sidebar、公钥和渠道身份正确；仓库及安装包中不存在私钥或本地源码路径。

### 阶段 D：GitHub 候选更新

执行任务 9 至任务 10。先运行低成本发布预检，再构建平台安装包，最后完成 N 到 N+1 更新。

停止点 D：macOS arm64 与 Windows x64 的候选更新、数据保留和核心业务回归全部通过后，才允许创建正式 Release。

## 文件清单

### 产品与策略

- 修改 `README.md`：声明 Insight 产品仓库和参考上游策略。
- 修改 `package.json`、`package-lock.json`：移除上游作者身份，修正仓库地址，增加更新依赖和发布配置。
- 修改 `docs/client-build-runbook.md`：增加上游审计与更新发布门禁。
- 修改 `docs/plans/2026-08-28-authenticated-sidebar-integration-design.md`：移除整体同步 Shell 上游的假设。
- 新增 `docs/upstream-intake.md`：记录上游审计和定向采用。

### 共享契约与认证

- 新增 `src/shared/update-contracts.ts`：更新状态、命令、Manifest、平台和渠道类型。
- 新增 `src/shared/update-api.ts`：Shell、Harness 和更新窗口的有限 API。
- 新增 `src/main/update/release-manifest.ts`：严格解析、验签和目标产物选择。
- 新增 `src/main/update/update-source.ts`：与更新托管方无关的解析接口。
- 新增 `src/main/update/github-release-source.ts`：GitHub Releases 实现。
- 新增 `build/update-compatibility.json`：数据兼容性配置。
- 新增 `build/update-release-policy.json`：与发布版本和渠道绑定的可选/强制策略。
- 新增 `build/update-signing-public.pem`：生产更新公钥。

### 更新生命周期

- 新增 `src/main/update/update-policy.ts`：平台、渠道、调度和支持策略。
- 新增 `src/main/update/update-state.ts`：纯状态 Reducer。
- 新增 `src/main/update/skipped-version.ts`：原子保存跳过版本。
- 新增 `src/main/update/required-update-policy.ts`：保存原始 Manifest/签名并在读取时重新验签。
- 新增 `src/main/update/update-executor.ts`：`electron-updater` 适配器。
- 新增 `src/main/update/update-manager.ts`：串行调度、验签、下载校验和安装。
- 新增 `src/main/update/update-window.ts`：独立更新窗口生命周期。
- 修改 `src/main/workspace/workspace-lifecycle.ts`：安装前显式、串行停止工作区。
- 修改 `src/main/index.ts`：只负责组合服务、注册 IPC/菜单和退出清理。

### 渲染进程与 Preload

- 新增 `src/preload/update.ts`。
- 修改 `src/preload/shell.ts`、`src/preload/harness.ts`。
- 修改 `src/shared/shell-api.ts`、`src/renderer/src/global.d.ts`、`packages/insight-desktop-integration/src/client/global.d.ts`。
- 新增 `src/renderer/update.html`、`src/renderer/src/update-main.tsx`、`src/renderer/src/UpdateWindow.tsx`、`src/renderer/src/update.css`。
- 新增 `src/renderer/src/UpdateBadge.tsx`，修改 `src/renderer/src/App.tsx`。
- 修改第一方集成插件的 `components.tsx`、`index.tsx`、`styles.tsx` 和语言文件。
- 修改 `electron.vite.config.ts`、`src/shared/desktop-menu.ts`、`src/preload/windows-menu.ts` 和 `src/main/index.ts`。

### 发布脚本与 CI

- 新增 `scripts/generate-update-signing-keypair.mjs`。
- 新增 `scripts/build-update-release.mjs`。
- 新增 `scripts/merge-mac-update-metadata.mjs`。
- 新增 `scripts/verify-release-assets.mjs`。
- 修改 `scripts/finalize-windows-release.mjs`。
- 新增 `electron-builder.candidate.cjs`，修改 `electron-builder.dev.cjs`。
- 修改 `.github/workflows/release.yml`。

### 测试

- 新增 `test/update-manifest.test.ts`、`test/github-release-source.test.ts`、`test/update-policy.test.ts`、`test/update-state.test.ts`、`test/skipped-version.test.ts`、`test/required-update-policy.test.ts`、`test/update-manager.test.ts`、`test/update-window.test.ts`、`test/update-api-contract.test.ts`、`test/build-update-release.test.ts`、`test/merge-mac-update-metadata.test.ts`、`test/verify-release-assets.test.ts`。
- 修改 `test/workspace-lifecycle.test.ts`、`test/release.test.ts`、`test/shell-preload-contract.test.ts`、`test/desktop-integration-client.test.ts`、`test/windows-titlebar.test.ts`、`test/readme-parity.test.ts`、`test/finalize-windows-release.test.ts`、`test/runtime.test.ts`。

---

## 任务 1：确立产品分支和仓库身份

**涉及文件：** `README.md`、`package.json`、`package-lock.json`、`docs/client-build-runbook.md`、Sidebar 集成设计、`docs/upstream-intake.md`、`test/release.test.ts`、`test/readme-parity.test.ts`。

### 1.1 先修改契约测试

测试读取 `package.json` 并断言：

```ts
expect(packageJson.repository.url).toBe(
  'git+https://github.com/Boxser567/insight-desktop-shell.git'
)
expect(packageJson.bugs.url).toBe(
  'https://github.com/Boxser567/insight-desktop-shell/issues'
)
expect(packageJson.homepage).toBe(
  'https://github.com/Boxser567/insight-desktop-shell#readme'
)
expect(packageJson.author).toBeUndefined()
```

文档测试必须包含 `reference upstream`、`selective adoption`、`upstream commit range`，并拒绝 `periodically merges`。

### 1.2 验证旧行为确实失败

```bash
npx vitest run test/release.test.ts test/readme-parity.test.ts
```

预期：仓库地址、上游策略和作者字段导致失败。

### 1.3 修改元数据和文档

将三个 URL 改为 Insight 地址，删除 `DataElement` 作者字段。在法定主体未确认前不填入替代名称。通过以下命令更新 Lockfile 根包元数据，不手工改依赖解析：

```bash
npm install --package-lock-only --ignore-scripts
```

`docs/upstream-intake.md` 使用以下记录模板：

```markdown
## 上游接收记录

- 审查日期：
- 上游 Commit 范围：
- 审查类别：Electron 生命周期 / 更新器 / 恢复 / Core 兼容 / 上游产品专属
- 采用的 Commit 与文件：
- 拒绝的变更及原因：
- 本地适配：
- 聚焦测试：
- 构建手册达到的阶段：
```

### 1.4 验证与提交

```bash
npx vitest run test/release.test.ts test/readme-parity.test.ts
git diff --check
```

预期：全部通过。用户确认后提交：

```bash
git commit -m "docs: establish reference upstream policy"
```

---

## 任务 2：定义并认证发布 Manifest

**涉及文件：** `src/shared/update-contracts.ts`、`src/main/update/release-manifest.ts`、`build/update-compatibility.json`、`test/update-manifest.test.ts`、`package.json`、`package-lock.json`。

### 2.1 定义共享类型并先写失败测试

```ts
export type UpdateChannel = 'development' | 'candidate' | 'stable'
export type ReleaseUpdateChannel = Exclude<UpdateChannel, 'development'>
export type UpdatePlatform = 'darwin' | 'win32'
export type UpdateArch = 'arm64' | 'x64'

export interface SignedReleaseManifest {
  schema: 'insight-desktop-update/v1'
  version: string
  channel: ReleaseUpdateChannel
  publishedAt: string
  shellCommit: string
  coreRuntime: { tag: string; commit: string }
  policy: {
    mode: 'optional' | 'required'
    minimumSupportedVersion: string
  }
  compatibility: {
    profileSchema: number
    accountStorageSchema: number
    minimumReadableDataSchema: number
    maximumReadableDataSchema: number
  }
  artifacts: ReleaseArtifact[]
}
```

测试使用 `generateKeyPairSync('ed25519')` 生成临时测试密钥，对 `JSON.stringify(value, null, 2) + '\n'` 的原始 `Buffer` 签名，并证明：

- 合法原始字节可返回解析后的 Manifest；
- 任意一字节变化都会导致验签失败；
- 签名合法但包含未知字段时，严格 Schema 拒绝；
- 正式渠道不能接受候选 Manifest；
- darwin arm64 必须包含 ZIP、ZIP blockmap、DMG 和更新元数据；
- win32 x64 必须包含 NSIS、blockmap 和更新元数据；
- 其他平台或架构被拒绝；
- 非法 semver、日期、重复产物、负数大小和错误 SHA512 被拒绝；
- `minimumSupportedVersion` 非法或高于发布版本时被拒绝。

### 2.2 安装依赖并实现

```bash
npm install zod semver
npm install --save-dev @types/semver
```

核心验签结构：

```ts
export function verifyReleaseManifest(input: VerifyReleaseManifestInput): SignedReleaseManifest {
  const key = createPublicKey(input.publicKeyPem)
  if (!verify(null, input.manifestBytes, key, input.signatureBytes)) {
    throw new Error('更新 Manifest 签名无效。')
  }
  const parsed = manifestSchema.parse(JSON.parse(input.manifestBytes.toString('utf8')))
  if (!semver.valid(parsed.version)) throw new Error('更新版本不是合法语义版本。')
  if (parsed.channel !== input.target.channel) throw new Error('更新渠道与当前客户端不一致。')
  selectTargetArtifacts(parsed, input.target)
  return parsed
}
```

所有 Zod 对象使用 `.strict()`。大小和 Schema 数值必须是非负安全整数；SHA512 Base64 必须符合 `/^[A-Za-z0-9+/]{86}==$/`；`minimumReadableDataSchema <= maximumReadableDataSchema`；解析后拒绝重复的 `(platform, arch, kind, name)`。

`build/update-compatibility.json` 初始内容：

```json
{
  "profileSchema": 1,
  "accountStorageSchema": 1,
  "minimumReadableDataSchema": 1,
  "maximumReadableDataSchema": 1
}
```

### 2.3 验证与提交

```bash
npx vitest run test/update-manifest.test.ts
npm run typecheck
git diff --check
```

用户确认后提交：

```bash
git commit -m "feat(update): authenticate release manifests"
```

---

## 任务 3：解析候选和正式 GitHub Release

**涉及文件：** `src/main/update/update-source.ts`、`src/main/update/github-release-source.ts`、`test/github-release-source.test.ts`。

### 3.1 定义接口

```ts
export interface ResolvedRelease {
  manifest: SignedReleaseManifest
  artifactUrls: ReadonlyMap<string, URL>
}

export interface UpdateSource {
  resolve(channel: ReleaseUpdateChannel, target: UpdateTarget): Promise<ResolvedRelease>
}
```

### 3.2 先写选择与信任测试

覆盖以下情况：草稿过滤、正式/候选隔离、API 顺序与 semver 顺序不同、合法版本出现在后一页、非法 Tag、Tag 与 Manifest 版本不一致、缺失 Manifest/签名、重复资产名、签名被篡改、Manifest 声明的资产在 Release 中缺失、非 HTTPS、跳转失败和 GitHub 限流。

### 3.3 实现 GitHub Source

请求：

```text
https://api.github.com/repos/Boxser567/insight-desktop-shell/releases?per_page=100&page=<n>
```

请求使用 `Accept: application/vnd.github+json`。最多读取五页。拒绝草稿和不符合目标渠道 Tag 规则的版本，从完整候选集合中选择最高 semver。到达五页上限但仍有下一页时返回明确错误，不使用不完整集合。

下载选中 Release 的 `insight-update.json` 和 `.sig`，先验证原始字节，再要求 Manifest 版本等于 Tag 版本，之后才能信任资产名和 URL。

初始 URL 只允许 HTTPS 且 Host 为 `github.com` 或 `api.github.com`；允许 `fetch` 跟随 GitHub 签名对象存储跳转。客户端不内置 GitHub Token。

### 3.4 验证与提交

```bash
npx vitest run test/github-release-source.test.ts
npm run typecheck
git diff --check
```

用户确认后提交：

```bash
git commit -m "feat(update): resolve authenticated GitHub releases"
```

---

## 任务 4：实现更新策略、持久化和状态转换

**涉及文件：** `update-policy.ts`、`update-state.ts`、`skipped-version.ts`、`required-update-policy.ts` 及四个对应测试。

### 4.1 定义策略常量

```ts
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
export const UPDATE_STARTUP_DELAY_MS = 15_000
export const UPDATE_STARTUP_JITTER_MS = 15_000
export const AUTO_INSTALL_ON_APP_QUIT = false
```

只有已打包的 `candidate`、`stable` 且平台为 `darwin`、`win32` 时支持更新。

### 4.2 定义状态事件

```ts
type UpdateStateEvent =
  | { type: 'check'; manual: boolean }
  | { type: 'available'; version: string; required: boolean; manual: boolean }
  | { type: 'progress'; version: string; required: boolean; percent: number; manual: boolean }
  | { type: 'downloaded'; version: string; required: boolean; manual: boolean }
  | { type: 'installing'; version: string; required: boolean; manual: boolean }
  | { type: 'up-to-date' }
  | { type: 'unsupported'; reason: string; manual: boolean }
  | { type: 'error'; version?: string; required: boolean; message: string; retryable: boolean; manual: boolean }
  | { type: 'reset' }
```

下载进度限制在 `0..100`。需要版本的状态缺少版本时必须抛错，不能猜测。

### 4.3 持久化

跳过版本写入 `updates/skipped-version.json`：

```json
{ "schema": 1, "version": "1.2.3" }
```

写入同目录临时文件后原子 Rename。读取时只接受合法 semver。强制更新忽略跳过设置。

强制策略缓存写入 `updates/required-policy.json`：

```json
{ "schema": 1, "manifestBase64": "...", "signatureBase64": "..." }
```

只有 `verifyReleaseManifest` 成功后才能写入。读取时解码原始 Manifest 与签名，使用内置公钥和当前渠道/平台重新验签。Base64、签名、Schema、渠道、目标或策略无效时，记录警告并只删除该缓存文件，客户端继续启动。

支持当前运行版本后删除强制策略缓存，不修改用户内容或其他更新文件。

### 4.4 测试

覆盖六小时边界、跳过版本重启恢复、手动检查覆盖跳过、原子替换、损坏偏好恢复、原始字节保存、每次读取重新验签、有效格式伪造缓存失败开放、缓存清理和所有合法状态转换。

```bash
npx vitest run test/update-policy.test.ts test/update-state.test.ts test/skipped-version.test.ts test/required-update-policy.test.ts
npm run typecheck
git diff --check
```

### 停止点 A

以上命令全部通过后停止，检查 Git Diff。未通过时不进入更新管理器、UI 或任何打包工作。

用户确认后提交：

```bash
git commit -m "feat(update): define update policy and state"
```

---

## 任务 5：实现可测试的更新执行器和管理器

**涉及文件：** `update-executor.ts`、`update-manager.ts`、`workspace-lifecycle.ts`、对应测试、`package.json` 和 Lockfile。

`UpdateManager` 对外只提供 `start()`、`stop()`、`status()`、`subscribe()`、`check(manual)`、`download()`、`skip(version)` 和 `install()`。

### 5.1 先写生命周期和管理器测试

`WorkspaceLifecycle.stop()` 必须排在正在执行的 Start 后面、只停止一次、清除 `activeScope()`，并阻止过期队列重新启动旧账号。

使用 Fake Source、Executor、Clock 和 Timer 证明：

- 启动随机延迟和六小时定时器各创建一次；
- 并发检查合并为同一个操作；
- Manifest 验证成功后才调用 `electron-updater`；
- 当前版本和旧版本不提示；
- 自动检查遵循跳过设置，手动检查可重新显示；
- 只有当前版本低于签名最低版本时才写入强制策略缓存；
- 重新读取强制缓存时再次验签；
- 无效或不可用 Manifest 不产生强制门禁；
- 不自动下载；
- 下载完成后重新计算大小和 SHA512；
- 不一致时只删除对应缓存安装器；
- `prepareToInstall` 在 `quitAndInstall` 前只执行一次；
- 准备失败时不调用安装；
- 系统恢复满六小时才检查；
- 开发模式或未打包模式不启动真实更新器。

### 5.2 适配 electron-updater

```bash
npm install electron-updater@^6.8.9
```

```ts
export interface UpdateExecutor {
  configure(options: { channel: ReleaseUpdateChannel; autoInstallOnQuit: false }): void
  check(): Promise<ExecutorUpdate | undefined>
  download(): Promise<void>
  quitAndInstall(): void
  on(listener: (event: ExecutorEvent) => void): () => void
}
```

Electron Adapter 设置：

- `autoDownload = false`；
- `autoInstallOnAppQuit = false`；
- `allowPrerelease = channel === 'candidate'`；
- `allowDowngrade = false`；
- 使用打包生成的 GitHub `app-update.yml`；
- 将 `update-available`、`update-not-available`、`download-progress`、`update-downloaded`、`error` 转为内部事件；
- 下载完成事件必须带 `downloadedFile`。

Builder 配置：

```json
"publish": [{
  "provider": "github",
  "owner": "Boxser567",
  "repo": "insight-desktop-shell"
}],
"detectUpdateChannel": false
```

所有本地 Package Script 继续使用 `--publish never`，只有 GitHub Actions 可以发布。

### 5.3 串行管理器与文件校验

检查流程先解析和验证签名 Release，再选择平台产物、比较 `app.getVersion()`，最后允许 Executor 检查 Provider。Executor 返回版本必须与签名 Manifest 相同。

检查、下载、安装共用一个 `operation: Promise<void> | undefined`，禁止并发。`stop()` 清理订阅、Timer 和 Resume Listener。渲染进程状态不得包含私钥、GitHub 凭据、可变资产 URL 或本地路径。

下载文件使用流式 SHA512：

```ts
const digest = createHash('sha512')
for await (const chunk of createReadStream(downloadedFile)) digest.update(chunk)
if (digest.digest('base64') !== artifact.sha512) {
  await rm(downloadedFile, { force: true })
  throw new Error('下载的更新文件与可信发布记录不一致。')
}
```

### 5.4 工作区停止

为 `WorkspaceLifecycle` 增加串行 `stop()`。更新安装不得删除或重置任何账号目录。

### 5.5 验证与提交

```bash
npx vitest run test/update-manager.test.ts test/workspace-lifecycle.test.ts
npm run typecheck
git diff --check
```

用户确认后提交：

```bash
git commit -m "feat(update): manage verified client updates"
```

---

## 任务 6：提供安全 IPC、菜单、更新窗口和提示入口

### 6.1 API

```ts
export interface DesktopUpdateApi {
  status(): Promise<UpdateStatus>
  subscribe(listener: (status: UpdateStatus) => void): () => void
  open(): Promise<void>
  check(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  skip(version: string): Promise<void>
}

export interface DesktopUpdateWindowApi extends DesktopUpdateApi {
  quit(): Promise<void>
}
```

Shell 和 Harness 只获得 `DesktopUpdateApi`；更新窗口获得带 `quit()` 的 `DesktopUpdateWindowApi`。

### 6.2 IPC 与窗口安全

- 每个修改状态的 IPC 都校验精确 Sender Frame。
- `updates:quit` 只接受更新窗口主 Frame；Shell 和 Harness 调用必须被拒绝。
- `quit()` 调用普通 `app.quit()`，不触发安装。
- 更新窗口启用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 使用 `update.cjs` Preload，禁止导航到其他地址。
- 再次打开时聚焦已有窗口，不创建重复窗口。
- 窗口约为 560×360，存在主窗口时设置为其非模态子窗口，并在 `ready-to-show` 前保持隐藏。

主进程注册：`updates:status`、`updates:open`、`updates:check`、`updates:download`、`updates:install`、`updates:skip`、`updates:quit`。

Preload 返回冻结对象。`subscribe()` 只监听 `updates:status-changed`，取消订阅时必须移除同一个 Listener。

### 6.3 更新窗口状态

- `idle`、`up-to-date`：显示当前版本和检查按钮；
- `checking`：显示不可操作的检查状态；
- `available`：下载、跳过、稍后提醒；
- `downloading`：进度，无安装按钮；
- `downloaded`：安装并重启；
- `error`：简短错误，可重试时显示重试；若属于已认证强制策略，同时显示退出；
- `unsupported`：明确说明开发版或未打包版本不支持真实更新。

更新窗口组件不得接收文件路径或任意 URL。强制流程转为错误状态时必须保留 `required: true` 和目标版本。

### 6.4 登录前、已登录和菜单入口

登录前 Shell 展示 `UpdateBadge`，不能遮挡拖拽区域。已登录后，通过第一方集成插件已有的 `sidebar.footer.action` 在账号入口旁增加更新按钮，不查询或修改 Harness DOM。

macOS 应用菜单和 Windows 自定义菜单增加“检查更新”。

`bootstrap()` 在主窗口创建后、登录恢复前构造 `UpdateManager`。安装准备调用显式工作区 Stop，关闭辅助窗口并刷新 Shell 更新偏好。`before-quit` 先停止更新 Timer，再执行已有 Runtime 退出流程。`src/main/index.ts` 只保留组合代码。

### 6.5 Build 配置与测试

Vite 增加 Update Preload 和 Update Renderer Entry。正式 CSP 保持不变；仅本地 Vite 页面可使用开发模式放宽配置。

```bash
npx vitest run test/update-window.test.ts test/update-api-contract.test.ts test/shell-preload-contract.test.ts test/windows-titlebar.test.ts test/desktop-integration-client.test.ts
npm run typecheck
```

### 停止点 B：人工 Fixture 验收

使用只在未打包 Electron 下生效的测试参数注入 Fake Update Source。人工验证全部状态、登录前入口、已登录入口、菜单入口、重试和强制更新退出。

验收标准：不会连接生产 GitHub；下载和安装按钮不会执行真实安装；“跳过这个版本”保存偏好并关闭窗口，随后手动检查仍能重新显示该版本；自动检查不打断下载或安装状态；控制台无错误；关闭后正常回到客户端。终端以 `Ctrl+C` 结束 Fixture 时，Electron、开发服务器和监听端口必须一同退出。

用户确认后提交：

```bash
git commit -m "feat(update): expose client update controls"
```

---

## 任务 7：生成、签名并校验完整发布产物

**涉及文件：** 四个发布脚本、`finalize-windows-release.mjs`、`build/update-release-policy.json`、生产公钥、相关测试和 `package.json`。

### 7.1 发布工具测试

Fixture 测试证明：

- 资产大小和 SHA512 来自实际文件；
- 资产按 `(platform, arch, kind, name)` 排序；
- JSON 结尾只有一个换行；
- 签名覆盖完全相同的原始字节；
- Core Runtime Tag/Commit 来自 `build/runtime-manifest.json`；
- 发布策略只来自严格策略文件，不存在默认策略；
- 策略版本、渠道必须与构建参数完全一致；
- 最低支持版本不得高于发布版本；
- macOS 元数据合并拒绝重复架构、版本不一致、缺失 blockmap 和错误 YAML；
- ZIP 必须包含可读中央目录；EXE 必须包含有效 DOS Header 和范围内 PE Signature；
- 零字节、错误架构、摘要/大小不一致、签名无效和版本不一致均失败。

完整正式资产集合：

```text
insight-mac-arm64.dmg
insight-mac-arm64.zip
insight-mac-arm64.zip.blockmap
insight-mac-x64.dmg
insight-mac-x64.zip
insight-mac-x64.zip.blockmap
insight-windows-x64-setup.exe
insight-windows-x64-setup.exe.blockmap
latest-mac.yml
latest.yml
insight-update.json
insight-update.json.sig
```

### 7.2 生成生产密钥

脚本要求显式 `--private-key`、`--public-key`，私钥权限为 `0600`。如果私钥目标位于仓库内，即使已忽略，也必须拒绝。

```bash
UPDATE_SIGNING_TEMP_DIR="$(mktemp -d)"
UPDATE_SIGNING_PRIVATE_KEY="$UPDATE_SIGNING_TEMP_DIR/update-signing-private.pem"
node scripts/generate-update-signing-keypair.mjs \
  --private-key "$UPDATE_SIGNING_PRIVATE_KEY" \
  --public-key build/update-signing-public.pem
```

Builder 只打包公钥：

```json
{
  "from": "build/update-signing-public.pem",
  "to": "update-signing-public.pem"
}
```

测试拒绝任何私钥资源。

### 7.3 显式发布策略

```json
{
  "schema": 1,
  "releaseVersion": "0.1.2",
  "channel": "stable",
  "mode": "optional",
  "minimumSupportedVersion": "0.1.1"
}
```

每次候选或正式发布前都要把 `releaseVersion`、`channel` 改成目标 Tag 对应值，其中 `releaseVersion` 不包含前导 `v`。发布脚本禁止复用不匹配的策略。要发布强制更新，必须先提交并审查 `mode: "required"` 和最低支持版本。

`build-update-release.mjs` 参数：

```text
--dir <release-assets>
--version <semver>
--channel candidate|stable
--shell-commit <40-hex>
--runtime-manifest <path>
--compatibility <path>
--policy <path>
--private-key <path>
```

### 7.4 密钥保存

创建受保护的 GitHub Environment：`desktop-release`。限制发布 Tag 和 Workflow；仓库套餐支持时启用 Required Reviewer。私钥保存为该 Environment 的 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`，不得保存为仓库级 Secret。

同时在 GitHub 和仓库外保存一份受访问控制的加密恢复副本。确认恢复副本后，在同一 Shell 中执行：

```bash
gh secret set --env desktop-release DESKTOP_UPDATE_SIGNING_PRIVATE_KEY < "$UPDATE_SIGNING_PRIVATE_KEY"
gh secret list --env desktop-release | grep '^DESKTOP_UPDATE_SIGNING_PRIVATE_KEY'
```

只有两个命令成功且恢复副本确认后，才能删除本机明文：

```bash
rm -f -- "$UPDATE_SIGNING_PRIVATE_KEY"
rmdir "$UPDATE_SIGNING_TEMP_DIR"
unset UPDATE_SIGNING_PRIVATE_KEY UPDATE_SIGNING_TEMP_DIR
```

### 7.5 验证与提交

```bash
npx vitest run test/build-update-release.test.ts test/merge-mac-update-metadata.test.ts test/verify-release-assets.test.ts test/finalize-windows-release.test.ts test/release.test.ts
git diff --check
git status --short
```

预期：测试通过；Git 状态和 Diff 不出现私钥。

用户确认后提交：

```bash
git commit -m "build(update): authenticate desktop release assets"
```

---

## 任务 8：隔离开发、候选和正式渠道

### 8.1 契约测试

```ts
expect(stable.build.extraMetadata.insightDesktopChannel).toBe('stable')
expect(candidate.appId).toBe('com.insight.desktop.candidate')
expect(candidate.productName).toBe('因赛AI Candidate')
expect(candidate.extraMetadata.insightDesktopChannel).toBe('candidate')
expect(development.appId).toBe('com.insight.desktop.dev')
expect(development.extraMetadata.insightDesktopChannel).toBe('development')
expect(development.publish).toBeNull()
```

新增：

- `package:candidate:mac:arm64`；
- `package:candidate:mac:x64`；
- `package:candidate:win`；
- `package:candidate:dir`。

全部使用 Candidate Config 和 `--publish never`。

### 8.2 实现

打包元数据统一改为 `insightDesktopChannel`。正式包内置 `stable`，候选和开发配置覆盖该值。未打包 Electron 始终返回 `development`；打包应用只接受三个固定值。只有 App ID 为 `com.insight.desktop` 的旧正式包可在缺少字段时按 `stable` 处理。

候选输出目录为 `dist-candidate`，产物名使用 `insight-candidate-${os}-${arch}.${ext}`，Windows 为 `insight-candidate-windows-${arch}-setup.${ext}`。

`userData`：

- 正式版：`insight-desktop`；
- 候选版：`insight-desktop-candidate`；
- 开发版：`insight-desktop-dev`。

### 8.3 验证

```bash
npx vitest run test/release.test.ts test/runtime.test.ts
npm run typecheck
npm run build
npm run package:candidate:dir
```

### 停止点 C：本地候选目录人工检查

确认：

- App ID、产品名、渠道和 `userData` 为 Candidate；
- 正式用户数据未被访问；
- 公钥存在于打包资源；
- 策略文件与下一次候选 Tag 匹配；
- Runtime Manifest 与 Lock 一致；
- Better Sidebar 和第一方集成插件已打包；
- 不包含私钥、本地源码路径或开发更新源。

用户确认后提交：

```bash
git commit -m "build(update): isolate desktop release channels"
```

---

## 任务 9：围绕 Windows 未签名包重建 GitHub Release Workflow

**涉及文件：** `.github/workflows/release.yml`、`scripts/verify-release-preflight.mjs`、`scripts/verify-release-workflow.mjs`、`test/release-preflight.test.ts`、`test/release-workflow-verifier.test.ts`、`test/release.test.ts`、`docs/client-build-runbook.md`。

### 9.1 增加低成本 release-preflight

任何 macOS 或 Windows 打包 Job 启动前，先在 Linux Runner 执行不打包预检：

- 解析正式 Tag 或 `candidate_tag`；
- 校验 Tag 格式和目标渠道；
- 校验 Package Version；
- 校验 `build/update-release-policy.json` 的 `releaseVersion`、`channel`、`mode` 和最低版本；
- 校验 `core-runtime.lock.json` 的格式、Runtime Tag 和三平台资产声明，不在预检阶段下载 Runtime；
- 运行不安装依赖的 workflow 拓扑校验和发布脚本语法检查；完整 Vitest 由本地门禁和常规 CI 负责，preflight 不加载 Rollup/esbuild；
- 输出将要构建的平台、版本、渠道和 Runtime Tag，不输出任何 Secret。

所有 Native Build Job 必须 `needs: release-preflight`。预检失败时不启动 macOS/Windows Runner，不浪费安装依赖和打包时间。

### 9.2 Workflow 契约测试

测试要求：

- 使用 `candidate_tag`，移除旧 `windows_prerelease_tag`；
- 存在 `release-preflight` 且所有打包 Job 依赖它；
- macOS 上传 arm64/x64 ZIP blockmap 和架构级 YAML；
- Windows 直接从 `windows-2022` 上传未签名 EXE、blockmap、`latest.yml`；
- 删除 `sign-windows`、UKey、Jsign、SafeNet、ModelScope、飞书和 `dshdesktop.com`；
- 只有 Publish Job 使用 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`；
- Publish Job 声明 `environment: desktop-release`；
- 显式传入 `build/update-release-policy.json`；
- macOS 上传前执行 `hdiutil verify`、`unzip -t`；Windows 上传前执行 `7z t`；
- Manifest 与完整资产校验发生在 Release 发布前；
- 正式 Publish 直接依赖两个 macOS Job 和 `windows-x64`；
- Candidate 标记为 Pre-release；
- 不使用 `--clobber` 覆盖已发布资产。

### 9.3 原生构建

正式与候选 macOS Job 在签名、公证、装订后执行：

```bash
hdiutil verify <dmg-path>
unzip -t <zip-path>
```

Windows Job 在最终 EXE、blockmap、YAML 生成后执行：

```powershell
7z t <installer-path>
```

验证失败时不得上传该 Job 的 Release 输入。

删除完整 `sign-windows` Job，不增加替代自托管 Runner。

### 9.4 原子发布

Publish Job：

- 声明 `environment: desktop-release`；
- 下载三个原生 Job 产物；
- 合并 macOS 元数据；
- 在 Runner Temp 中以 `0600` 写入 Environment 私钥；
- 显式传入 Release Policy；
- 构建并验证 Manifest 与签名；
- 创建草稿 Release；
- 上传完整且已验证的资产；
- 最后发布 Release；
- 在 `if: always()` 中删除 Runner 临时私钥。

已发布版本再次运行必须失败并提示创建新版本，不能修改旧 Release。

### 9.5 验证与提交

```bash
npx vitest run test/release-preflight.test.ts test/release-workflow-verifier.test.ts test/release.test.ts test/build-update-release.test.ts test/finalize-mac-release.test.ts test/merge-mac-update-metadata.test.ts test/verify-release-assets.test.ts test/finalize-windows-release.test.ts
npm run typecheck
git diff --check
```

更新构建手册，明确 Windows SmartScreen 属于当前预期；macOS 必须通过 Developer ID；两个平台都必须通过 Manifest、摘要、N 到 N+1 和数据保留验收。

用户确认后提交：

```bash
git commit -m "ci(update): publish verified desktop releases"
```

---

## 任务 10：正式发布前验证 UI 与候选更新

### 10.1 源码检查只完整运行一次

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

预期：内置 Core Runtime、第一方插件、默认 Profile、Shell Renderer 和 Update Renderer 都正确准备。

### 10.2 开发模式 Fixture UI

使用只在未打包 Electron 中生效的命令行参数启用 Fixture Update Source，覆盖 `idle`、`checking`、`available`、`downloading`、`downloaded`、`up-to-date`、`unsupported`、`error`。

预期：登录前和已登录入口打开同一更新窗口；Fixture 不能启用安装，也不能访问 GitHub 正式源。

### 10.3 发布 Candidate N

GitHub `release-preflight` 通过后才启动两个 macOS 架构和 Windows x64。下载完整资产，在本地再次运行发布验证脚本。

预期：Candidate Release 包含渠道专属资产和合法 Manifest 签名。

### 10.4 安装 Candidate N 并建立数据样本

在 macOS arm64 和 Windows x64：

1. 安装 Candidate N；
2. 登录；
3. 创建 Harness 会话；
4. 导入无害测试插件；
5. 验证 Better Sidebar 打开 Markdown/HTML；
6. 记录账号 Scope 和 `userData` 路径；
7. 正常退出。

Windows 可出现 SmartScreen；macOS 必须通过 Gatekeeper。

### 10.5 发布 Candidate N+1 并使用更新器安装

等待自动发现或手动点击“检查更新”，完成下载、校验、安装和重启。

两个平台必须确认：

- 客户端实际运行 N+1；
- Manifest 版本、Shell Commit 和 Core Runtime 与 Release 一致；
- 登录恢复正常；
- 多账号隔离正常；
- 原会话、导入插件和 Better Sidebar 正常；
- Windows 即使没有 Authenticode，也通过产品 Manifest 认证。

### 10.6 负向测试

使用私有 Fixture Source 测试：修改 Manifest 一字节、错误签名、错误平台、错误渠道、Tag/Manifest 版本不一致、下载文件摘要不一致、GitHub 不可用。

在测试 `userData` 中写入格式合法但签名伪造的强制策略缓存。重启后必须忽略并只删除该缓存，不能阻止登录/Core。

预期：任何无效产物都不能进入安装；当前版本继续可用；用户数据不变。

### 10.7 停止点 D 与记录

将 Candidate Tag、Workflow Run、安装路径、Shell Commit、Runtime 身份、`userData` 根目录和人工结果写入构建手册。

只有故障改变了未来门禁时才新增 `docs/incidents/` 记录；一次性失败不写冗长时间线。

用户确认后提交：

```bash
git commit -m "docs(update): record candidate update validation"
```

## 后续独立计划

任务 10 验收后，再按顺序单独设计：

1. 兼容版本回退：签名版本目录、数据 Schema 预检、元数据快照和隔离数据目录。
2. 可选官方插件目录：兼容声明和设备级安装，不得更新必需第一方插件。
3. 社区插件市场：评估定向采用 dshmarket、Fork 或更小的产品内管理器。
4. 国内更新镜像：只有 GitHub 下载证明确有问题时，才基于现有 `UpdateSource` 增加对象存储/CDN。
5. Windows Authenticode：分发量、企业策略或支持成本达到必要程度后再购买；届时继续保留产品级 Manifest 签名。

## 实施体验复审结论

本节是方案阶段审查，证据来自本文步骤、现有仓库脚本和历史构建问题，不代表更新器已完成运行测试。

| 维度 | 评分 | 证据 | 结论 |
| --- | ---: | --- | --- |
| 开始路径 | 8/10 | 四阶段路线与停止点 | 实施者无需先理解完整发布链即可从纯测试开始 |
| 增量反馈 | 9/10 | 任务 1 至 10 的聚焦命令 | 大部分错误能在打包前暴露 |
| 错误恢复 | 8/10 | 缓存失败开放、下载校验、安装准备失败 | 关键失败都说明保留内容和下一步动作 |
| 发布安全 | 9/10 | 签名 Manifest、版本绑定策略、Environment Secret | Windows 无证书阶段仍有独立信任链 |
| 构建效率 | 9/10 | `release-preflight`、本地 Fixture、四个停止点 | 避免把配置错误带入耗时原生打包 |
| 可维护性 | 8/10 | Shell 独占更新逻辑、Core 只提供锁定制品 | 后续业务开发不需要理解上游发布设施 |

综合评分：8.5/10。当前方案可以进入分阶段实施，但不得把任务 1 至任务 10 作为一次性大改提交。最先执行阶段 A；到每个停止点后先检查 Diff 和人工结果，再决定是否继续。

## 计划自检

- 覆盖范围：产品分支、三渠道隔离、macOS 签名、Windows 未签名更新、发布认证、登录前入口、数据保留、必需插件归属和上游定向采用均有对应任务。
- 类型一致性：`UpdateChannel`、`SignedReleaseManifest`、`UpdateSource`、`UpdateExecutor`、`UpdateManager`、`UpdateStatus`、`DesktopUpdateApi`、`DesktopUpdateWindowApi` 各自只定义一次。
- 强制策略安全：策略文件绑定发布版本和渠道；客户端缓存原始字节并在每次启动重新验签。
- 密钥安全：只提交公钥；私钥只保存在受保护 Environment 和加密恢复库；本机及 Runner 明文均有明确清理步骤。
- 构建效率：低成本 `release-preflight` 和本地 Fixture 位于原生打包之前；任何阶段失败都停止，不直接重跑 GitHub 打包。
- 明确延期：版本回退、公共插件市场、国内镜像和 Windows Authenticode 独立立项。
