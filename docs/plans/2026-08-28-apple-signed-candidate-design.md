# Apple 签名候选包设计

## 目标

在不创建 `v*` 标签、不启动 Windows 签名和不发布 GitHub Release 的前提下，先验证 GitHub Actions 中的 Apple 证书、公证凭据与 Apple Silicon 正式应用签名链。该能力用于关闭研发阶段的 macOS Gatekeeper 分发门禁，不改变正式发布行为。

## 范围

`Release desktop installers` 增加两个手动目标：`apple-signing-preflight` 只验证证书与公证凭据，`macos-arm64-signed` 构建并上传 Apple Silicon 签名候选包。Intel 候选包暂不增加，既有 `macos`、`windows`、`all` 和 `v*` 标签路径保持原义。

预检必须验证六个 Apple secrets 非空、P12 可导入、临时 Keychain 中存在 `Developer ID Application`、证书 Team ID 与配置一致，并通过 `xcrun notarytool history` 验证 API Key。预检不得安装依赖或构建应用，所有临时密钥材料必须通过 `if: always()` 清理。

`macos-arm64-signed` 复用正式 Apple Silicon 构建、签名、公证、stapling 和 Gatekeeper 验证步骤，但跳过 Intel、Windows 与 `publish`。候选 Artifact 使用独立名称，不创建或更新 GitHub Release。正式 `publish` 继续只接受 `v*` 标签且要求两个 macOS 架构和已签名 Windows 包全部成功。

## 验证曲线

先在本地通过工作流结构测试、完整测试、类型检查和普通 build，再推送代码。远端先运行低成本预检；预检失败时只修复 secrets 或认证步骤，不构建安装包。预检通过后才运行 `macos-arm64-signed`，由 workflow 对 `.app` 和 DMG 执行 `codesign`、`spctl` 与 `stapler validate`。远端通过后下载确切 DMG，在启用 quarantine 的真实安装路径中验证启动、登录、Sidebar、设置和品牌，禁止使用 `xattr` 绕过 Gatekeeper。

## 停止条件

任何 secret 缺失、P12 无法导入、缺少 `Developer ID Application`、Team ID 不匹配、Notary Service 鉴权失败、签名或 stapling 失败都会停止后续阶段。当前未配置的 Windows UKey、`DESKTOP_WINDOWS_SIGNING_PIN` 与最终发布镜像凭据不属于本轮，禁止通过创建正式标签来间接验证 Apple 配置。
