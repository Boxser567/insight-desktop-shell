# Desktop OSS Update Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首个公开版本前，把 Candidate/Stable 的客户端自动更新源从 GitHub Releases 改为固定自有域名后的 OSS/CDN，并保留经过签名的整包更新、不可变发布、人工下载兜底和可验证的推广门禁。

**Architecture:** 每个渠道只读取一个短缓存 `current.json`，其内容只有 schema、channel 和 version。客户端从内置固定 Origin 确定性生成不可变版本目录，验证 Ed25519 产品 Manifest 后，再把 `electron-updater` Generic Provider 指向该目录；自动下载失败时，主进程从同一已验证目录打开对应 DMG/NSIS。GitHub Actions 每个平台只构建一次并创建 Draft，首版本地发布器下载并复验相同字节后写入 OSS，最后才更新渠道指针。

**Tech Stack:** Electron 43、electron-updater 6、TypeScript、Zod、Vitest、Node.js 发布脚本、GitHub Actions、GitHub CLI、Alibaba Cloud OSS/CDN、ossutil 2.3.0。

**执行状态（2026-09-08）：** Phase A（Task 1–4）、Phase B（Task 5–6）和 Phase C 的本地失败矩阵（Task 7）已完成编码与本地门禁；Task 8 的真实 GitHub Draft、OSS/CDN 暂存与推广、三平台安装、Candidate N→N+1 和 Stable 放行尚未执行。

## Global Constraints

- 当前无已发布客户端，不实现 GitHub 桥接版、旧协议迁移或客户端自动双源回退。
- 不新增自研下载器、增量补丁、历史版本列表、自动降级或复杂回滚编排。
- Windows 继续允许未签名 NSIS，但产品 Manifest、平台 YAML 版本和最终文件 SHA-512 三者必须一致。
- Development 继续禁用真实更新；测试只使用 test doubles 或测试进程创建的本地 HTTP server，不保留产品运行时 Fixture。
- 删除产品运行时的 `INSIGHT_UPDATE_FIXTURE`、`createUpdateFixture()` 和全部模拟更新场景；单元测试可保留 test doubles，本地端到端测试使用测试进程创建的 HTTP server，二者都不进入产品运行时。
- 登录前浮动更新入口和登录后账号旁更新入口默认不渲染；只有真实可信更新处于 `available`、`downloading`、`downloaded`、`installing`，或带可信整包目标的 `error` 状态时才显示。
- 工作必须在干净分支或独立 worktree 中执行；不得提交当前工作区已有的其他修改。
- 生产客户端只内置 `https://updates.insight-aigc.com`，不配置外部下载页、Bucket URL、GitHub URL 或任何 AccessKey。
- 客户端阶段不依赖 OSS Region 或写入身份；发布阶段使用私有 Bucket `insight-desktop-updates` 和只保存在发布者电脑上的专用 RAM 凭证。
- 只有已验证 Manifest 能生成整包下载地址；发现或验签失败时只允许重试，不能信任未验签的版本或文件名。
- 完成标准：本地测试和类型检查通过，rc.1→rc.2 在 macOS arm64、macOS x64、Windows x64 真实更新通过，Stable 干净/覆盖安装通过，自动下载失败时同源 DMG/NSIS 下载可用。

---

## Phase A：客户端更新协议与同源整包兜底

本阶段只改客户端和本地测试，不使用 OSS AccessKey，不要求 Bucket 中已经存在发布文件。完成 Task 1–4 后，生产客户端将不再访问 GitHub API，并能在验签后绑定 Generic Provider 与生成适配平台的整包 URL。

## Task 1：固定生产分发配置与 URL 推导规则

**Files:**

- Create: `build/update-distribution.json`
- Create: `src/main/update/update-environment.ts`
- Create: `test/update-environment.test.ts`
- Modify: `package.json`
- Modify: `test/release.test.ts`

- [x] **Step 1: 记录唯一生产 Origin**

在 `build/update-distribution.json` 写入已经部署的值，结构只能是：

```json
{
  "schema": 1,
  "updateOrigin": "https://updates.insight-aigc.com"
}
```

`updateOrigin` 必须只有 HTTPS Origin，不允许 path、query、fragment 或凭证。配置中不得出现 Bucket、Region、下载页、GitHub 或写入凭证。

