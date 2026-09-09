# 因赛AI Desktop 1.0 正式发布前验证计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从已整合的 `main` 产出可安装、可验证、可在客户端内升级且具备同源整包兜底的 `v1.0.0` 正式版本。

**Architecture:** `main` 是唯一长期基线。Candidate 由安装包 workflow 构建并生成 Draft，独立发布 workflow 通过 GitHub OIDC 和测试 Gateway 获取目录级 OSS STS，再把相同字节 `stage` 到不可变版本目录；安装验收通过后才 `promote` Candidate 指针。至少完成一次 `v1.0.0-rc.1 → v1.0.0-rc.2` 客户端内升级，再以同样流程暂存和推广 `v1.0.0` Stable。

**Tech Stack:** Electron 43、electron-updater 6、GitHub Actions OIDC/Releases、Insight 测试 Gateway、Ed25519 签名 Manifest、`ali-oss@6.23.0`、Alibaba Cloud OSS/CDN、`https://updates.insight-aigc.com`。

## Global Constraints

- `main` 是唯一长期集成分支；本次发布期间不再并行合入非阻断功能。
- Candidate 固定使用 `v1.0.0-rc.1`、`v1.0.0-rc.2`，若失败只递增为更高 RC，禁止复用 tag 或覆盖资产。
- Stable 固定使用 `v1.0.0`；正式 tag 只能指向已经完成本计划 Stable 构建前门禁的提交。
- Candidate 与 Stable 都使用正式产品身份 `因赛AI`、App ID `com.insight.desktop` 和用户数据目录 `insight-desktop`；本地未签名 Candidate 禁止启动。
- 安装资产统一使用 `insight-1.0.0-rc.1-...`、`insight-1.0.0-rc.2-...` 和 `insight-1.0.0-...`；Candidate 不增加额外 `candidate-` 文件名前缀。
- GitHub Actions 不保存 OSS 长期 AccessKey；只有独立发布 workflow 可以使用 OIDC 换取限定目录和时长的 STS。
- `stage` 不公开 GitHub Release、不写 `current.json`；`promote` 才公开 Release，并在最后写入渠道指针。
- `desktop/releases/v1.0.0-rc.1/`、`desktop/releases/v1.0.0-rc.2/` 和 `desktop/releases/v1.0.0/` 永不覆盖；`current.json` 不允许回退到旧版本。
- Windows 1.0 当前为未签名安装器。产品负责人必须明确接受 SmartScreen/未知发布者提示，否则阻断 Stable 发布。
- 任何代码、依赖、Runtime 锁或内置插件变化都会使已有安装验收失效，必须从对应 Candidate 构建阶段重新开始。

---

## 当前基线

- [x] Desktop Shell 研发分支已合并到本地 `main`，核心整合提交为 `60d9590`。
- [x] 本地全量测试通过：84 个测试文件、536 个测试。
- [x] TypeScript、发布工作流契约和 Electron 完整构建通过。
- [x] Core Runtime 锁定到 `insight-runtime-v0.1.1-rc.10` / commit `833f4246abaf3ce5fcf39c3f81a8be2499e7f434`，三个目标资产均有固定 SHA-256。
- [x] 生产更新 Origin 固定为 `https://updates.insight-aigc.com`。
- [x] 已完成 GitHub OIDC/目录级 STS 发布器与独立 `Publish desktop updates` workflow 的本地接入和静态门禁。
- [ ] 本地 `main` 尚未推送到 `origin/main`。
- [ ] 仓库版本仍为 `0.1.2-rc.3`，尚未准备 `1.0.0-rc.1`。
- [ ] 新发布契约下的 GitHub Draft、OSS 暂存、三平台安装和 N→N+1 尚未完成。
- [ ] 测试 Gateway 尚需部署接受 `{}` 的目录级 STS 契约，并由 `upload_oss_test` 回传真实成功证据。

---

### Task 1：冻结并同步发布基线

**Files:**
- Verify: repository root and `docs/release-runbook.md`

**Produces:** 远端 `origin/main` 与本地已验证整合基线一致。

- [ ] **Step 1：确认只剩主分支且工作区干净**

