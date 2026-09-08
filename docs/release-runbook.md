# Desktop 发布说明

## 必读资料

- [因赛AI Desktop 客户端构建 Runbook](client-build-runbook.md) 是当前构建步骤、停止条件和人工门禁的权威说明。
- [2026-08-27 Core Runtime 与 Better Sidebar 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md) 记录 Runtime、Profile、Sidebar、平台构建和上传故障的历史原因。
- [2026-09-08 macOS Safe Storage 候选版故障与验收](incidents/2026-09-08-macos-safe-storage-candidate.md) 记录正式签名包重复请求钥匙串授权的根因、隔离规则和 `v0.1.2-rc.3` 定向候选验收范围。
- [桌面客户端 OSS 更新分发设计](plans/2026-09-08-desktop-update-oss-distribution-design.md) 是尚未实现的生产分发目标；当前构建和发布操作仍以本说明及现有 GitHub-only workflow 为准。

重大 Core、Shell、默认插件、工具链或 upstream 更新前必须阅读 Runbook 和相关复盘。历史复盘中的临时做法不得覆盖当前脚本和 Runbook。

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

单平台 target 只上传对应 Actions artifact，不创建 tag 或 GitHub Release，也不运行 Publish。它用于关闭一个平台的候选门禁，不能替代完整 Candidate/Stable 发布。人工通过单平台包后，使用同一 `candidate_tag` 和 `target: all` 执行完整 Candidate；Stable 只由已存在的 `vX.Y.Z` tag push 触发，并始终等同于 `all`。

macOS 候选与 Stable 路径均需要 GitHub 配置 `DESKTOP_CSC_LINK`、`DESKTOP_CSC_KEY_PASSWORD`、`DESKTOP_APPLE_API_KEY`、`DESKTOP_APPLE_API_KEY_ID`、`DESKTOP_APPLE_API_ISSUER` 和 `DESKTOP_APPLE_TEAM_ID`。证书必须包含匹配 Team ID 的 `Developer ID Application`；本机 `Apple Development` 证书不满足外部分发要求。下载后的签名 macOS 候选必须保留 quarantine 并按阶段 10 验证；需要 `xattr` 才能启动即判定失败。

运行时按阶段区分 install、test、Runtime、Profile、builder、签名/公证、blockmap 和 upload 失败；纯上传基础设施故障只重跑失败 job。

完整 Candidate/Stable 发布还会在 `macos-14` 上下载并只读挂载 Apple Silicon 最终 DMG，对镜像内 `因赛AI.app` 重新执行严格 codesign、`syspolicy_check distribution` 和 stapling 检查。该任务是面向 Sonoma 的临时发布阻断条件；它不能代替当前 macOS 14.5 目标机保留 quarantine 的首次启动和连续三次重启验收。GitHub 停止提供 `macos-14` runner 前，必须将这项检查迁移到仍受维护的真实消费端环境。

CI 成功只证明 workflow 对应 job 完成并生成了产物，不能证明安装后的 Sidebar、用户数据或启动行为正确。

## 最终安装验收

从本次 workflow run 下载确切安装包后，在目标平台完成：

- macOS DMG 校验、完整 bundle 签名、Gatekeeper、notarization 和 stapling 检查；
- macOS 14.5 上保留 quarantine 启动，确认不出现“已损坏”或重复钥匙串授权提示，并连续退出、重启三次；
- 干净安装和覆盖安装；
- 首次启动与既有 Profile 升级；
- Markdown/HTML 在 Sidebar 内打开；
- 无插件恢复窗口、无无限启动页；
- 会话、工作区、设置和插件清单符合预期；
- macOS 签名、公证和 stapling，或 Windows 安装、启动、卸载及所需签名状态。

验收前退出同 App ID/channel 的旧实例，并核对实际进程和应用路径。人工结果只对明确命名的安装包、应用路径和 Runtime tag 有效。

DMG、zip、NSIS 和 blockmap 是不同产物层。某一格式失败时要记录影响范围；例如已单独验收的 DMG 可保留 macOS 功能结论，但 zip 失败仍是未解决的发布格式问题，不能写成整次发布完全通过。

## 发布记录

每次候选或正式发布至少记录：

- Shell commit，Core Runtime tag、commit、Node 和 pnpm 版本；
- `Release desktop installers` run URL、attempt、target 和 job 结果；
- 安装包文件名、架构、大小，以及对外发布时的 SHA-256；
- 干净安装与覆盖安装结果；
- Sidebar Markdown/HTML 结果；
- 启动恢复、启动页、会话、工作区、设置和插件清单结果；
- 已知的平台或格式问题、确认不受影响的范围和下一验证阶段。

完整记录可直接使用 [客户端构建 Runbook 的模板](client-build-runbook.md#构建记录模板)。