- [x] **Step 2: 先写严格解析和路径推导测试**

覆盖合法配置、未知字段、HTTP、带 path/query/fragment、非法 channel/version，以及以下确定性结果：

```ts
releaseBaseUrl('stable', '0.1.2')
// https://updates.example.test/desktop/releases/v0.1.2/

currentPointerUrl('candidate')
// https://updates.example.test/desktop/candidate/current.json
```

测试中只使用 `.example.test`，不能读取生产网络。

- [x] **Step 3: 实现单一配置解析器**

`update-environment.ts` 导出：

```ts
export interface UpdateDistribution {
  updateOrigin: URL
  currentPointerUrl(channel: ReleaseUpdateChannel): URL
  releaseBaseUrl(channel: ReleaseUpdateChannel, version: string): URL
  artifactUrl(channel: ReleaseUpdateChannel, version: string, name: string): URL
}

export function parseUpdateDistribution(value: unknown): UpdateDistribution
```

Candidate 只允许 `X.Y.Z-rc.N`，Stable 只允许 `X.Y.Z`。`artifactUrl()` 只接受安全 basename；路径通过已验证字段生成，不能接受远端返回的 URL。

- [x] **Step 4: 把配置作为只读资源打包**

在 `package.json` 的 `build.extraResources` 中把该文件映射到 `update-distribution.json`。更新 `test/release.test.ts`，证明公钥和分发配置均存在、私钥不进入应用。

- [x] **Step 5: 运行聚焦验证并提交**

Run: `npm test -- test/update-environment.test.ts test/release.test.ts`

Run: `npm run typecheck`

Expected: 全部通过，配置错误在启动更新管理器前失败。

Commit: `git commit -m "feat: define desktop update distribution"`

## Task 2：实现最小 Generic UpdateSource

**Files:**

- Create: `src/main/update/generic-release-source.ts`
- Create: `test/generic-release-source.test.ts`
- Modify: `src/main/update/update-source.ts`
- Modify: `src/main/update/release-manifest.ts`
- Modify: `test/update-manifest.test.ts`

- [x] **Step 1: 先写渠道指针与网络边界测试**

覆盖：

- `current.json` 只接受 `{ schemaVersion: 1, channel, version }`，拒绝 URL 和未知字段；
- 指针 channel 与客户端 channel 必须一致；
- Manifest 版本必须等于指针版本；
- 404/5xx、无效 JSON、错误签名、跨 Origin 重定向和非预期最终路径全部失败关闭；
- 指针请求发送 `Cache-Control: no-cache`，不可变 Manifest/签名不依赖远端列表；
- Manifest 的 artifact `name` 必须是安全 basename，拒绝 `/`、`\\`、`..` 和控制字符；同一 platform/arch/kind 只能有一个产物。

- [x] **Step 2: 收窄 UpdateSource 返回值**

将当前未被消费的 `artifactUrls` 删除，并为强制更新恢复路径增加纯函数式目录解析：

```ts
export interface ResolvedRelease {
  manifest: SignedReleaseManifest
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
  releaseBaseUrl: URL
  manualInstallerUrl: URL
}

export interface UpdateSource {
  resolve(channel: ReleaseUpdateChannel, target: UpdateTarget): Promise<ResolvedRelease>
  releaseBaseUrl(channel: ReleaseUpdateChannel, version: string): URL
  manualInstallerUrl(manifest: SignedReleaseManifest, target: UpdateTarget): URL
}
```

- [x] **Step 3: 实现 GenericReleaseSource**

构造函数只接收 `UpdateDistribution`、`publicKeyPem` 和可注入 `fetch`。流程固定为 pointer → 派生 version base → manifest/signature → Ed25519 验证 → 从目标产物选择 DMG/NSIS 并派生 `manualInstallerUrl`；不列举 OSS，不访问 GitHub，不接受远端 URL。

所有 fetch 使用 `redirect: 'follow'` 后检查 `response.url` 的 Origin 和精确路径。响应非 2xx 时返回简短用户错误，不在错误信息输出凭证或完整响应体。

- [x] **Step 4: 加固 Manifest 文件名与整包选择**