```bash
git switch main
git status --short --branch
git branch -vv
git worktree list
```

通过条件：当前分支为 `main`，无未提交文件，只有主工作树，无待合并本地研发分支。

- [ ] **Step 2：记录并推送当前基线**  **【改变远端状态】**

```bash
git rev-parse HEAD
git push origin main
git status --short --branch
```

通过条件：最后一条状态为 `main...origin/main`，没有 ahead/behind；记录实际 HEAD SHA。此后进入发布冻结，只接收 1.0 阻断修复。

---

### Task 2：完成 GitHub、Apple 与 OSS 一次性准备

**Files:**
- Verify: `.github/workflows/release.yml`
- Verify: `.github/workflows/publish-update.yml`
- Verify: `build/update-signing-public.pem`
- Verify: `build/update-distribution.json`
- Reference: `docs/plans/2026-09-09-desktop-update-sts-publishing-design.md`
- Reference: `docs/release-runbook.md`

**Produces:** GitHub 能生成签名 Candidate Draft，独立发布 workflow 能以短期最小权限将已验证资产写入 OSS。

- [ ] **Step 1：确认 GitHub workflows 与发布 Environment**

在 GitHub Actions 页面确认 `Release desktop installers` 与 `Publish desktop updates` 均可从 `main` 选择。`Publish desktop updates` 只能手动触发，并只提供 `stage`/`promote`、tag 和确认版本输入。

在 GitHub `desktop-release` Environment 中确认以下 secret 已配置且名称完全一致：

- `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`
- `DESKTOP_CSC_LINK`
- `DESKTOP_CSC_KEY_PASSWORD`
- `DESKTOP_APPLE_API_KEY`
- `DESKTOP_APPLE_API_KEY_ID`
- `DESKTOP_APPLE_API_ISSUER`
- `DESKTOP_APPLE_TEAM_ID`

通过条件：Apple 凭据对应 `Developer ID Application`；更新私钥与仓库 `build/update-signing-public.pem` 配对；Environment 有必要的人工审批人。不得打印任何 secret，也不得配置 OSS 长期 AccessKey Secret。

- [ ] **Step 2：确认 OSS Bucket 安全属性**

在阿里云控制台确认：

- Bucket 名为 `insight-desktop-updates`，保持私有；
- Bucket Versioning 从未启用，状态不是 `Enabled` 或 `Suspended`；
- 未启用 WORM；
- CDN 已启用私有 Bucket 回源鉴权；
- 没有会拦截 Electron 无 Referer 请求的防盗链。

通过条件：版本目录能够用 `forbid-overwrite` 保证不可变，而 `current.json` 仍允许受控覆盖。

- [ ] **Step 3：确认 Gateway AssumeRole 与临时策略**

确认测试 Gateway 实际使用的 RAM 角色已绑定更新策略，签发的临时策略只保留：

- Bucket 级：`oss:ListObjects`；
- `insight-desktop-updates/desktop/*`：`oss:GetObject`、`oss:PutObject`；
- 不授予删除对象、修改 Bucket、ACL、CDN 或其他 Bucket 的权限。

通过条件：Gateway 请求方不能覆盖 Bucket、Region、endpoint、目录、RAM role、权限或有效期；长期 AccessKey 不进入仓库、GitHub、客户端、命令参数或 `.env`。

- [ ] **Step 4：部署并验收目录级 STS 契约**

测试 Gateway 的 `POST /v1/upload/sts/token` 必须在 GitHub OIDC 鉴权后接受 `{}` 或 `{"fileType":"file"}`，不再要求 `fileName` 或登录用户。allowlist 至少包含桌面仓库 ID `1344679131` 和测试仓库 ID `1362006344`，audience 为 `insight-harness-oss-upload`。若校验 `sub`，桌面 workflow 使用 `repo:Boxser567/insight-desktop-shell:environment:desktop-release`。

从 `BreezeWind889988/upload_oss_test` 最新 `main` 手动运行 `Test GitHub OIDC STS`，不要选择 `verify_only`。

通过条件：OIDC 验证成功；请求体 `{}` 获取 STS 成功；脚本自行生成 object key；真实 `PutObject` 返回 HTTP 200；日志已脱敏。记录 run URL、object key、OSS request ID 和不含 `fileName`/`userId` 的响应结构。

