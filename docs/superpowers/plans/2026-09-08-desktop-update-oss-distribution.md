# Desktop OSS Update Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首个公开版本前，把 Candidate/Stable 的客户端自动更新源从 GitHub Releases 改为固定自有域名后的 OSS/CDN，并保留经过签名的整包更新、不可变发布、人工下载兜底和可验证的推广门禁。

**Architecture:** 每个渠道只读取一个短缓存 `current.json`，其内容只有 schema、channel 和 version。客户端从内置固定 Origin 确定性生成不可变版本目录，验证 Ed25519 产品 Manifest 后，再把 `electron-updater` Generic Provider 指向该目录。CI 每个平台只构建一次，先暂存 OSS 与 GitHub Draft，人工验收后才公开 GitHub 并最后更新渠道指针。

**Tech Stack:** Electron 43、electron-updater 6、TypeScript、Zod、Vitest、Node.js 发布脚本、GitHub Actions、Alibaba Cloud OSS/CDN、GitHub OIDC + STS、ossutil 2.3.0。

---

## 实施边界与完成标准

- 当前无已发布客户端，不实现 GitHub 桥接版、旧协议迁移或客户端自动双源回退。
- 不新增自研下载器、增量补丁、历史版本列表、自动降级或复杂回滚编排。
- Windows 继续允许未签名 NSIS，但产品 Manifest、平台 YAML 版本和最终文件 SHA-512 三者必须一致。
- Development 继续禁用真实更新；Fixture 不能访问生产域名或执行真实安装。
- 工作必须在干净分支或独立 worktree 中执行；不得提交当前工作区已有的其他修改。
- 首个生产 Candidate 开始前，负责人必须提供并实际部署两个具体 URL：固定更新 Origin 和与其独立部署的产品官网下载页。未提供时停在 Task 1，不写假域名、不回退 GitHub 自动更新。
- 基础设施必须提供 OSS Bucket/Region、CDN CNAME/HTTPS、RAM OIDC Provider、发布 Role ARN、GitHub `desktop-release` 与 `desktop-release-promotion` Environment。
- 完成标准：本地测试和类型检查通过，rc.1→rc.2 在 macOS arm64、macOS x64、Windows x64 真实更新通过，Stable 干净/覆盖安装通过，更新故障时固定官网下载入口可用。

## Task 1：固定生产分发配置与 URL 推导规则

**Files:**

- Create: `build/update-distribution.json`
- Create: `src/main/update/update-environment.ts`
- Create: `test/update-environment.test.ts`
- Modify: `package.json`
- Modify: `test/release.test.ts`

- [ ] **Step 1: 等待并记录真实生产 URL**

在 `build/update-distribution.json` 写入已经部署的值，结构只能是：

```json
{
  "schema": 1,
  "updateOrigin": "https://实际更新域名",
  "downloadPageUrl": "https://实际产品官网/下载页"
}
```

`updateOrigin` 必须只有 HTTPS Origin，不允许 path、query、fragment 或凭证；`downloadPageUrl` 必须是 HTTPS 页面 URL，且 Origin 不得等于更新 Origin。

- [ ] **Step 2: 先写严格解析和路径推导测试**

覆盖合法配置、未知字段、HTTP、带 path/query/fragment、同源兜底页、非法 channel/version，以及以下确定性结果：

```ts
releaseBaseUrl('stable', '0.1.2')
// https://updates.example.test/desktop/releases/v0.1.2/

currentPointerUrl('candidate')
// https://updates.example.test/desktop/candidate/current.json
```

测试中只使用 `.example.test`，不能读取生产网络。

- [ ] **Step 3: 实现单一配置解析器**

`update-environment.ts` 导出：

```ts
export interface UpdateDistribution {
  updateOrigin: URL
  downloadPageUrl: URL
  currentPointerUrl(channel: ReleaseUpdateChannel): URL
  releaseBaseUrl(channel: ReleaseUpdateChannel, version: string): URL
}

export function parseUpdateDistribution(value: unknown): UpdateDistribution
```

Candidate 只允许 `X.Y.Z-rc.N`，Stable 只允许 `X.Y.Z`。路径通过已验证字段生成，不能接受远端返回的 URL。

- [ ] **Step 4: 把配置作为只读资源打包**

在 `package.json` 的 `build.extraResources` 中把该文件映射到 `update-distribution.json`。更新 `test/release.test.ts`，证明公钥和分发配置均存在、私钥不进入应用。