在 `release-manifest.ts` 的 Zod schema 中把 `name` 限制为一个安全文件名，并拒绝重复的 platform/arch/kind。新增：

```ts
export function selectManualInstaller(
  manifest: SignedReleaseManifest,
  target: UpdateTarget
): ReleaseArtifact
```

macOS 只返回当前架构的唯一 `dmg`，Windows x64 只返回唯一 `nsis`。现有发布脚本产生的 DMG/ZIP/EXE/blockmap/YAML 名必须全部通过。

- [x] **Step 5: 运行聚焦验证并提交**

Run: `npm test -- test/generic-release-source.test.ts test/update-manifest.test.ts`

Run: `npm run typecheck`

Expected: 所有不可信指针和重定向用例失败关闭，合法签名路径通过。

Commit: `git commit -m "feat: resolve signed updates from generic origin"`

## Task 3：把可信版本目录绑定到 electron-updater

**Files:**

- Modify: `src/main/update/update-executor.ts`
- Modify: `src/main/update/update-manager.ts`
- Modify: `src/main/index.ts`
- Modify: `test/update-manager.test.ts`
- Delete: `src/main/update/github-release-source.ts`
- Delete: `test/github-release-source.test.ts`
- Delete: `src/main/update/update-fixture.ts`

- [x] **Step 1: 为 executor feed 绑定写失败测试**

`UpdateExecutor` 增加：

```ts
useRelease(baseUrl: URL): void
```

断言 `ElectronUpdateExecutor` 在检查前执行：

```ts
updater.setFeedURL({ provider: 'generic', url: baseUrl.href })
```

并继续保持 `autoDownload = false`、`allowDowngrade = false` 和 Candidate prerelease 设置。

- [x] **Step 2: 覆盖正常检查与强制更新恢复**

为 `UpdateManager` 添加测试，证明：

- source 验证成功后先 `useRelease()`，再 `check()`；
- Manifest/YAML 版本不一致仍失败；
- 重启从 `required-policy.json` 恢复时，使用 `source.releaseBaseUrl(channel, version)` 重建 feed，并使用 `source.manualInstallerUrl(manifest, target)` 恢复同源整包入口；
- 恢复后用户立即点击下载，不依赖上一次进程内存 URL；
- 跳过、无更新、下载摘要错误和差分失败整包回退的现有行为不回归。

- [x] **Step 3: 实现 manager/executor 改造**

只在签名 Manifest 已验证或可信强制策略已恢复后调用 `useRelease()`。确认候选版本高于当前版本且没有被跳过后，先保存已验证 Manifest、`manualInstallerUrl` 和 feed，再调用 executor 检查 YAML；这样平台更新器失败时仍可提供由产品 Manifest 认证的整包。不要把 update Origin 或整包 URL 暴露给渲染进程。

- [x] **Step 4: 切换生产构造并删除 GitHub 客户端源**

`src/main/index.ts` 从打包资源读取并解析 `update-distribution.json`，使用 `GenericReleaseSource`。产品运行时的 Fixture、环境变量注入和模拟执行器全部删除。

删除 GitHub API source 和对应测试，避免死代码形成第二套生产发现逻辑。GitHub 仍只存在于发布工作流。

- [x] **Step 5: 运行聚焦验证并提交**

Run: `npm test -- test/update-manager.test.ts test/generic-release-source.test.ts test/update-state.test.ts`

Run: `npm run typecheck`

Expected: Generic feed 在每次相关 check/download 前已绑定；强制更新重启恢复测试通过。

Commit: `git commit -m "feat: bind updater to verified release directory"`

## Task 4：增加同源整包下载兜底

**Files:**

- Modify: `src/shared/update-contracts.ts`
- Modify: `src/shared/update-api.ts`
- Modify: `src/main/update/update-manager.ts`
- Modify: `src/main/update/update-ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/update.ts`
- Modify: `src/preload/shell.ts`
- Modify: `src/preload/harness.ts`
- Modify: `src/renderer/src/update-view-model.ts`
- Modify: `src/renderer/src/UpdateApp.tsx`
- Modify: `src/renderer/src/UpdateBadge.tsx`
- Modify: `src/renderer/src/update.css`
- Modify: `packages/insight-desktop-integration/src/client/components.tsx`
- Modify: `test/desktop-integration-client.test.ts`
- Modify: `test/update-api-contract.test.ts`
- Modify: `test/update-manager.test.ts`
- Modify: `test/update-state.test.ts`
- Modify: `test/update-window.test.ts`
- Modify: `test/shell-preload-contract.test.ts`