- [ ] **Step 5：确认 CDN 规则**

- `/desktop/releases/*`：不压缩、不改写、不重定向，支持 HEAD 和 `Range: bytes=0-0`，缓存为 `public,max-age=31536000,immutable`；
- `/desktop/candidate/current.json` 与 `/desktop/stable/current.json`：缓存为 `public,max-age=60,must-revalidate`；
- DMG、ZIP、EXE、blockmap、YAML、JSON 和签名文件返回正确 Content-Type。

```bash
curl -sS -i https://updates.insight-aigc.com/desktop/candidate/current.json
curl -sS -i https://updates.insight-aigc.com/desktop/stable/current.json
```

通过条件：首发前两个指针应为不存在；若任一返回有效版本，停止发布并先核对 OSS 权威对象，不得直接覆盖。

---

### Task 3：准备并本地验证 `v1.0.0-rc.1`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `build/update-release-policy.json`
- Verify: `core-runtime.lock.json`

**Produces:** 可从 `main` 复现的 `1.0.0-rc.1` Candidate 提交。

- [ ] **Step 1：确认 Core Runtime 与内置插件基线**

除非 Core 代码发生变化，不为版本名称重新发布 Runtime。确认锁仍指向：

- Runtime tag：`insight-runtime-v0.1.1-rc.10`；
- Core commit：`833f4246abaf3ce5fcf39c3f81a8be2499e7f434`；
- 必需 Sidebar：`dsh-better-sidebar@0.16.1`；
- Market：`dshmarket@1.44.0`；
- 可选出厂插件：`dsh-memory-evolve@0.1.0`、`@changfenhuang/dsh-genui@0.9.8`、`dsh-prompt-enhance@0.1.9`。

通过条件：三个 Runtime target 使用同一个 Core commit；vendor 清单和 SHA-256 未漂移。

- [ ] **Step 2：更新 Candidate 版本**

```bash
npm version 1.0.0-rc.1 --no-git-tag-version
```

将 `build/update-release-policy.json` 精确更新为：

```json
{
  "schema": 1,
  "releaseVersion": "1.0.0-rc.1",
  "channel": "candidate",
  "mode": "optional",
  "minimumSupportedVersion": "0.1.1"
}
```

通过条件：`package.json`、`package-lock.json` 根版本和 policy 版本均为 `1.0.0-rc.1`。

- [ ] **Step 3：运行零安装发布预检**

```bash
node scripts/verify-release-preflight.mjs \
  --tag v1.0.0-rc.1 \
  --expected-channel candidate \
  --package package.json \
  --policy build/update-release-policy.json \
  --runtime-lock core-runtime.lock.json
node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json
```

通过条件：两条命令退出码均为 0，输出版本、渠道、Runtime tag/commit 和三个目标平台正确。

- [ ] **Step 4：运行本地完整门禁**

```bash
npm test
npm run typecheck
npm run build
npm run package:candidate:dir
git diff --check
```

通过条件：测试、类型检查和构建全绿；目录包包含 Runtime、签名公钥、`update-distribution.json`、Sidebar、Market 和三个可选插件。只检查本地未签名 Candidate 包内容，不启动它；功能验证使用隔离身份的 `因赛AI Dev`。

- [ ] **Step 5：完成本地 DEV 人工回归**

同时验证全新 Profile 与既有 Profile：

- 登录、退出、登录恢复、会话和工作区；
- 设置入口与账号隔离；
- Markdown/HTML 在 Sidebar 内打开；
- Market 可打开，必需插件不可卸载，可选插件卸载后不被回填；
- Market“立即重启”由 Shell 接管，无恢复页、无限启动页或孤儿 Harness；
- 登录前、登录后均不常驻显示更新按钮；没有真实可信更新时不显示假版本或下载入口。

通过条件：无数据丢失、无启动阻断、无模拟更新状态。

- [ ] **Step 6：提交并推送 RC1 准备**  **【改变远端状态】**

```bash
git add package.json package-lock.json build/update-release-policy.json
git commit -m "chore(release): prepare v1.0.0-rc.1"
git push origin main
git ls-remote --tags origin refs/tags/v1.0.0-rc.1
```