- [ ] **Step 5: 运行聚焦验证并提交**

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

- [ ] **Step 1: 先写渠道指针与网络边界测试**

覆盖：

- `current.json` 只接受 `{ schemaVersion: 1, channel, version }`，拒绝 URL 和未知字段；
- 指针 channel 与客户端 channel 必须一致；
- Manifest 版本必须等于指针版本；
- 404/5xx、无效 JSON、错误签名、跨 Origin 重定向和非预期最终路径全部失败关闭；
- 指针请求发送 `Cache-Control: no-cache`，不可变 Manifest/签名不依赖远端列表；
- Manifest 的 artifact `name` 必须是安全 basename，拒绝 `/`、`\\`、`..` 和控制字符。

- [ ] **Step 2: 收窄 UpdateSource 返回值**

将当前未被消费的 `artifactUrls` 删除，并为强制更新恢复路径增加纯函数式目录解析：

```ts
export interface ResolvedRelease {
  manifest: SignedReleaseManifest
  manifestBytes: Uint8Array
  signatureBytes: Uint8Array
  releaseBaseUrl: URL
}

export interface UpdateSource {
  resolve(channel: ReleaseUpdateChannel, target: UpdateTarget): Promise<ResolvedRelease>
  releaseBaseUrl(channel: ReleaseUpdateChannel, version: string): URL
}
```

- [ ] **Step 3: 实现 GenericReleaseSource**

构造函数只接收 `UpdateDistribution`、`publicKeyPem` 和可注入 `fetch`。流程固定为 pointer → 派生 version base → manifest/signature → Ed25519 验证；不列举 OSS，不访问 GitHub，不接受远端 URL。

所有 fetch 使用 `redirect: 'follow'` 后检查 `response.url` 的 Origin 和精确路径。响应非 2xx 时返回简短用户错误，不在错误信息输出凭证或完整响应体。

- [ ] **Step 4: 加固 Manifest 文件名**

在 `release-manifest.ts` 的 Zod schema 中把 `name` 限制为一个安全文件名。现有发布脚本产生的 DMG/ZIP/EXE/blockmap/YAML 名必须全部通过。

- [ ] **Step 5: 运行聚焦验证并提交**

Run: `npm test -- test/generic-release-source.test.ts test/update-manifest.test.ts`

Run: `npm run typecheck`

Expected: 所有不可信指针和重定向用例失败关闭，合法签名路径通过。

Commit: `git commit -m "feat: resolve signed updates from generic origin"`

## Task 3：把可信版本目录绑定到 electron-updater

**Files:**

- Modify: `src/main/update/update-executor.ts`
- Modify: `src/main/update/update-manager.ts`
- Modify: `src/main/update/update-fixture.ts`
- Modify: `src/main/index.ts`
- Modify: `test/update-manager.test.ts`
- Delete: `src/main/update/github-release-source.ts`
- Delete: `test/github-release-source.test.ts`

- [ ] **Step 1: 为 executor feed 绑定写失败测试**

`UpdateExecutor` 增加：

```ts
useRelease(baseUrl: URL): void
```

断言 `ElectronUpdateExecutor` 在检查前执行：

```ts
updater.setFeedURL({ provider: 'generic', url: baseUrl.href })
```

并继续保持 `autoDownload = false`、`allowDowngrade = false` 和 Candidate prerelease 设置。

- [ ] **Step 2: 覆盖正常检查与强制更新恢复**

为 `UpdateManager` 添加测试，证明：

- source 验证成功后先 `useRelease()`，再 `check()`；
- Manifest/YAML 版本不一致仍失败；
- 重启从 `required-policy.json` 恢复时，使用 `source.releaseBaseUrl(channel, version)` 重建 feed；
- 恢复后用户立即点击下载，不依赖上一次进程内存 URL；
- 跳过、无更新、下载摘要错误和差分失败整包回退的现有行为不回归。

- [ ] **Step 3: 实现 manager/executor 改造**

只在签名 Manifest 已验证或可信强制策略已恢复后调用 `useRelease()`。不要把 update Origin 暴露给渲染进程。

- [ ] **Step 4: 切换生产构造并删除 GitHub 客户端源**

`src/main/index.ts` 从打包资源读取并解析 `update-distribution.json`，使用 `GenericReleaseSource`。Fixture 继续使用内存源并实现 `releaseBaseUrl()`。