- [x] **Step 1: 先写 IPC、状态与视图模型测试**

在 `DesktopUpdateApi` 增加 `downloadFullInstaller(): Promise<void>`，新增 `updates:download-full-installer`。测试必须证明：

- 只有现有可信 main frame 可以调用；
- IPC 不接收 URL、version、文件名或 channel 参数；
- 只有 `GenericReleaseSource` 已成功验证 Manifest 并选出当前平台 DMG/NSIS 后，状态才标记 `manualInstallerAvailable: true`；
- `available` 状态允许用户直接下载整包；自动下载失败后仍保留该入口；
- 发现失败、验签失败和 packaged unsupported 状态不显示整包入口；
- required error 仍保留“重试”“退出”，若已有可信安装包地址则同时显示整包入口。

- [x] **Step 2: 扩展最小视图模型**

不要把第三个动作塞入现有 primary/secondary 互斥逻辑。增加一个独立恢复动作：

```ts
export interface UpdateViewModel {
  title: string
  detail: string
  primary?: UpdateViewAction
  secondary?: UpdateViewAction
  recovery?: 'download-full-installer'
  busy: boolean
}
```

`available`、可信下载失败和可信 required error 状态显示“下载完整安装包”。发现或验签失败只显示“重试”，因为客户端尚无可信版本和文件名。

`UpdateBadge` 和 Harness `UpdateButton` 共用同一纯函数可见性规则：`idle`、`checking`、`up-to-date`、`unsupported` 和没有可信目标的普通 `error` 返回 `null`；真实可用、下载中、已下载、安装中和可信 required/error 才渲染。按钮标题包含 `availableVersion`，点击只打开真实更新窗口，不主动制造状态。

`UpdateStatus` 的 `error` 分支增加 `manualInstallerAvailable: boolean`；`available` 分支天然表示已经存在可信整包地址。状态中不得出现 URL 或文件名。

- [x] **Step 3: 主进程只打开已验证整包 URL**

`UpdateManagerOptions` 增加 `openExternal(url: string): Promise<void>`。`UpdateManager` 只保存 `GenericReleaseSource` 在验签并选择当前平台 DMG/NSIS 后返回的 `manualInstallerUrl`，并提供不向 renderer 暴露 URL 的 `downloadFullInstaller(): Promise<void>`。更新目标变化、被跳过或确认无更新时必须清除旧 URL；普通检查开始时清除旧 URL，但可信强制更新缓存仍有效时保留并从已签名 Manifest 重建。

`registerUpdateIpc` 只调用 manager 的零参数方法；不得接收或转发 renderer 提供的 URL，也不得从未验签的 `current.json` 直接构造下载。

- [x] **Step 4: 同步三个 preload**

`update.ts`、`shell.ts`、`harness.ts` 暴露相同零参数方法，保持 API 对象冻结和订阅清理行为。按钮文案固定为“下载完整安装包”。

- [x] **Step 5: 运行聚焦验证并提交**

Run: `npm test -- test/update-manager.test.ts test/update-state.test.ts test/update-api-contract.test.ts test/update-window.test.ts test/shell-preload-contract.test.ts`

Run: `npm run typecheck`

Expected: 已验证发布可打开同一不可变目录的 DMG/NSIS；发现或验签失败不提供不可信下载；任意 URL 注入不可达。

Commit: `git commit -m "feat: add verified full installer fallback"`

## Phase B：发布资产规范与本地 OSS 发布器

只有 Phase A 全部通过后才执行本阶段。Task 5 固定 GitHub Release Assets、Manifest、YAML 和渠道指针契约；Task 6 再实现后置的本地人工同步，不把 OSS AccessKey 放入 GitHub。

## Task 5：版本化全部发布资产并生成唯一渠道指针

**Files:**

