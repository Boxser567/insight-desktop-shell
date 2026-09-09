# Desktop 发布说明

## 当前发布状态

截至 2026-09-09，桌面客户端尚未对外发布首个版本。已批准的生产更新机制是自有 HTTPS 域名后的 OSS/CDN；客户端不以 GitHub Releases 作为自动更新源。

客户端 Phase A 已完成：生产运行时只读取 `https://updates.insight-aigc.com` 的渠道指针与已签名版本目录，动态绑定 Generic Provider；模拟更新源已经删除。登录前和登录后的下载入口仅在发现真实可信更新后显示，更新窗口展示真实目标版本，并可从已验证 Manifest 打开同源完整 DMG/NSIS。

仓库的生产发布链已经按两阶段模型实现：

- 手动 `workflow_dispatch` 只接收 `candidate_tag`，用于 Candidate；
- 推送 `v*` tag 走 Stable；
- 三个平台构建后，`publish` job 在 `desktop-release` Environment 中生成签名 Manifest，只创建 GitHub Draft，不读取 OSS 凭证、不公开 Release；
- 独立 `Publish desktop updates` workflow 从 Draft 下载并复验同一批字节，通过 GitHub OIDC 向测试 Gateway 换取目录级 STS；`stage` 只写不可变版本目录，`promote` 才公开 GitHub Release 并最后提交 `current.json`；
- 版本化安装资产、YAML、blockmap、产品 Manifest、签名、CDN HEAD/Range/缓存/摘要验证和渠道指针单调性均已有自动门禁。

