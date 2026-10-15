# 画布与 Harness 专题

当前基础：独立画布Plugin的核心能力已完成初步人工验收，源码审核/清理与首版提交候选为alpha.18。业务执行由Plugin常驻Client服务复用原生Store/保存队列；Core和后端业务不改，Agent无需打开画布即可操作。历史方案不作为当前接口说明。

## 当前交接

- [首版桥梁审核与清理](implementation/2026-10-15-plugin-first-submit-review.md)：职责、生命周期修复、冗余清理与本地提交范围。
- [alpha.18验证摘要](implementation/2026-10-15-alpha18-checks.json)：261/330回归、类型、隔离安装与实际归档；人工验收和自动化证据分开。
- [成果卡片手测](implementation/2026-10-14-alpha17-manual-acceptance.md)：该展示/导航步骤继续适用于alpha.18，无需重复生成素材；完整工具验收以Plugin当前 `docs/acceptance.md` 为准。
- 当前模块/公开契约/开发规范由独立 `desktop-canvas-plugin` 仓库README及docs维护，本专题不重复维护一套API。

## 仍有效的后续方向

- [模板与Skill下一步](next-steps.md)：继续暂缓，未自动进入研发。
- [业务调研输入](research/2026-10-09-canvas-harness-integration-research.md)、[旧潮流视频模板参考](plans/2026-10-10-canvas-skill-3c-trendy-design.md)：保留场景和素材参考，参数/旧方法不作当前实现承诺。
- [插件优先的设计依据](research/2026-10-14-canvas-result-entry-plugin-first.md)：保留Core频繁升级与将来平台迁移的取舍来源；实施状态以首版审核为准。

任务1–4及alpha.12–17已完成阶段的计划、逐版手测、重复patch/日志/源码快照、旧可视化和插件旧文档备份已集中至 [历史归档](../../archive/README.md)。所有清理前未提交原始内容按hash保留，可按manifest恢复；旧记录中的“尚未接入生成”或“当前验收入口”不覆盖此页。