- Modify: `package.json`
- Modify: `electron-builder.candidate.cjs`
- Modify: `scripts/finalize-mac-release.mjs`
- Modify: `scripts/finalize-windows-release.mjs`
- Modify: `scripts/build-update-release.mjs`
- Modify: `scripts/verify-release-assets.mjs`
- Create: `scripts/build-update-pointer.mjs`
- Modify: `test/finalize-mac-release.test.ts`
- Modify: `test/finalize-windows-release.test.ts`
- Modify: `test/build-update-release.test.ts`
- Modify: `test/verify-release-assets.test.ts`
- Create: `test/build-update-pointer.test.ts`
- Modify: `test/release.test.ts`

- [x] **Step 1: 把期望文件名写进测试**

Stable 与 Candidate 均采用 `insight-<version>-...`；Candidate 由版本中的 `-rc.N` 和签名 Manifest 的 channel 区分，不额外增加产品或文件名前缀。例如：

```text
insight-0.1.2-mac-arm64.zip
insight-0.1.2-windows-x64-setup.exe
insight-0.1.2-rc.2-mac-x64.dmg
```

YAML 中只允许相对 basename，且必须与签名 Manifest 中相同 target/kind 的文件名一致。

- [x] **Step 2: 更新 electron-builder 与 finalize 脚本**

在 artifactName 中使用 `${version}` 宏。把 macOS finalize CLI 改为显式接收 release dir、channel、version、arch 后自行推导 ZIP 名，避免 npm script 硬编码无版本文件名；Windows finalize 继续显式校验传入版本和唯一安装器。

- [x] **Step 3: 更新 Manifest 构建/验证清单**

`artifactDefinitions(channel, version)` 成为两份脚本共享的唯一命名规则；若不抽共享模块能保持脚本简单，则用契约测试锁定两份输出，不额外创建抽象层。

- [x] **Step 4: 实现 current.json 生成与单调性校验**

`build-update-pointer.mjs` 接收 `--channel`、`--version`、`--output`，只输出：

```json
{"schemaVersion":1,"channel":"stable","version":"0.1.2"}
```

另支持 `--current <path>`：文件不存在表示首发；存在时必须严格同渠道且 `next > current`。拒绝重复版本、降级、Candidate/Stable 格式混用和未知字段。

- [x] **Step 5: 运行发布脚本测试并提交**

Run: `npm test -- test/finalize-mac-release.test.ts test/finalize-windows-release.test.ts test/build-update-release.test.ts test/verify-release-assets.test.ts test/build-update-pointer.test.ts test/release.test.ts`

Run: `npm run typecheck`

Expected: 所有发布产物带版本号，YAML/Manifest/指针严格一致。

Commit: `git commit -m "feat: version desktop release assets"`

## Task 6：实现本地 OSS 暂存与推广工具（客户端完成后执行）

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `scripts/verify-release-workflow.mjs`
- Modify: `test/release-workflow-verifier.test.ts`
- Modify: `test/release.test.ts`
- Create: `scripts/publish-update-to-oss.mjs`
- Create: `test/publish-update-to-oss.test.ts`
- Create: `scripts/verify-distribution-assets.mjs`
- Create: `test/verify-distribution-assets.test.ts`

- [x] **Step 1: 先把 GitHub 与 OSS 身份隔离写入测试**

断言：

- workflow 只有 `contents: write`，没有 `id-token: write`、OSS AccessKey、OSS Profile 或 `ossutil`；
- `publish` 依赖 preflight 与三个原生 job，使用 `desktop-release`；
- workflow 的同 tag 并发组不取消运行中的构建；本地发布器拒绝同机并发执行；
- GitHub Draft 被创建并上传全部已验证资产，但 workflow 不再执行 `--draft=false`；
- GitHub Actions 不具备 OSS 写权限，本地发布器是首版唯一 OSS 写入方。

- [x] **Step 2: 固定本地发布器命令边界**

`publish-update-to-oss.mjs` 只接受两个子命令：

```bash
node scripts/publish-update-to-oss.mjs stage \
  --tag v0.1.2-rc.2 \
  --bucket insight-desktop-updates \
  --origin https://updates.insight-aigc.com \
  --profile desktop-updates-publisher

node scripts/publish-update-to-oss.mjs promote \
  --tag v0.1.2-rc.2 \
  --bucket insight-desktop-updates \
  --origin https://updates.insight-aigc.com \
  --profile desktop-updates-publisher \
  --confirm-version 0.1.2-rc.2
```

