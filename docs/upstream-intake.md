# DSH Desktop 上游接收规范

`dataelement/dsh-desktop` 是因赛AI Desktop 的参考上游，不是定期整体合并的基线。每次审计必须指定 upstream commit range，只定向采用已经确认对产品有价值且能独立验证的变更。

可以进入采用评估的内容包括 Electron 或操作系统生命周期修复、更新与发布流程修复、插件恢复或 Profile 安全修复，以及锁定 Core Runtime 所需的 Harness 兼容性变化。上游品牌、产品身份、内置 Harness 包、dshmarket、分析服务、部署服务、App ID、Profile、更新域名、`package.json`、Lockfile 和完整发布工作流默认拒绝。

selective adoption 必须与 Core Runtime 锁更新分成独立提交和验证批次。采用前后均按[客户端构建 Runbook](client-build-runbook.md)选择最低验证阶段，并保护登录、账号隔离、Better Sidebar、第一方集成、产品资源和用户数据。

## 上游接收记录

- 审查日期：
- 上游 Commit 范围（upstream commit range）：
- 审查类别：Electron 生命周期 / 更新器 / 恢复 / Core 兼容 / 上游产品专属
- 采用的 Commit 与文件：
- 拒绝的变更及原因：
- Insight 产品差异：
- 本地适配：
- 聚焦测试：
- 构建手册达到的阶段：