通过条件：`origin/main` 包含 RC1 准备提交，最后一条命令没有输出；如果 tag 已存在，停止并改用更高且未占用的 RC，禁止删除或移动旧 tag。

---

### Task 4：构建、暂存并推广 `v1.0.0-rc.1`

**Files:**
- Execute: `.github/workflows/release.yml`
- Execute: `.github/workflows/publish-update.yml`
- Output artifact: `desktop-update-v1.0.0-rc.1-stage`
- Output artifact: `desktop-update-v1.0.0-rc.1-promote`

**Produces:** 三平台 RC1、不可变 OSS 版本目录和 Candidate 基线指针。

- [ ] **Step 1：触发完整 Candidate workflow**

```bash
gh workflow run release.yml \
  --repo Boxser567/insight-desktop-shell \
  --ref main \
  -f candidate_tag=v1.0.0-rc.1 \
  -f target=all
gh run list --repo Boxser567/insight-desktop-shell --workflow release.yml --limit 5
```

通过条件：preflight、macOS arm64、macOS x64、Windows x64、Sonoma compatibility、publish 全部成功；GitHub 产生 Draft，尚未公开 Release。

- [ ] **Step 2：核对 GitHub Draft 资产**

必须包含两个 DMG、两个 ZIP、两个 ZIP blockmap、一个 Windows installer、一个 installer blockmap、`latest-mac.yml`、`latest.yml`、`insight-update.json`、`insight-update.json.sig`。所有安装资产文件名包含 `1.0.0-rc.1`，且不包含额外 `candidate-` 前缀。

通过条件：Manifest 签名有效，Manifest 中 Shell commit 等于该 workflow checkout 的提交，Core Runtime 身份等于锁定值，文件大小和 SHA-512 与实际资产一致。

- [ ] **Step 3：暂存 RC1 到 OSS**  **【写入不可变 OSS 版本目录】**

从 GitHub Actions 在 `main` 手动运行 `Publish desktop updates`：

- `command=stage`
- `tag=v1.0.0-rc.1`
- `confirm_version` 留空

通过条件：生成 `release-reports/v1.0.0-rc.1-stage.json`；OSS 只新增 `desktop/releases/v1.0.0-rc.1/`；CDN 的 HEAD、Range、缓存、Content-Type、大小和摘要复验全部通过；Candidate `current.json` 仍不存在。

- [ ] **Step 4：三平台安装 RC1 确切资产**

- macOS arm64：验证 DMG、codesign、Gatekeeper、公证、staple，保留 quarantine 完成干净安装并连续启动三次；
- macOS x64：验证 DMG、codesign、Gatekeeper、公证、staple，保留 quarantine 完成干净安装并连续启动三次；
- Windows x64：核对 Manifest 摘要和 NSIS 结构，完成干净安装、启动和卸载；
- 记录三个确切安装包的 URL、大小和 SHA-256；不得用本地重建包替代。

通过条件：无“应用已损坏”、重复 Safe Storage 授权、空白窗口、恢复页或无限启动；Windows 的未知发布者提示可继续安装，并已有负责人明确接受。

- [ ] **Step 5：推广 RC1 Candidate**  **【公开 RC1 Release 并写 Candidate 指针】**

从 GitHub Actions 在 `main` 再次手动运行 `Publish desktop updates`：

- `command=promote`
- `tag=v1.0.0-rc.1`
- `confirm_version=1.0.0-rc.1`

通过条件：GitHub Release 成为公开 Pre-release；`candidate/current.json` 在 120 秒内收敛为 `{"schemaVersion":1,"channel":"candidate","version":"1.0.0-rc.1"}`；已安装 RC1 检查更新时显示“已是最新”，不显示下载按钮。

---

### Task 5：完成 `rc.1 → rc.2` 客户端内升级证明

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `build/update-release-policy.json`
- Output artifact: `desktop-update-v1.0.0-rc.2-stage`
- Output artifact: `desktop-update-v1.0.0-rc.2-promote`

**Produces:** 已安装客户端能够从 RC1 发现、下载、安装并重启到 RC2 的证据。