截至 2026-09-09，代码与本地测试已经完成，`v0.1.2-rc.3` 只完成 macOS Apple Silicon 定向候选验收；尚未运行符合新发布契约的完整 GitHub Draft、OSS 暂存、三平台安装和 Candidate N→N+1 演练。[`upload_oss_test` Run #7](https://github.com/BreezeWind889988/upload_oss_test/actions/runs/34319570470) 已证明测试 Gateway 接受 `{}`、签发目录级 STS，并完成真实 OSS `PutObject`。生产 Origin 的 CDN 到私有 OSS 鉴权已响应成功，`stable/current.json` 与 `candidate/current.json` 均尚不存在。完整 Candidate 与 Stable 安装证据齐全前不得执行 Stable `promote`。

## 必读资料

- [因赛AI Desktop 客户端构建 Runbook](client-build-runbook.md) 是当前构建步骤、停止条件和人工门禁的权威说明。
- [2026-08-27 Core Runtime 与 Better Sidebar 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md) 记录 Runtime、Profile、Sidebar、平台构建和上传故障的历史原因。
- [2026-09-08 macOS Safe Storage 候选版故障与验收](incidents/2026-09-08-macos-safe-storage-candidate.md) 记录正式签名包重复请求钥匙串授权的根因、隔离规则和 `v0.1.2-rc.3` 定向候选验收范围。
- [桌面客户端 OSS 更新分发设计](plans/2026-09-08-desktop-update-oss-distribution-design.md) 是已实现的生产分发契约；当前构建和发布操作以本说明、客户端构建 Runbook 和实际脚本为准。
- [桌面更新 STS 发布设计](plans/2026-09-09-desktop-update-sts-publishing-design.md) 是发布身份、后台契约、STS 刷新和大文件失败语义的权威说明。
- [因赛AI Desktop 1.0 正式发布前验证计划](superpowers/plans/2026-09-09-desktop-v1-release-verification.md) 是本次首发逐项执行、停止判断与证据收集清单。
- [模型 Gateway 接入与验收](model-gateway-integration.md) 记录 1.0 测试用户中心/模型同环境决策、无需用户填写 API Key 的实现及真实账号发布门禁；当前在独立功能分支完成，合入后必须纳入 Candidate 重验。

重大 Core、Shell、默认插件、工具链或 upstream 更新前必须阅读 Runbook 和相关复盘。历史复盘中的临时做法不得覆盖当前脚本和 Runbook。

## 分支与版本规则

### 固定应用身份（2026-09-09 首发前确认）

| 用途 | Bundle ID / appId | 产品名 | userData 目录名 |
| --- | --- | --- | --- |
| Candidate / Stable | `com.insight-aigc.desktop` | `因赛AI` | `insight-desktop` |
| DEV | `com.insight-aigc.desktop.dev` | `因赛AI Dev` | `insight-desktop-dev` |

Bundle ID 与包内 `insightDesktopAppId` 必须一致；Candidate 不增加 `.candidate` 身份。服务域名、OSS 路径和签名配置不随此次命名变更。旧 `com.insight.desktop` / `.dev` 仅保留为历史记录及既有旧包渠道识别，不再用于新构建。详细边界见 [Bundle ID 首发规范](plans/2026-09-09-desktop-bundle-identity-design.md)。

旧身份 Candidate 的签名、钥匙串及安装/升级验收不能直接复用：必须重新构建新身份 Candidate，并从新身份开始 N→N+1 演练。不得修改旧 `.app` 的 Info.plist、覆盖已有 tag/资产或通过清除用户数据完成“迁移”。此次代码变更不表示本地签名流程已经改造，也不自动修复旧钥匙串条目。

### 分支管理

- `main` 是唯一长期集成基线；功能、修复和发布基础设施分支通过审核后合入 `main`，不得维护第二条长期发版主线。
- Candidate 与 Stable 必须从 `main` 上可追溯的提交构建。进入版本冻结后如仍需并行开发，可从 `main` 创建短生命周期 `release/vX.Y.Z`，只接收该版本的阻断修复；发布或取消后合回 `main` 并删除。
- Candidate 使用不可复用的 `vX.Y.Z-rc.N`，Stable 使用 `vX.Y.Z`。禁止移动 tag、覆盖 GitHub/OSS 资产或回写低版本渠道指针。
- 发布前的版本号、策略和 Runtime 锁调整使用独立提交；正式 tag 只打在测试、构建和人工门禁均通过的提交上。

## 进入安装包构建前

触发 GitHub 安装包前，必须完成 Runbook 阶段 1–8，并保留以下证据：

- 变更范围、Shell commit、Core Runtime tag/commit、目标平台和用户数据目录已记录；
- 定向测试、`npm test`、`npm run typecheck` 和普通 build 已按变更范围通过；
- `core-runtime.lock.json` 指向资产完整、哈希和 `runtime.json` 一致的已验收 Runtime Release；
- 独立本地 DEV 应用的绝对路径和 Runtime 身份明确；
- 全新 Profile 与既有 Profile 启动均正常，会话、工作区、设置和用户插件未丢失；
- `dsh-better-sidebar@0.16.1` 已复制并注册，Markdown 和 HTML 实际在 Sidebar 内打开；
- `dshmarket@1.44.0` 已复制并完成宿主适配，必需插件受保护，用户卸载的可选插件不会被升级流程回填；
- 没有插件恢复窗口或无限启动页，并已收到明确人工验收结果。

本地阶段未通过时禁止用 GitHub Actions 继续远程调试。Shell 发布标签也不得隐式升级 Core Runtime；Runtime 锁变更必须是独立、可审核的 Shell 提交。

## GitHub Actions

安装包 workflow 名为 `Release desktop installers`，定义在 `.github/workflows/release.yml`。手动运行必须填写尚不存在的 `candidate_tag`，并从以下 `target` 中选择：

- `macos-arm64`：构建、签名、公证并上传 Apple Silicon 候选包，同时运行 Sonoma 分发兼容检查；
- `macos-x64`：构建、签名、公证并上传 Intel macOS 候选包；
- `windows-x64`：使用 `windows-2022` runner 构建未签名 Windows x64 候选包；
- `all`：构建全部上述目标并在所有门禁通过后生成完整 Candidate Release。

## 一次性发布准备

1. 确认 `insight-desktop-updates` 保持私有且从未启用 Bucket Versioning。OSS 的禁止覆盖语义在已启用或已暂停 Versioning 的 Bucket 中无效。不要给该 Bucket 开 WORM，因为 `current.json` 是唯一需要覆盖的对象。该项通过控制台一次性验收，不在每次发布时调用控制面 API。
2. 测试 Gateway 固定为 `https://gapi-test.insight-aigc.com/insight-harness-llm-gateway`。后台必须部署目录级 STS 契约：`POST /v1/upload/sts/token` 在 GitHub OIDC Bearer Token 鉴权后接受 `{}`，不得要求 `fileName` 或登录用户。
3. Gateway 的 GitHub OIDC allowlist 至少包含桌面仓库 ID `1344679131`，audience 固定为 `insight-harness-oss-upload`；若限制 workflow/ref/event，还要允许 `publish-update.yml@refs/heads/main`、`refs/heads/main` 和 `workflow_dispatch`。桌面 job 使用 `desktop-release` Environment，若校验 `sub`，允许值应为 `repo:Boxser567/insight-desktop-shell:environment:desktop-release`。
4. Gateway 实际 AssumeRole 的 RAM 角色需要 Bucket 级 `oss:ListObjects`，以及 `insight-desktop-updates/desktop/*` 的 `oss:GetObject`、`oss:PutObject`。发布 workflow 不需要删除对象、列举全部 Bucket 或修改 Bucket/ACL/CDN。
5. 在 `upload_oss_test` 最新 `main` 上重新运行 `Test GitHub OIDC STS`。只有 `{}` 获取 STS 成功、上传者自行生成 object key、真实 `PutObject` 返回 HTTP 200 且日志脱敏后，才允许桌面仓库首次真实 `stage`。
6. GitHub 的 `desktop-release` Environment 保存构建所需签名凭据，并作为 `Release desktop installers` 和 `Publish desktop updates` 的人工保护门禁；不配置任何 OSS 长期 AccessKey Secret。
7. CDN 加速域名固定为 `https://updates.insight-aigc.com`，源站为私有 OSS Bucket 并启用私有 Bucket 回源鉴权。`/desktop/releases/*` 不压缩、不改写、不重定向并支持 HEAD/Range；缓存遵守源站的一年 immutable。`/desktop/*/current.json` 遵守 60 秒缓存和重新验证。不得启用会拦截 Electron 主进程无 Referer 请求的防盗链。

Gateway 临时会话的最小 OSS Policy 如下；`Resource` 不得扩大到其他 Bucket：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:ListObjects"],
      "Resource": ["acs:oss:*:*:insight-desktop-updates"]
    },
    {
      "Effect": "Allow",
      "Action": ["oss:GetObject", "oss:PutObject"],
      "Resource": ["acs:oss:*:*:insight-desktop-updates/desktop/*"]
    }
  ]
}
```

后台完成后保留以下验收证据：

- [x] `upload_oss_test` [Run #7](https://github.com/BreezeWind889988/upload_oss_test/actions/runs/34319570470) 成功；
- [x] object key `1788935604227.txt`，OSS request ID `6AA0FDB567B311333387BD1EB`，`PutObject` HTTP 200；
- [x] STS 请求体为 `{}`；脱敏响应为 `SUCCESS`，包含 900 秒凭证、固定 Bucket/Region/endpoint、`dir: ""`、`fileType: "file"`、repository/run claims，不含 `fileName`/`userId`；
- Bucket Versioning/WORM 的控制台人工确认；
- `https://updates.insight-aigc.com` 的 CDN 规则截图或配置记录。