删除 GitHub API source 和对应测试，避免死代码形成第二套生产发现逻辑。GitHub 仍只存在于发布工作流。

- [ ] **Step 5: 运行聚焦验证并提交**

Run: `npm test -- test/update-manager.test.ts test/generic-release-source.test.ts test/update-state.test.ts`

Run: `npm run typecheck`

Expected: Generic feed 在每次相关 check/download 前已绑定；强制更新重启恢复测试通过。

Commit: `git commit -m "feat: bind updater to verified release directory"`

## Task 4：增加固定官网下载兜底

**Files:**

- Modify: `src/shared/update-api.ts`
- Modify: `src/main/update/update-ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/update.ts`
- Modify: `src/preload/shell.ts`
- Modify: `src/preload/harness.ts`
- Modify: `src/renderer/src/update-view-model.ts`
- Modify: `src/renderer/src/UpdateApp.tsx`
- Modify: `src/renderer/src/update.css`
- Modify: `test/update-api-contract.test.ts`
- Modify: `test/update-window.test.ts`
- Modify: `test/shell-preload-contract.test.ts`

- [ ] **Step 1: 先写 IPC 与视图模型测试**

在 `DesktopUpdateApi` 增加 `openDownloadPage(): Promise<void>`，新增 `updates:open-download-page`。测试必须证明：

- 只有现有可信 main frame 可以调用；
- URL 不来自 IPC 参数、指针或 Manifest；
- error 和 packaged unsupported 状态显示独立 recovery action；
- required error 仍保留“重试”“退出”，同时能打开下载页。

- [ ] **Step 2: 扩展最小视图模型**

不要把第三个动作塞入现有 primary/secondary 互斥逻辑。增加一个独立恢复动作：

```ts
export interface UpdateViewModel {
  title: string
  detail: string
  primary?: UpdateViewAction
  secondary?: UpdateViewAction
  recovery?: 'open-download-page'
  busy: boolean
}
```

错误状态显示“下载完整安装包”；可用更新状态仍以客户端内下载为主，不增加冗余按钮。

- [ ] **Step 3: 主进程只打开固定配置 URL**

`registerUpdateIpc` 接收零参数 `openDownloadPage()` 回调。`src/main/index.ts` 使用已经解析的 `downloadPageUrl` 调用 Electron `shell.openExternal()`；不得接收或转发 renderer 提供的 URL。

- [ ] **Step 4: 同步三个 preload**

`update.ts`、`shell.ts`、`harness.ts` 暴露相同零参数方法，保持 API 对象冻结和订阅清理行为。

- [ ] **Step 5: 运行聚焦验证并提交**

Run: `npm test -- test/update-api-contract.test.ts test/update-window.test.ts test/shell-preload-contract.test.ts`

Run: `npm run typecheck`

Expected: 普通错误、强制更新错误和命令失败都可到达固定下载页；任意 URL 注入不可达。

Commit: `git commit -m "feat: add official installer recovery link"`

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

- [ ] **Step 1: 把期望文件名写进测试**

Stable 采用 `insight-<version>-...`，Candidate 采用 `insight-candidate-<version>-...`。例如：

```text
insight-0.1.2-mac-arm64.zip
insight-0.1.2-windows-x64-setup.exe
insight-candidate-0.1.2-rc.2-mac-x64.dmg
```

YAML 中只允许相对 basename，且必须与签名 Manifest 中相同 target/kind 的文件名一致。

- [ ] **Step 2: 更新 electron-builder 与 finalize 脚本**

在 artifactName 中使用 `${version}` 宏。把 macOS finalize CLI 改为显式接收 release dir、channel、version、arch 后自行推导 ZIP 名，避免 npm script 硬编码无版本文件名；Windows finalize 继续显式校验传入版本和唯一安装器。

- [ ] **Step 3: 更新 Manifest 构建/验证清单**

`artifactDefinitions(channel, version)` 成为两份脚本共享的唯一命名规则；若不抽共享模块能保持脚本简单，则用契约测试锁定两份输出，不额外创建抽象层。

- [ ] **Step 4: 实现 current.json 生成与单调性校验**

`build-update-pointer.mjs` 接收 `--channel`、`--version`、`--output`，只输出：

```json
{"schemaVersion":1,"channel":"stable","version":"0.1.2"}
```

另支持 `--current <path>`：文件不存在表示首发；存在时必须严格同渠道且 `next > current`。拒绝重复版本、降级、Candidate/Stable 格式混用和未知字段。