CLI 拒绝未知参数、非法 tag/channel、非固定 Origin、其他 Bucket 和不匹配的确认版本。调用 `gh`、`ossutil` 和验证脚本时使用 `spawn`/`execFile` 风格的参数数组与 `shell: false`，不拼接 Shell 命令。

发布器固定要求 `ossutil 2.3.0`，每次调用都传递 `--profile desktop-updates-publisher --ignore-env-var`，只从本机 ossutil Profile 读取 RAM AccessKey 和 Region。脚本不得接收、读取或打印 AccessKey 参数、仓库 `.env` 或 `OSS_ACCESS_KEY_*` 环境变量。

- [x] **Step 3: 实现不可变版本目录暂存**

`stage` 创建权限为 `0700` 的临时目录，通过已登录的 `gh` 下载指定 Draft Release 的全部 Assets，然后执行现有 `verify-release-assets.mjs`。下载结果必须与签名 Manifest 文件集完全一致；Git tag 自动生成的源码 ZIP/TAR 不属于输入。

对每个已验证文件调用 `ossutil api put-object --bucket insight-desktop-updates --key "desktop/releases/v<version>/<basename>" --body "file://<absolute-local-path>"`，设置：

```text
--forbid-overwrite true
--cache-control public,max-age=31536000,immutable
```

同时按扩展名设置固定 Content-Type；DMG/EXE 额外设置 `Content-Disposition: attachment; filename="<安全 basename>"`。`current.json` 使用 `application/json; charset=utf-8` 和 `public,max-age=60,must-revalidate`。

重跑时先读取远端完整文件集。只有文件集和 Manifest 摘要全部相同才跳过上传并继续；任何缺失或差异都失败，不删除、不覆盖。无论成功或失败都删除临时下载目录，但保留不含凭证的摘要报告。

- [x] **Step 4: 从最终 CDN 验证分发字节**

`verify-distribution-assets.mjs` 读取本地签名 Manifest 和固定 `releaseBaseUrl`，逐个验证 GET/HEAD 大小、SHA-512、`Accept-Ranges`/206、缓存头、Manifest/签名和平台 YAML。测试使用本地 HTTP server 覆盖截断、错误摘要、无 Range、错误缓存和重定向 Origin。

- [x] **Step 5: 实现显式推广与唯一指针提交**

`promote` 重新下载并验证 Draft Assets，从 CDN 完整复验版本目录，然后直接从 OSS 读取 `desktop/<channel>/current.json`。NotFound 只在渠道首发时允许；已存在时必须通过 `build-update-pointer.mjs --current` 验证严格递增。

确认参数、远端版本和本地签名 Manifest 完全一致后，按以下固定顺序执行：

1. 使用 `gh release edit <tag> --draft=false` 公开已验证 Draft；
2. 重新读取 OSS 权威指针并重复单调性检查；
3. 使用 `ossutil api put-object` 写入 `desktop/<channel>/current.json`，设置 `Cache-Control: public,max-age=60,must-revalidate`；
4. 在 120 秒有界轮询内确认 CDN 指针收敛，再重跑远端 Manifest/YAML/Range 验证；
5. 输出不含凭证的 JSON 发布记录。

只有第 3 步允许替换现有对象，其他上传全部禁止覆盖。发布只允许在指定发布者电脑单进程执行；首版不实现跨机器并发发布、自动回退或 CDN 刷新 API。

- [x] **Step 6: 运行静态与脚本验证并提交**

Run: `npm test -- test/release-workflow-verifier.test.ts test/release.test.ts test/publish-update-to-oss.test.ts test/verify-distribution-assets.test.ts`

Run: `node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json`

Run: `npm run typecheck`

Expected: workflow 不含 OSS Secret，发布器拒绝不可信输入和覆盖，`current.json` 是唯一最后提交点。

Commit: `git commit -m "feat: publish verified desktop updates from local host"`

## Phase C：真实更新闭环与首发放行

## Task 7：完成端到端失败矩阵与回归门禁

**Files:**

- Modify: `test/update-manager.test.ts`
- Modify: `test/update-window.test.ts`
- Create: `test/generic-update-flow.test.ts`
- Modify: `docs/client-build-runbook.md`
- Modify: `docs/release-runbook.md`