## 生产发布流程

实现完成后，由两个职责分离的 GitHub workflow 执行：

1. 校验 tag、渠道、版本、发布策略、Runtime 锁和发布配置。
2. 在 macOS arm64、macOS x64 和 Windows x64 各构建一次，完成签名、公证、YAML、blockmap 和安装器结构验证。
3. 汇总相同制品，生成并签名 `insight-update.json`，执行完整资产校验。
4. `Release desktop installers` 创建 GitHub Draft Release 并上传同一批字节；该 workflow 没有 OIDC 或 OSS 权限。
5. 操作者从 `main` 手动运行 `Publish desktop updates`，选择 `stage`；workflow 通过 GitHub OIDC 与测试 Gateway 获取目录级 STS，从 Draft 下载全部 Assets 并重新验证签名、文件集、版本和摘要。
6. 确认 OSS `desktop/releases/v<version>/` 不存在，然后使用普通 `PutObject` 上传完整不可变版本目录；每个文件前检查 STS，临期则刷新，令牌失效时整文件重试一次。
7. 从 `https://updates.insight-aigc.com` 验证 HTTPS、HEAD、Range、缓存、大小和摘要，并完成该版本确切安装包的推广前验收。
8. 人工确认后从同一 workflow 选择 `promote` 并填写精确确认版本；发布器先公开 GitHub Release，再从 OSS 权威指针确认渠道版本单调递增。
9. 最后更新该渠道唯一的 `current.json`，等待或确认其在约定 TTL 内收敛并执行外部 canary；Candidate 的 N→N+1 必须在 Candidate 指针生效后立即完成，Stable 则必须在推广前已有完整 Candidate 升级证据。

