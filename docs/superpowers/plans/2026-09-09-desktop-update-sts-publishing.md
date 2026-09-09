# Desktop Update STS Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面更新资产发布从本地 ossutil/长期 AccessKey 改为 GitHub Actions OIDC → 测试 Gateway → 目录级 OSS STS，并保持已有的两阶段、签名与不可变发布保证。

**Architecture:** 独立 `publish-update.yml` 在主分支手动运行，通过 GitHub OIDC 获取受信身份，再向固定测试 Gateway 以 `{}` 换取 900 秒左右的目录级 STS。`github-oss-client.mjs` 封装凭证校验、STS 刷新和一次令牌失效重试，现有发布器继续负责 GitHub Draft 下载、资产复验、版本目录写入、CDN 回读与 `current.json` 最后推广。

**Tech Stack:** Node.js 22、GitHub Actions OIDC、Insight Gateway、Alibaba Cloud OSS、`ali-oss@6.23.0`、Vitest。

**Design:** `docs/plans/2026-09-09-desktop-update-sts-publishing-design.md`

**执行状态（2026-09-09）：** Task 1–4 已完成编码与文档同步；Task 5 的本地静态/测试门禁已执行。`upload_oss_test` Run #7 已通过 `{}` 目录级 STS 与真实 OSS `PutObject` 验收；首个真实 `stage` 现等待 Candidate Draft。

## Constraints

- 1.0 固定使用测试 Gateway `https://gapi-test.insight-aigc.com/insight-harness-llm-gateway`。
- Bucket 固定为 `insight-desktop-updates`，更新 Origin 固定为 `https://updates.insight-aigc.com`。
- 不向仓库、客户端或 GitHub Secrets 写入 OSS 长期 AccessKey。
- 普通 `PutObject` 支持当前 200～600 MB 安装资产；不实现 multipart/checkpoint。
- 每个文件上传前检查 STS；剩余不足 180 秒就刷新。令牌过期时刷新并整文件重试一次。
- `release.yml` 不获得 OIDC 权限；只有独立发布 workflow 获得 `id-token: write`。
- 后台目录级 STS 已由 `upload_oss_test` Run #7 验收通过；真实 `stage` 仍必须基于完整且已验证的 Candidate Draft 执行。

## Task 1：新增 GitHub OIDC/STS OSS 客户端

**Files:**

- Create: `scripts/github-oss-client.mjs`
- Create: `test/github-oss-client.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: 写 OIDC 和 STS 契约失败测试**

覆盖：非 GitHub Actions 环境、错误仓库/仓库 ID/run ID/ref/event、缺失 OIDC 环境变量、非 HTTPS OIDC URL、OIDC 重定向、Gateway 非 2xx、非 `SUCCESS`、缺字段、错误 bucket/region/endpoint/dir，以及响应 repositoryId/runId 与环境不一致。

- [x] **Step 2: 写 STS 刷新与上传重试测试**

用注入的 `fetch` 与 OSS client factory 证明：

- 首次操作获取 OIDC 和 STS；
- 剩余有效期少于 180 秒时在下一文件前刷新；
- `SecurityTokenExpired`/`InvalidSecurityToken` 时只刷新并整文件重试一次；
- 其他 OSS 错误不重试；
- 第二次令牌失败后抛出脱敏错误；
- 上传始终设置 `x-oss-forbid-overwrite: true`。

- [x] **Step 3: 固定安装 ali-oss**

Run: `npm install --save-dev --save-exact ali-oss@6.23.0`

Expected: `package.json` 和 lockfile 精确锁定 `6.23.0`。

- [x] **Step 4: 实现最小客户端**

导出：

```js
export function assertGithubPublisherEnvironment(environment)
export function validateStsResponse(value, environment)
export function createGithubOssClient(options)
```

客户端只提供发布器需要的 `listObjects(prefix)`、`getObject(key, destination)` 和 `putObject(key, source, headers)`。凭证只保存在闭包内；报错只保留安全的 HTTP status、code 和 requestId。

- [x] **Step 5: 运行聚焦测试**

Run: `npm test -- test/github-oss-client.test.ts`

Expected: OIDC/STS 契约、刷新和一次重试矩阵全部通过。

## Task 2：把现有发布器切换到 STS 客户端

**Files:**

- Modify: `scripts/publish-update-to-oss.mjs`
- Modify: `test/publish-update-to-oss.test.ts`

- [x] **Step 1: 先更新 CLI 与发布语义测试**

CLI 收窄为：

```text
node scripts/publish-update-to-oss.mjs stage --tag <v-semver>
node scripts/publish-update-to-oss.mjs promote --tag <v-semver> --confirm-version <semver>
```

拒绝 `--bucket`、`--origin`、`--profile` 和 AccessKey 参数，固定配置不得由调用者覆盖。

- [x] **Step 2: 删除 ossutil 适配层**

删除 profile、版本检测、`runOss()`、JSON CLI 解析和运行期 Bucket Versioning 查询。保留 GitHub CLI 调用、发布锁、资产校验、CDN 校验和报告。

- [x] **Step 3: 接入 github-oss-client**

- `listObjects()` 调用 STS 客户端并返回 `{ key, size }`。
- `getObject()` 下载 `current.json` 到临时文件。
- 版本资产通过普通 `putObject()` 上传并禁止覆盖。
- pointer 使用相同 STS 客户端上传，但允许覆盖且设置短缓存。

- [x] **Step 4: 保持两阶段顺序测试**

静态与行为测试必须证明：

- `stage` 永不上传 pointer；
- `promote` 先发布 GitHub Release，再写唯一可变 pointer；
- 上传失败时不会进入 pointer 提交；
- 发布报告不包含 AK、Secret 或 Security Token。

- [x] **Step 5: 运行聚焦测试**

Run: `npm test -- test/github-oss-client.test.ts test/publish-update-to-oss.test.ts`

Expected: 新客户端和发布器测试全部通过。

## Task 3：新增独立发布工作流与静态门禁

**Files:**

- Create: `.github/workflows/publish-update.yml`
- Create: `scripts/verify-publish-workflow.mjs`
- Create: `test/publish-workflow-verifier.test.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `test/release.test.ts`
- Modify: `test/release-workflow-verifier.test.ts`