- [x] **Step 1: 建立本地 Generic Provider 测试 Origin**

测试代码使用临时本地 HTTP server 提供 pointer、签名 Manifest、YAML 和假安装包；该 server 不由产品代码或环境变量创建。把 fetch、executor 和下载完成事件串起来，覆盖一次完整检查→可用→下载→SHA-512→已下载状态。

- [x] **Step 2: 覆盖必须失败关闭的场景**

至少覆盖：断网、403、404、500、指针旧缓存、跨 Origin 重定向、错误签名、错误渠道、Manifest/YAML 版本不一致、缺失 blockmap、下载截断、最终摘要错误、强制更新重启恢复、重复 check/download、已验签后的同源整包动作，以及未验签时不提供整包动作。

- [x] **Step 3: 证明当前版本不受破坏**

所有失败用例必须断言 `quitAndInstall()` 未调用，当前安装目录未修改，仅删除不可信下载缓存；强制更新只保留可信策略缓存。

- [x] **Step 4: 运行完整本地门禁**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: 全部通过；Development 构建不请求生产更新源。

- [x] **Step 5: 根据最终命令同步 Runbook 并提交**

只修正实际实现与文档之间的命令、job 名、Environment 名和证据字段；不要扩展本文明确延后的能力。

Commit: `git commit -m "test: cover generic desktop update recovery"`

## Task 8：首发候选演练与 Stable 放行

**Files:**

- Modify: `docs/client-build-runbook.md`
- Modify: `docs/release-runbook.md`
- Create: `docs/releases/desktop-0.1.2.md`

- [ ] **Step 1: 发布并验收 rc.1**

从受保护 workflow 暂存当前仓库版本 `0.1.2-rc.1`，在 macOS arm64、macOS x64、Windows x64 完成干净安装；随后推广 Candidate 指针，为 N→N+1 准备真实已安装基线。记录 OSS/CDN、GitHub Draft/Release、摘要、签名、公证和用户数据目录。

- [ ] **Step 2: 发布并验收 rc.2 的真实更新**

先批准 rc.1 Candidate 指针，再暂存并验收 rc.2 的确切安装包。推广 rc.2 Candidate 指针后，从已安装 rc.1 在客户端内完成检查、下载、进度、校验、安装和重启。另保留已验证 rc.2 Manifest，人为让 `electron-updater` 自动下载失败，确认客户端可从同一版本目录打开适配架构的 DMG/NSIS；完全禁用更新 Origin 时应安全失败且不显示虚假的可下载状态。

- [ ] **Step 3: 验收确切 Stable 制品**

对 `0.1.2` OSS 版本目录/GitHub Draft 的确切 DMG 与 NSIS 完成干净安装和覆盖安装；不得用本地重建包替代。

- [ ] **Step 4: 首次推广 Stable**

确认 Stable `current.json` 尚不存在，执行带 `--confirm-version 0.1.2` 的本地推广。验证 120 秒内从最终 CDN 读取到 `0.1.2`，三平台检查均返回已是最新或正确候选状态，确切 DMG/NSIS URL 可下载。

- [ ] **Step 5: 收口发布记录**

在 release record 中写入所有证据与失败范围。只有全部验收完成，才把 Runbook 的状态从“代码完成、真实发布待验收”更新为“首发闭环已验证”。

Commit: `git commit -m "docs: record first OSS desktop release"`

---

## 最终自检

- [x] `current.json` 只有 schema/channel/version，客户端不接受远端 URL。
- [x] 强制更新缓存恢复后可以重建 Generic Provider feed。
- [x] OSS 版本目录与 GitHub Release 永不覆盖；相同完整字节只做幂等复用。
- [x] GitHub 公开早于渠道指针，`current.json` 是唯一最后提交点。
- [x] 客户端没有 GitHub API 自动发现、双源回退或任意 URL IPC。
- [x] 客户端只内置 `https://updates.insight-aigc.com`，已验签后才能生成同源 DMG/NSIS 地址。
- [x] GitHub Actions 不保存 OSS AccessKey，本地发布器只读取指定 ossutil Profile。
- [ ] Candidate rc.1→rc.2 与 Stable 干净/覆盖安装均有真实记录。