单平台 target 只上传对应 Actions artifact，不创建 tag 或 GitHub Release，也不运行 Publish。它用于关闭一个平台的候选门禁，不能替代完整 Candidate/Stable 发布。人工通过单平台包后，使用同一 `candidate_tag` 和 `target: all` 执行完整 Candidate；Stable 只由已存在的 `vX.Y.Z` tag push 触发，并始终等同于 `all`。

macOS 候选与 Stable 路径均需要 GitHub 配置 `DESKTOP_CSC_LINK`、`DESKTOP_CSC_KEY_PASSWORD`、`DESKTOP_APPLE_API_KEY`、`DESKTOP_APPLE_API_KEY_ID`、`DESKTOP_APPLE_API_ISSUER` 和 `DESKTOP_APPLE_TEAM_ID`。证书必须包含匹配 Team ID 的 `Developer ID Application`；本机 `Apple Development` 证书不满足外部分发要求。下载后的签名 macOS 候选必须保留 quarantine 并按阶段 10 验证；需要 `xattr` 才能启动即判定失败。

安装包 workflow 成功并生成 Draft 后，从 GitHub Actions 手动运行 `Publish desktop updates`：

- Ref：`main`
- `command`：`stage`
- `tag`：`v1.0.0-rc.1`
- `confirm_version`：留空

`stage` 成功只表示版本目录已上传并通过最终 CDN 复验，不会公开 GitHub Release，也不会改变客户端看到的版本。最终 CDN 验证器会按文件类别拒绝缺失或异常 MIME、错误缓存、缺失 Range、重定向和字节差异。脱敏摘要报告作为 workflow artifact 保留 90 天。

Candidate 在完成确切安装包的干净安装和静态验证后执行下述 `promote`，让 Candidate 指针生效，再立即从已安装的前一个 Candidate 完成 N→N+1 canary；失败时停止并发布更高的 RC，不降级或覆盖旧版本。Stable 只有在 Candidate N→N+1、同源整包兜底及 Stable 确切安装包验收全部通过后，才执行同一命令：

- Ref：`main`
- `command`：`promote`
- `tag`：`v1.0.0-rc.1`
- `confirm_version`：`1.0.0-rc.1`

Stable 使用相同命令和 `v1.0.0` / `1.0.0`。`promote` 会再次下载并校验 Draft、复验 CDN、校验权威旧指针严格递增，随后先公开 GitHub Release，再重读指针，最后写入 `current.json` 并等待最多 120 秒收敛。若公开后发生瞬时失败，可用完全相同参数安全重跑；脚本只在远端指针已经精确指向该版本时进入收敛复验，不会降级或覆盖版本目录。

## 首发专用门禁

运行时按阶段区分 install、test、Runtime、Profile、builder、签名/公证、blockmap 和 upload 失败；纯上传基础设施故障只重跑失败 job。