- [ ] **Step 1：准备 RC2 提交**

```bash
npm version 1.0.0-rc.2 --no-git-tag-version
```

将 `build/update-release-policy.json` 精确更新为：

```json
{
  "schema": 1,
  "releaseVersion": "1.0.0-rc.2",
  "channel": "candidate",
  "mode": "optional",
  "minimumSupportedVersion": "0.1.1"
}
```

运行 RC2 的完整本地门禁：

```bash
node scripts/verify-release-preflight.mjs \
  --tag v1.0.0-rc.2 \
  --expected-channel candidate \
  --package package.json \
  --policy build/update-release-policy.json \
  --runtime-lock core-runtime.lock.json
node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json
npm test
npm run typecheck
npm run build
npm run package:candidate:dir
git diff --check
```

使用隔离身份的 `因赛AI Dev` 对全新 Profile 与既有 Profile 验证登录、会话、工作区、设置、Sidebar、Market、必需/可选插件和宿主接管重启；无可信更新时不得显示下载按钮或模拟版本。本地未签名 Candidate 目录包只核对内容，不启动。

```bash
git add package.json package-lock.json build/update-release-policy.json
git commit -m "chore(release): prepare v1.0.0-rc.2"
git push origin main
```

通过条件：RC2 只包含已验收基线和必要版本变化；若 RC1 暴露代码缺陷，修复提交必须独立可审查，并在版本准备提交之前完成。

- [ ] **Step 2：构建并暂存 RC2**

```bash
gh workflow run release.yml \
  --repo Boxser567/insight-desktop-shell \
  --ref main \
  -f candidate_tag=v1.0.0-rc.2 \
  -f target=all
```

安装包 workflow 成功并生成 Draft 后，在 GitHub Actions 从 `main` 手动运行 `Publish desktop updates`，输入 `command=stage`、`tag=v1.0.0-rc.2`，`confirm_version` 留空。

通过条件：先确认 workflow 全部成功并产生 Draft，再运行 `stage`；RC2 版本目录完整，RC1 目录未改变，Candidate 指针仍为 RC1。

- [ ] **Step 3：安装验收 RC2 确切资产**

- macOS arm64：验证 DMG、codesign、Gatekeeper、公证、staple，保留 quarantine 完成干净安装和覆盖安装，并连续启动三次；
- macOS x64：验证 DMG、codesign、Gatekeeper、公证、staple，保留 quarantine 完成干净安装和覆盖安装，并连续启动三次；
- Windows x64：核对 Manifest 摘要与 NSIS 结构，完成干净安装、覆盖安装、启动和卸载；
- 三个平台都记录确切资产 URL、大小和 SHA-256，不得使用本地重建包。

通过条件：RC2 三个平台无启动阻断、数据丢失、模拟更新或重复 Safe Storage 授权。RC2 未推广前不得用 RC1 客户端声称已验证自动更新。

- [ ] **Step 4：推广 RC2**  **【公开 RC2 Release 并更新 Candidate 指针】**

在 GitHub Actions 从 `main` 手动运行 `Publish desktop updates`，输入 `command=promote`、`tag=v1.0.0-rc.2`、`confirm_version=1.0.0-rc.2`。

通过条件：Candidate 指针严格从 RC1 升到 RC2，RC1 版本目录保持不变。

- [ ] **Step 5：从已安装 RC1 完成真实 N→N+1**

在仍保留 RC1 的目标机上：

1. 启动 RC1，确认检测到真实 `1.0.0-rc.2` 后才显示下载按钮；
2. 打开更新窗口，核对目标版本、发行说明和状态均来自可信 Manifest；
3. 下载、校验、安装并重启；
4. 核对应用实际版本为 `1.0.0-rc.2`；
5. 验证登录、会话、工作区、账号隔离、设置、用户插件、Market、Sidebar 数据均保留；
6. 重启三次，确认无 Safe Storage 重复授权、恢复页、无限启动页或孤儿 Harness。

通过条件：客户端内更新闭环成功，不能用手工覆盖安装代替。

- [ ] **Step 6：验证同源整包兜底和失败关闭**

