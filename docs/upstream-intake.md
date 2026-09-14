# DSH Desktop 上游接收规范

`dataelement/dsh-desktop` 是因赛AI Desktop 的参考上游，不是定期整体合并的基线。每次审计必须指定 upstream commit range，只定向采用已经确认对产品有价值且能独立验证的变更。

可以进入采用评估的内容包括 Electron 或操作系统生命周期修复、更新与发布流程修复、插件恢复或 Profile 安全修复，以及锁定 Core Runtime 所需的 Harness 兼容性变化。上游品牌、产品身份、内置 Harness 包、dshmarket、分析服务、部署服务、App ID、Profile、更新域名、`package.json`、Lockfile 和完整发布工作流默认拒绝。

selective adoption 必须与 Core Runtime 锁更新分成独立提交和验证批次。采用前后均按[客户端构建 Runbook](client-build-runbook.md)选择最低验证阶段，并保护登录、账号隔离、Better Sidebar、第一方集成、产品资源和用户数据。

## 上游接收记录

### 2026-09-14：Windows 定向适配与升级路线审计

- 审查范围：`e589bf688624871d953f8c58418f913c407dfc7e..6a9c6687c14f9d4183d6907935024f9dd804043e`；公开 Latest Release 为 `v0.8.2`，main 已包含 Harness `0.1.5-rc.2`。
- 结论：保留 Insight 产品基线，Shell 修复与 Core 升级分批验证；不整体合并当前 main。完整证据、采用矩阵、企业登录分支对照与后续门槛见 [升级决策](analysis/2026-09-14-upstream-strategy.md)。
- 本地采用：`a6ffac7` 的 Windows PATH 读取，额外统一所有大小写字段的最终值；`c52f450` 的 Windows Harness 进程组隔离；`1454ea3` 的标题栏 inset URL 信号。
- 文件：`src/main/runtime/harness-runtime.ts`、`src/main/runtime/profile-plugin-command.ts`、`src/main/window-navigation.ts` 及相应测试。
- 产品保护：保持认证、账号目录/Session 分区、凭证 IPC、Safe Mode Gateway、Core lock、发布身份、签名更新和 RC9 进程树清理。
- 暂缓：灰度需自有服务端契约；版本回退需数据兼容方案；GPU/缓存/插件恢复需账号生命周期适配；新 Core/市场/原生 helper 独立原生构建。拒绝上游品牌、上传服务、任意降级和整套发布 workflow。
- 验证：聚焦 85 项通过；全量 625 项通过证据包含系统 Python 下的失败文件重跑；类型检查、普通 build、锁定 Runtime 校验与 preload 检查通过。达到构建 Runbook 阶段 6，Windows 原生行为与安装验收待完成。
- 状态：本地分支 `codex/upstream-intake-20260914` 的可审查修改，未发布。

### 2026-09-14：用户确认后的稳定性适配与 Core 候选

- 继续同一 upstream 范围，Shell 接入有限 renderer/GPU 恢复、按账号 HTTP cache 与稳定端口、Profile 修复失败保留声明、多插件定位、活动 view 菜单、boot observer 停止和更新请求超时。
- 新旧 Core 桥接：CLI runCli 特性检测、启动 token/Cookie 导航与日志脱敏、第一方 Gateway prepareExtensions、移除已删除的 client-runtime 注入。
- Core 在 `/private/tmp/insight-core-upgrade-20260914` 合入 `dsh-v0.1.5-rc.2`；提交 `3ef71e2d8a`、`abcf8ddf6e`、`33a669535c`。保留 Insight 设置入口/slots 与发行链，修复部署 peer 闭包、硬链接清单污染及 pnpm 部署错位。原 Core 工作区未改动。
- 兼容发现：当前 Sidebar 0.16.1 阻断新 Core 启动；临时采用 Sidebar 0.19.1 / Market 1.46.1 后，完整内置组合 Host 冒烟通过。此组合尚未完成新的生产依赖锁、Insight Market 管理策略和 Renderer 交互验收。
- 验证：Shell 107 文件 / 686 测试一次通过，typecheck 与 build 通过；Core official build、26 文件 / 871 聚焦测试、更新后的部署脚本 9 测试通过；独立 darwin-arm64 制品、5 项真实 Gateway IPC 和 Profile Host 冒烟通过。
- 保留门禁：三平台原生制品/安装升级、真实账号与 Safe Mode 交互、存量数据复制迁移；灰度需自有 API。详见 [第二阶段结果](analysis/2026-09-14-upstream-strategy.md#用户确认后的第二阶段执行结果)。
- 产品 Core lock、Sidebar/Market 版本、签名更新与发布通道尚未切换；本地实施完成部分不等于已上线或全部上游兼容完成。

### 后续记录模板

- 审查日期：
- 上游 Commit 范围（upstream commit range）：
- 审查类别：Electron 生命周期 / 更新器 / 恢复 / Core 兼容 / 上游产品专属
- 采用的 Commit 与文件：
- 拒绝的变更及原因：
- Insight 产品差异：
- 本地适配：
- 聚焦测试：
- 构建手册达到的阶段：
