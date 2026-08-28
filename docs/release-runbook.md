# Desktop 发布说明

## 必读资料

- [因赛AI Desktop 客户端构建 Runbook](client-build-runbook.md) 是当前构建步骤、停止条件和人工门禁的权威说明。
- [2026-08-27 Core Runtime 与 Better Sidebar 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md) 记录 Runtime、Profile、Sidebar、平台构建和上传故障的历史原因。

重大 Core、Shell、默认插件、工具链或 upstream 更新前必须阅读 Runbook 和相关复盘。历史复盘中的临时做法不得覆盖当前脚本和 Runbook。

## 进入安装包构建前

触发 GitHub 安装包前，必须完成 Runbook 阶段 1–8，并保留以下证据：

- 变更范围、Shell commit、Core Runtime tag/commit、目标平台和用户数据目录已记录；
- 定向测试、`npm test`、`npm run typecheck` 和普通 build 已按变更范围通过；
- `core-runtime.lock.json` 指向资产完整、哈希和 `runtime.json` 一致的已验收 Runtime Release；
- 独立本地 DEV 应用的绝对路径和 Runtime 身份明确；
- 全新 Profile 与既有 Profile 启动均正常，会话、工作区、设置和用户插件未丢失；
- `dsh-better-sidebar@0.16.1` 已复制并注册，Markdown 和 HTML 实际在 Sidebar 内打开；
- 没有插件恢复窗口或无限启动页，并已收到明确人工验收结果。

本地阶段未通过时禁止用 GitHub Actions 继续远程调试。Shell 发布标签也不得隐式升级 Core Runtime；Runtime 锁变更必须是独立、可审核的 Shell 提交。

## GitHub Actions

安装包 workflow 名为 `Release desktop installers`，定义在 `.github/workflows/release.yml`。手动运行时 `target` 可选：

- `macos`：构建 Apple Silicon 与 Intel macOS 包；
- `windows`：使用 `windows-2022` runner 构建 Windows x64 包；
- `all`：构建全部上述目标；
- `apple-signing-preflight`：只验证 Apple P12、`Developer ID Application`、Team ID 与 Notary Service 鉴权，不安装依赖或构建应用；
- `macos-arm64-signed`：在预检通过后构建、签名、公证并上传 Apple Silicon 候选包，不创建 GitHub Release。

普通 `macos`/`all` 手动运行只生成未签名的 macOS DEV artifact，用于原生 runner 构建证明，不能作为可直接安装的候选包。签名候选必须先通过 `apple-signing-preflight`，再单独运行 `macos-arm64-signed`；预检失败时禁止继续构建。候选包与 `v*` 标签路径均需要 GitHub 配置 `DESKTOP_CSC_LINK`、`DESKTOP_CSC_KEY_PASSWORD`、`DESKTOP_APPLE_API_KEY`、`DESKTOP_APPLE_API_KEY_ID`、`DESKTOP_APPLE_API_ISSUER` 和 `DESKTOP_APPLE_TEAM_ID`。证书必须包含匹配 Team ID 的 `Developer ID Application`；本机 `Apple Development` 证书不满足外部分发要求。

`macos-arm64-signed` 只关闭 Apple Silicon 的研发分发门禁，不替代正式多平台发布。它不会构建 Intel 或 Windows，不会启动 Windows UKey 签名，也不会创建或更新 GitHub Release。下载后必须保留 quarantine 并按阶段 10 验证；需要 `xattr` 才能启动即判定失败。

运行时按阶段区分 install、test、Runtime、Profile、builder、签名/公证、blockmap 和 upload 失败；纯上传基础设施故障只重跑失败 job。

CI 成功只证明 workflow 对应 job 完成并生成了产物，不能证明安装后的 Sidebar、用户数据或启动行为正确。

## 最终安装验收

从本次 workflow run 下载确切安装包后，在目标平台完成：

- macOS DMG 校验、完整 bundle 签名、Gatekeeper、notarization 和 stapling 检查；
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