- 保持 `current.json` 和签名 Manifest 可访问，只阻断自动更新所需 ZIP/EXE 下载；
- 确认更新窗口在已有可信 Manifest 后显示适配当前平台/架构的“下载完整安装包”；
- 确认链接指向 RC2 同一 OSS 不可变版本目录，并能完成覆盖安装；
- 再完全禁用更新 Origin，确认客户端安全失败，不展示假版本、假进度或未经验证的下载按钮。

通过条件：自动更新失败时仍可在客户端内获得可信整包；信任链不可用时不降级为不安全下载。

---

### Task 6：准备并暂存 `v1.0.0` Stable

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `build/update-release-policy.json`
- Output: `release-reports/v1.0.0-stage.json`

**Produces:** 与通过验收的最后一个 RC 等价、尚未对客户端生效的 Stable 资产。

- [ ] **Step 1：确认 Stable 放行前提**

- RC1 与 RC2 三平台安装证据齐全；
- RC1→RC2 客户端内升级通过；
- 同源整包兜底和 Origin 完全失败路径通过；
- Windows 未签名风险已有明确接受结论；
- 最后一个 RC 之后无未进入新 RC 的产品代码变化。

任何一项不满足都停止 Stable 准备。

- [ ] **Step 2：准备 Stable 版本提交**

```bash
npm version 1.0.0 --no-git-tag-version
```

将 `build/update-release-policy.json` 精确更新为：

```json
{
  "schema": 1,
  "releaseVersion": "1.0.0",
  "channel": "stable",
  "mode": "optional",
  "minimumSupportedVersion": "0.1.1"
}
```

运行 Stable 的完整本地门禁：

```bash
node scripts/verify-release-preflight.mjs \
  --tag v1.0.0 \
  --expected-channel stable \
  --package package.json \
  --policy build/update-release-policy.json \
  --runtime-lock core-runtime.lock.json
node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json
npm test
npm run typecheck
npm run build
npm run package:candidate:dir
git diff --check
```

使用隔离身份的 `因赛AI Dev` 对全新 Profile 与既有 Profile 验证登录、会话、工作区、设置、Sidebar、Market、必需/可选插件和宿主接管重启；无可信更新时不得显示下载按钮或模拟版本。本地目录包只核对内容，不作为正式签名包验收结果。

- [ ] **Step 3：提交并推送 Stable 准备**  **【改变远端状态】**

```bash
git add package.json package-lock.json build/update-release-policy.json
git commit -m "chore(release): prepare v1.0.0"
git push origin main
git status --short --branch
```

通过条件：工作区干净，`main` 与 `origin/main` 一致；记录正式发布 commit。

- [ ] **Step 4：创建并推送正式 tag**  **【触发 Stable 构建】**

```bash
git tag -a v1.0.0 -m "因赛AI Desktop v1.0.0"
git push origin v1.0.0
```

通过条件：tag 精确指向已记录的 Stable 提交；GitHub workflow 自动以 Stable/all 模式运行。tag 推送后不得移动；若资产失败，修复后发布 `v1.0.1`，不能复用 `v1.0.0`。

- [ ] **Step 5：核对 Stable Draft 并暂存 OSS**

确认全部安装包 workflow job 成功且 GitHub Release 仍为 Draft，然后在 GitHub Actions 从 `main` 手动运行 `Publish desktop updates`：

- `command=stage`
- `tag=v1.0.0`
- `confirm_version` 留空

通过条件：`desktop/releases/v1.0.0/` 完整且通过最终 CDN 复验；`stable/current.json` 仍不存在；Candidate 指针仍为 RC2。

- [ ] **Step 6：验收 Stable 确切安装包**

- macOS arm64、macOS x64：干净安装和从 Candidate/旧测试安装覆盖安装，保留 quarantine，验证签名、公证、staple、三次重启和 Safe Storage；
- Windows x64：干净安装、覆盖安装、启动和卸载；
- 验证登录、退出、登录恢复、会话、工作区、设置、账号隔离、Sidebar、Market、必需插件保护和可选插件卸载状态；
- 无更新时下载按钮不显示，更新窗口不展示模拟版本。