- [ ] **Step 5: 运行发布脚本测试并提交**

Run: `npm test -- test/finalize-mac-release.test.ts test/finalize-windows-release.test.ts test/build-update-release.test.ts test/verify-release-assets.test.ts test/build-update-pointer.test.ts test/release.test.ts`

Run: `npm run typecheck`

Expected: 所有发布产物带版本号，YAML/Manifest/指针严格一致。

Commit: `git commit -m "feat: version desktop release assets"`

## Task 6：把 workflow 拆成暂存与推广两个门禁

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `scripts/verify-release-workflow.mjs`
- Modify: `test/release-workflow-verifier.test.ts`
- Modify: `test/release.test.ts`
- Create: `scripts/verify-distribution-assets.mjs`
- Create: `test/verify-distribution-assets.test.ts`

- [ ] **Step 1: 先把目标拓扑写入 workflow verifier 测试**

断言：

- workflow 顶层有 `contents: write` 和 `id-token: write`；
- 原生构建 job 不持有 OSS 凭证；
- `stage-release` 依赖 preflight 与三个原生 job，使用 `desktop-release`；
- `promote-release` 只依赖 stage，使用 `desktop-release-promotion`；
- 每渠道 `concurrency` 不取消运行中的推广；
- GitHub Draft 在 stage 创建但不公开；
- GitHub 公开发生在 `current.json` 上传之前；
- 版本目录上传使用禁止覆盖，渠道指针上传允许替换且是最后的生效写入。

- [ ] **Step 2: 固定 OSS 工具与临时身份**

在 `stage-release` 使用 `aliyun/configure-aliyun-credentials-action@v1`，输入 Environment Variables 中的 OIDC Provider ARN、Role ARN，以及包含 `${{ github.run_id }}` 的 session name。只使用 Action 返回的 STS 临时凭证，不增加长期 AccessKey Secret。