完整 Candidate/Stable 发布还会在 `macos-14` 上下载并只读挂载 Apple Silicon 最终 DMG，对镜像内 `因赛AI.app` 重新执行严格 codesign、`syspolicy_check distribution` 和 stapling 检查。该任务是面向 Sonoma 的临时发布阻断条件；它不能代替当前 macOS 14.5 目标机保留 quarantine 的首次启动和连续三次重启验收。GitHub 停止提供 `macos-14` runner 前，必须将这项检查迁移到仍受维护的真实消费端环境。

CI 成功只证明 workflow 对应 job 完成并生成了产物，不能证明安装后的 Sidebar、用户数据或启动行为正确。

现有 `v0.1.2-rc.1`、`v0.1.2-rc.2` 已是公开 Pre-release，`v0.1.2-rc.3` 只有单平台 Actions artifact，均不能替代新 Draft-only/OSS 两阶段契约的首发验收。准备 `1.0.0` 时必须使用未占用的连续版本：

1. `v1.0.0-rc.1` 在 macOS arm64、macOS x64 和 Windows x64 完成干净安装并推广 Candidate 指针。
2. `v1.0.0-rc.2` 从 rc.1 在客户端内完成检查、下载、校验、安装和重启；如 rc.2 仍有阻断修复，继续递增 RC，禁止覆盖旧资产。
3. `v1.0.0` 的确切 Stable 制品完成干净安装与覆盖安装。
4. 在可信 Manifest 已解析后人为让自动下载失败，确认更新窗口可以从同一版本目录下载适配架构的 DMG/EXE 并完成覆盖安装；完全禁用更新 Origin 时应安全失败。
5. 上述证据齐全后，才允许首次写入 `stable/current.json`。

## 最终安装验收

从本次 GitHub Draft 或 OSS 不可变版本目录下载确切安装包后，在目标平台完成：

- macOS DMG 校验、完整 bundle 签名、Gatekeeper、notarization 和 stapling 检查；
- macOS 14.5 上保留 quarantine 启动，确认不出现“已损坏”或重复钥匙串授权提示，并连续退出、重启三次；
- Windows 核对产品 Manifest 摘要，接受当前预期的 SmartScreen/未知发布者提示，但必须能继续安装；
- 完成干净安装和覆盖安装；Candidate 完成 N→N+1 客户端更新；
- 验证首次启动、既有 Profile、Sidebar、会话、工作区、设置和插件清单；
- 验证登录前、Core 失败和更新错误状态仍能进入更新窗口；只有已有可信 Manifest 时才显示同源整包入口；
- 核对实际版本、应用路径、用户数据目录和 Runtime 身份。

验收前退出同 App ID/channel 的旧实例，并核对实际进程和应用路径。人工结果只对明确命名的安装包、应用路径和 Runtime tag 有效。

DMG、zip、NSIS 和 blockmap 是不同产物层。某一格式失败时要记录影响范围；例如已单独验收的 DMG 可保留 macOS 功能结论，但 zip 失败仍是未解决的发布格式问题，不能写成整次发布完全通过。

## 发布记录

每次候选或正式发布至少记录：

- tag、channel、Shell commit、Core Runtime tag/commit、Node 和包管理器版本；
- `Release desktop installers` run URL、attempt、target 和各 job 结果；
- OSS 版本前缀、最终 CDN 验证结果、GitHub Draft/Release URL；
- 安装包与更新元数据的文件名、架构、大小、SHA-256 和 Manifest SHA-512；
- 推广前 `current.json`、待发布 `current.json` 和实际提交后的响应；
- 干净安装、覆盖安装、N→N+1、同源整包兜底和数据保留结果；
- Sidebar Markdown/HTML、启动恢复、启动页、会话、工作区、设置和插件清单结果；
- 已知的平台或格式问题、确认不受影响的范围和下一验证阶段。

完整记录可直接使用 [客户端构建 Runbook 的模板](client-build-runbook.md#构建记录模板)。