通过条件：Stable 三平台和数据连续性全部通过；记录的字节必须来自 GitHub Draft 或 OSS `v1.0.0` 版本目录。

---

### Task 7：发布官网入口并推广 Stable

**Files:**
- Update externally: `https://insight-aigc.com`
- Execute: `.github/workflows/publish-update.yml`
- Output artifact: `desktop-update-v1.0.0-promote`

**Produces:** 新用户可下载安装，已安装 Stable 客户端可读取正式更新指针。

- [ ] **Step 1：准备官网三平台下载入口**

官网按钮直接指向以下不可变 CDN 资产：

- `https://updates.insight-aigc.com/desktop/releases/v1.0.0/insight-1.0.0-mac-arm64.dmg`
- `https://updates.insight-aigc.com/desktop/releases/v1.0.0/insight-1.0.0-mac-x64.dmg`
- `https://updates.insight-aigc.com/desktop/releases/v1.0.0/insight-1.0.0-windows-x64-setup.exe`

通过条件：三个按钮标明系统与架构；浏览器下载无 403、重定向循环或 HTML 错误页；下载后的大小和 SHA-256 与发布记录一致。Stable 未推广前可以准备页面，但不要提前公开入口。

- [ ] **Step 2：最终推广 Stable**  **【正式公开 Release 并首次写 Stable 指针】**

在 GitHub Actions 从 `main` 手动运行 `Publish desktop updates`：

- `command=promote`
- `tag=v1.0.0`
- `confirm_version=1.0.0`

通过条件：GitHub Release 公开且不是 Pre-release；`stable/current.json` 在 120 秒内收敛为 `{"schemaVersion":1,"channel":"stable","version":"1.0.0"}`；报告文件生成且无敏感凭据。

- [ ] **Step 3：公开官网并执行外部 canary**

- 从非发布机网络打开官网并分别下载可用平台安装包；
- 全新安装后确认版本为 `1.0.0`，检查更新显示已是最新且不出现常驻下载按钮；
- 验证登录、退出、工作区、Sidebar、Market 和一个真实会话；
- 检查 CDN/OSS 的 403、404、5xx、Range 与下载量异常；
- 保存 GitHub run、Release、OSS 前缀、两个指针、报告 JSON 和三平台验收记录。

通过条件：外部网络与真实安装环境可完成下载和启动，客户端读取 Stable 指针正常。

- [ ] **Step 4：明确发布后故障规则**

若 1.0.0 已推广后发现阻断问题：停止官网入口或公告受影响范围，但不删除/覆盖 `v1.0.0` 资产，不把 `stable/current.json` 降回旧版本；从 `main` 修复并发布更高版本 `v1.0.1`。

---

## 发布完成判定

只有以下条件全部成立，才能宣布 `v1.0.0` 正式发布：

- [ ] `origin/main`、正式 commit 和 `v1.0.0` tag 对应关系已记录；
- [ ] RC1、RC2、Stable 三次 GitHub workflow 完整成功；
- [ ] 三个版本目录在 OSS 中不可变且最终 CDN 校验通过；
- [ ] RC1→RC2 客户端内更新成功；
- [ ] 自动更新失败后的同源完整安装包兜底成功；
- [ ] macOS arm64、macOS x64、Windows x64 的 Stable 安装验收成功；
- [ ] 登录、会话、工作区、设置、账号隔离、Sidebar、Market 和插件数据无丢失；
- [ ] `stable/current.json` 精确指向 `1.0.0`，Candidate 指针仍保留最后一个已验收 RC；
- [ ] 官网三平台下载入口可用；
- [ ] 发布证据与已知风险已经归档。

## Self-Review

- Spec coverage：覆盖代码基线、版本准备、GitHub/Apple、OSS/RAM/CDN、三平台资产、签名 Manifest、Candidate N→N+1、整包兜底、Stable 推广、官网入口和发布后不可降级规则。
- Placeholder scan：所有发布版本、仓库、Bucket、Origin、Profile、文件名和命令均为本次 1.0 的实际值；Bucket Region 必须使用控制台真实值，避免猜测。
- Type consistency：Candidate/Stable channel、版本、tag、资产名、OSS 前缀与 `current.json` 字段均与当前脚本契约一致。