把 Action 输出仅映射到该 job 内的 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_SESSION_TOKEN`，并从受保护变量提供 `OSS_REGION`、`OSS_BUCKET`。日志不得输出这些值。

固定下载官方 `ossutil 2.3.0` Linux amd64 包，并校验官方 SHA-256 `3ae4d9fc85a7a6e9f5654d1599766f1a3a42a3692870887b5ae9338d582ef65a` 后执行。不要使用未校验的 install pipe 或 `latest` URL。

- [ ] **Step 3: 实现不可变版本目录暂存**

对 release-assets 中每个已验证文件调用 `ossutil api put-object --bucket "$OSS_BUCKET" --key "desktop/releases/v<version>/<basename>" --body "file://<absolute-local-path>"`，设置：

```text
--forbid-overwrite true
--cache-control public,max-age=31536000,immutable
```

重跑时先读取远端完整文件集。只有文件集和 Manifest 摘要全部相同才跳过上传并继续；任何缺失或差异都失败，不删除、不覆盖。

- [ ] **Step 4: 从最终 CDN 验证分发字节**

`verify-distribution-assets.mjs` 读取本地签名 Manifest 和 `releaseBaseUrl`，逐个验证 GET/HEAD 大小、SHA-512、`Accept-Ranges`/206、缓存头、Manifest/签名和平台 YAML。测试使用本地 HTTP server 覆盖截断、错误摘要、无 Range、错误缓存和重定向 Origin。

- [ ] **Step 5: 创建可幂等复用的 GitHub Draft**

新 Draft 上传与 OSS 相同的 release-assets。重跑只允许复用资产完整且摘要相同的 Draft；不完整、不同字节或已公开同 tag Release 都失败，不使用 `--clobber`。

- [ ] **Step 6: 实现人工推广 job**

`promote-release` 在受保护 Environment 审批后：

1. 公开已验证 GitHub Draft；
2. 通过 STS 直接从 OSS 读取权威渠道指针，NotFound 只在该渠道首发时允许；禁止用可能仍在 TTL 内的 CDN 副本做单调性判断；
3. 用 `build-update-pointer.mjs --current` 验证严格递增；
4. 使用 `ossutil api put-object` 写入 `desktop/<channel>/current.json`，设置 `Cache-Control: public,max-age=60,must-revalidate`；
5. 在 120 秒有界轮询内确认最终 CDN 指针收敛，然后重跑远端 Manifest/YAML/Range 验证。

正确性不依赖 CDN refresh API；不为发布角色增加 CDN 管理权限。

- [ ] **Step 7: 运行静态与脚本验证并提交**

Run: `npm test -- test/release-workflow-verifier.test.ts test/release.test.ts test/verify-distribution-assets.test.ts`

Run: `node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json`

Run: `npm run typecheck`

Expected: workflow 拓扑、身份隔离、不可变上传和最后指针提交均被自动测试锁定。

Commit: `git commit -m "ci: stage and promote OSS desktop releases"`

## Task 7：完成端到端失败矩阵与回归门禁

**Files:**

- Modify: `src/main/update/update-fixture.ts`
- Modify: `test/update-manager.test.ts`
- Modify: `test/update-window.test.ts`
- Create: `test/generic-update-flow.test.ts`
- Modify: `docs/client-build-runbook.md`
- Modify: `docs/release-runbook.md`

- [ ] **Step 1: 建立本地 Generic Provider Fixture**

Fixture 使用临时本地 HTTP server 提供 pointer、签名 Manifest、YAML 和假安装包；禁止读取生产域名。把 fetch、executor 和下载完成事件串起来，覆盖一次完整检查→可用→下载→SHA-512→已下载状态。

- [ ] **Step 2: 覆盖必须失败关闭的场景**

至少覆盖：断网、403、404、500、指针旧缓存、跨 Origin 重定向、错误签名、错误渠道、Manifest/YAML 版本不一致、缺失 blockmap、下载截断、最终摘要错误、强制更新重启恢复、重复 check/download 以及失败后的官网下载动作。

- [ ] **Step 3: 证明当前版本不受破坏**

所有失败用例必须断言 `quitAndInstall()` 未调用，当前安装目录未修改，仅删除不可信下载缓存；强制更新只保留可信策略缓存。

- [ ] **Step 4: 运行完整本地门禁**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: 全部通过；Development 构建不请求生产更新源。

- [ ] **Step 5: 根据最终命令同步 Runbook 并提交**

只修正实际实现与文档之间的命令、job 名、Environment 名和证据字段；不要扩展本文明确延后的能力。

Commit: `git commit -m "test: cover generic desktop update recovery"`

## Task 8：首发候选演练与 Stable 放行

**Files:**

- Modify: `docs/client-build-runbook.md`
- Modify: `docs/release-runbook.md`
- Create: `docs/releases/desktop-0.1.2.md`

- [ ] **Step 1: 发布并验收 rc.1**

从受保护 workflow 暂存当前仓库版本 `0.1.2-rc.1`，在 macOS arm64、macOS x64、Windows x64 完成干净安装。记录 OSS/CDN、GitHub Draft、摘要、签名、公证和用户数据目录。

- [ ] **Step 2: 发布并验收 rc.2 的真实更新**

先批准 rc.1 Candidate 指针，再暂存 rc.2。从已安装 rc.1 在客户端内完成检查、下载、进度、校验、安装和重启。人为禁用更新 Origin，确认固定官网下载页仍可打开并提供同版本整包。

- [ ] **Step 3: 验收确切 Stable 制品**

对 `0.1.2` OSS 版本目录/GitHub Draft 的确切 DMG 与 NSIS 完成干净安装和覆盖安装；不得用本地重建包替代。

- [ ] **Step 4: 首次推广 Stable**

确认 Stable `current.json` 尚不存在，审批推广。验证 120 秒内从最终 CDN 读取到 `0.1.2`，三平台检查均返回已是最新或正确候选状态，下载页可独立访问。

- [ ] **Step 5: 收口发布记录**

在 release record 中写入所有证据与失败范围。只有全部验收完成，才移除 Runbook 的“现有 workflow 仍是过渡实现”警告。

Commit: `git commit -m "docs: record first OSS desktop release"`

---

## 最终自检

- [ ] `current.json` 只有 schema/channel/version，客户端不接受远端 URL。
- [ ] 强制更新缓存恢复后可以重建 Generic Provider feed。
- [ ] OSS 版本目录与 GitHub Release 永不覆盖；相同完整字节只做幂等复用。
- [ ] GitHub 公开早于渠道指针，`current.json` 是唯一最后提交点。
- [ ] 客户端没有 GitHub API 自动发现、双源回退或任意 URL IPC。
- [ ] 产品官网下载页与更新 CDN 独立部署，运营可把下载链接切到 GitHub 镜像。
- [ ] Candidate rc.1→rc.2 与 Stable 干净/覆盖安装均有真实记录。