- [x] **Step 1: 写 workflow 合同测试**

断言：

- 只支持 `workflow_dispatch`；
- `command` 只允许 `stage`/`promote`；
- permissions 恰好包含 `contents: write` 与 `id-token: write`；
- checkout 使用 `persist-credentials: false`；
- Node 22、`npm ci --ignore-scripts`；
- 只允许 `refs/heads/main`；
- 固定 OIDC audience，不读取 OSS Secrets；
- 固定 concurrency 且不取消正在执行的发布；
- 上传发布报告 artifact。

- [x] **Step 2: 实现 workflow verifier**

验证 publish workflow 不得出现 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_SESSION_TOKEN`、ossutil、可变 Gateway/bucket/origin 输入或 `pull_request` 触发。

- [x] **Step 3: 新增 publish-update.yml**

工作流将输入转换为发布器 CLI。`promote` 缺少或不匹配 `confirm_version` 时由发布器失败关闭。使用 `GH_TOKEN: ${{ github.token }}` 访问 GitHub Release。

- [x] **Step 4: 保持 release.yml 权限边界**

在 release preflight 中增加新脚本的语法检查和 publish workflow verifier，但 `release.yml` 本身继续只保留 `contents: write`。

- [x] **Step 5: 运行聚焦测试**

Run: `npm test -- test/publish-workflow-verifier.test.ts test/release-workflow-verifier.test.ts test/release.test.ts`

Expected: 构建 workflow 和发布 workflow 的权限边界均通过。

## Task 4：同步发布文档与 1.0 验收清单

**Files:**

- Modify: `docs/plans/2026-09-08-desktop-update-oss-distribution-design.md`
- Modify: `docs/superpowers/plans/2026-09-08-desktop-update-oss-distribution.md`
- Modify: `docs/release-runbook.md`
- Modify: `docs/client-build-runbook.md`
- Modify: `docs/superpowers/plans/2026-09-09-desktop-v1-release-verification.md`

- [x] **Step 1: 删除过时的 ossutil 操作说明**

把长期 RAM AccessKey、本地 profile、本地 `stage/promote` 命令和 ossutil 安装步骤替换为 GitHub Actions 发布 workflow。

- [x] **Step 2: 写明后台前置门槛**

链接 STS 设计文档，写明 `upload_oss_test` 的 `{}` 契约通过是首个真实 `stage` 的前置条件。

- [x] **Step 3: 更新 RC/Stable 验收步骤**

明确 Candidate `stage`、真实安装升级、Stable `stage/promote`、同源整包下载兜底和发布报告留存。

- [x] **Step 4: 检查文档残留**

Run: `rg -n "ossutil|desktop-updates-publisher|OSS_ACCESS_KEY" docs .github scripts test package.json`

Expected: 仅允许历史说明或明确的禁止性检查，不再出现可执行的长期凭证发布步骤。

## Task 5：完整验证与真实发布前交接

**Files:**

- Modify as needed only for defects discovered by this task.

- [x] **Step 1: 运行静态检查与聚焦测试**

Run: `node --check scripts/github-oss-client.mjs`

Run: `node --check scripts/publish-update-to-oss.mjs`

Run: `node --check scripts/verify-publish-workflow.mjs`

Run: `npm test -- test/github-oss-client.test.ts test/publish-update-to-oss.test.ts test/publish-workflow-verifier.test.ts test/release-workflow-verifier.test.ts test/release.test.ts`

- [x] **Step 2: 运行仓库级门禁**

Run: `npm test`

Run: `npm run typecheck`

Expected: 全量测试和类型检查通过；无 AccessKey、Token 或 Secret 出现在 diff 与日志。

- [ ] **Step 3: 后台完成后运行首个真实 stage**

前置证据：后台提供成功的 `upload_oss_test` run URL、object key、OSS request ID。

GitHub Actions 手动运行 `Publish desktop updates`：

- command: `stage`
- tag: 已验证的 Candidate Draft tag
- confirm_version: 留空

Expected: 大文件通过 STS 上传、CDN 回读通过、报告 artifact 可下载、`current.json` 未改变。

- [ ] **Step 4: 保留发布证据**

记录 workflow run URL、GitHub Release URL、OSS 版本前缀、CDN 响应、发布报告和客户端安装/升级结果。真实 `promote` 仍需发布负责人显式输入目标版本。
