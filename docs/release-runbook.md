# Desktop 发布说明

发布前在目标平台完成 `npm test`、`npm run typecheck` 和构建验证。Windows 使用 GitHub Actions 的 `windows-2022` runner；macOS 正式发布需要可用的 Apple 签名和 notarization 凭据。

发布版本时必须确认 `core-runtime.lock.json` 指向已验收的 Core Runtime Release。安装包中的 Runtime 清单、默认 Better Sidebar Profile 以及应用启动都应作为发布验收项。不要通过发布 Shell 标签隐式升级 Core Runtime。
