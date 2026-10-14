# Canvas × Harness 方案 B 专项讨论

本目录集中保存本次对话形成的调研、设计、模板契约与交互案例。当前约束：修改插件与 Web 画布，后端保持不改；API 提交命令，SSE 推送变更与任务状态。用户已确认原有画布支持模板一键执行与依赖等待，生成、loading 和结果监听也已具备。当前方向是补齐对话接入层，复用现有业务。任务1服务、任务2桥、任务3创建/普通节点及任务4图片素材接入的编码与自动验收已完成；任务3用户手测最小目标、任务4真实账号图片闭环已通过，完整历史人工矩阵仍按各归档区分。

2026-10-14 最新停点：用户在alpha.12/103161确认三节点及字段修改成功，但首次无界面调用被拒绝、连续编辑出现整图重载、P05复用图片被模型配置502阻断。alpha.13已修复冷上下文权威读取和健康图配置故障的连锁封写，并补清普通confirmed回读、node.changes及失败停步说明。插件173/Web276、Host默认/实际Core类型、构建、58包文件一致性及临时实际Core七工具/SSE/卸载检查通过；Web仍原有9诊断，无新增。alpha.13尚未替换当前客户端alpha.12，真实复测从R01–R03开始；P03/P04和其余图编辑人工结果仍待具体反馈。任务5/6、生成、抠图执行、工具节点创建、模板和完整版Skill继续暂缓，后端与原生UI代码保持。

## 阅读入口

- [插件内独立契约模块：步骤1–2实施计划](plans/2026-10-14-plugin-tool-contracts-phase-1-2-plan.md)：当前获准的下一项开发计划，以alpha.13源码为基线；先固定七工具兼容基线，再新增一个纯声明模块并调整三个Host文件。含文件边界、开发步骤、验证命令与C01–C11验收；本轮仅归档，尚未修改业务代码。
- [七工具契约映射](plans/2026-10-14-plugin-tool-contracts-map.md)：完整输入分支、输出差异、原生命令/方法及通信兼容规则；配套[冻结目录](preflight/2026-10-14-canvas-tool-contracts-baseline.json)和[计划参考检查记录](preflight/2026-10-14-canvas-tool-contracts-plan-checks.json)。
- [alpha.12反馈、alpha.13修复及三步复测](implementation/2026-10-14-alpha12-feedback-and-alpha13-fixes.md)：103161实账事实、冷刷新/502/重载根因与边界；R01冷读取、R02可见连续编辑、R03复用原图可复制Prompt。
- [alpha.13检查摘要](implementation/2026-10-14-alpha13-checks.json)：173/276、类型基线、包SHA、独立Review、隔离实际Core及仍待真实验收项。
- [Overu 最新 workflow-op 与 alpha.12 复审](research/2026-10-14-workflow-op-77fb977-protocol-review.md)：以远端 main 和新增提交77fb977重新核对，仅比较调用/通信/协议；保持插件执行链路，借鉴公开契约与上下文设计，不整套迁移。含批内引用删除、原生规则复用、版本/未知保存缺口、27通过/3失败与10项隔离探针证据。
- [旧提交 workflow-op 与 alpha.12 协议比较](research/2026-10-13-workflow-protocol-deep-comparison.md)：2f162ea历史结论；当时的clientId/dryRun/patch幂等字段已在新提交删除。当前取舍以上述77fb977复审为准，旧融合草案未实施。
- [旧提交 workflow-op 架构对比](research/2026-10-13-workflow-op-architecture-comparison.md)：2f162ea历史实现与部署调查；新提交已切换远端后端，发布部署不在本轮范围，不作为当前合并依据。
- [alpha.12逐条可复制Prompt](implementation/2026-10-13-alpha12-copyable-prompts.md)：当前真实账号手测入口，P01–P10覆盖修改、真实连线、合法配置、保ID改接、两图输入排序、删边/删节点、权威重载；无代码或媒体生成。
- [alpha.12图编辑实施与Review](implementation/2026-10-13-agent-graph-edit.md)：真实端口/边、节点修改删除、合法模型配置、无iframe链路、五项Review修复、172/266与包证据。
- [alpha.12安装与图编辑手测](implementation/2026-10-13-agent-graph-edit-live-acceptance.md)：G01–G06创建/导图、连线、当前模型、更新、改接/排序/删除、原生UI及权威重载；真实账号待反馈。
- [图编辑专项实施计划](plans/2026-10-13-agent-graph-edit-implementation-plan.md)：本轮文件/契约、原生复用、步骤目标和验收，编码及自动化已勾选。
- [alpha.12验收摘要](implementation/2026-10-13-agent-graph-edit-checks.json)：包SHA、源差异、类型基线、隔离实际Core七工具和实账边界。
- [自动放置实施与Review](implementation/2026-10-13-agent-placement.md)：alpha.11实际契约、模块/Store集成、原生复用、parentId读取兼容修复、153/207与包证据；沿节点延展可允许重叠，不重排全图。
- [alpha.11安装与坐标手测](implementation/2026-10-13-agent-placement-live-acceptance.md)：新包导入、默认追加、精确坐标、锚点延展、重载与原生UI核对；真实账号待反馈。
- [自动放置专项实施计划](plans/2026-10-13-agent-placement-implementation-plan.md)：文件边界、三种策略、原生尺寸准备后计算、strict队列和验收。
- [节点坐标、防重叠与原生排版调研](research/2026-10-13-node-placement-and-layout.md)：保留修复前调查与更广泛后续建议；默认自动放置已由alpha.11实施，局部layout工具/生成后校准尚未开放。
- [Agent画布能力覆盖与推进修订](plans/2026-10-13-agent-canvas-capability-expansion.md)：核对耳机用例暴露的范围缺口；原生20类型、连线/执行/抠图事实；基础图操作→耳机闭环→高频能力的推进建议；80%按真实业务验收衡量，任务5/6仍暂缓。
- [任务1–4能力与手测清单](implementation/2026-10-13-tasks-1-4-manual-consolidation.md)：当前五工具与底座边界，M01–M08主流程、补充边界测试、保护类测试限制、结果反馈格式；暂缓任务5/6。
- [任务4实施与验收](implementation/2026-10-13-task-4.md)：实际接口、文件/原生方法复用、去重与unknown、review修复、最终包、当前账号103165完整最小闭环。
- [任务4真实账号复验步骤](implementation/2026-10-13-task-4-live-acceptance.md)：当前已验收，不需重复安装/创建；提供一条附图prompt及正确结果标准。
- [任务4详细实施计划](plans/2026-10-13-task-4-asset-implementation-plan.md)：共享契约、SDK/上传/登记、模型工具、原生保存与完成清单。
- [任务4准备与推进顺序](plans/2026-10-13-task-4-asset-preparation.md)：保留前置调查；接口与实施结果已由详细计划/归档替代。
- [任务3用户手测归档](implementation/evidence/2026-10-13-task-3-user-dialogue-results.json)：画布103161、两条原始prompt、用户确认结果与尚未提供的细节。
- [任务3真实Agent手测](implementation/2026-10-13-task-3-live-acceptance.md)：本次最小目标已按用户报告通过，保留完整诊断步骤供问题排查。
- [任务3实施与验收](implementation/2026-10-13-task-3.md)：实际三工具、API/桥复用、去重和unknown、SDK兼容、Review修复、最终包及证据。
- [任务3最小工具专项计划](plans/2026-10-13-task-3-minimal-dialogue-tools-plan.md)：本轮具体文件、入参出参及完成清单，替代早期自动打开/生成的任务3范围。

- [真实账号手测步骤与目标](implementation/2026-10-13-task-2-live-acceptance.md)：安装、聊天会话SSE、无界面服务读取/新增/严格保存、权威重载及原生UI核对；提供A/B/C可复制脚本，明确Console直调不替代完整Host命令验收。

- [任务 2 实施与验收](implementation/2026-10-13-task-2.md)：v3 context通信、原服务执行、会话归属、去重/unknown/重连；插件84/Web170，实际Core隔离安装通过，真实账号Console三项符合条件，剩余人工核对继续进行。
- [任务 2 最小桥专项计划](plans/2026-10-13-task-2-minimal-bridge-plan.md)：替代旧frame/postMessage任务2拆解，已勾选实际完成步骤及当前接口。

- [任务 2 前置核对与收口](implementation/2026-10-13-before-task-2.md)：本轮补齐任务 1.5 记录，定向126/126通过，43个已归档源文件/5个构建文件/tgz一致；明确用户暂缓项及下一阶段的最小范围。

- [任务 1.4 实施与整体 Review](implementation/2026-10-13-task-1-4.md)：当前状态、实际接口、文件 / 方法复用、review 修复、测试证据与剩余实账验收；Web167 / 插件59，使用 Shell 自带 Core / Node 和本机 Chrome。

- [任务 1.4 服务化实施计划](plans/2026-10-12-task-1-4-service-plan.md)：当前开发依据；明确 Client 服务位置、每画布上下文、共享 Store、文件 / 接口、关闭面板生命周期及 M1–M17 手动验收。1.4.1–1.4.7编码完成；1.4.8仍保留真实业务 / Electron人工验收未勾选项。

- [任务 1.4.3 实施与验收](implementation/2026-10-12-task-1-4-3.md)：Client 生命周期的懒加载服务、按画布registry、双入口与实际打包检查；新增25个测试，Web127 / 插件59通过，使用实际Node24.9.0。

- [任务 1.4.2 实施与验收](implementation/2026-10-12-task-1-4-2.md)：复用原 API / init 准备上下文，区分可读 / 可写 / 可生成，保护未知保存与生命周期；新增34个测试，Web累计113个通过。

- [任务 1.4.1 实施与验收](implementation/2026-10-12-task-1-4-1.md)：每画布原生 Store / barrier / guard 工厂与默认 UI 兼容；新增17个测试，Web累计79个通过。

- [任务 1.3 实施与验收](implementation/2026-10-12-task-1-3.md)：草稿防覆盖、严格入口互斥和 DesktopCanvas 事件保护已完成；新增 21 个回归用例，Web 累计 62 个通过。

- [任务 1.2 实施与验收](implementation/2026-10-12-task-1-2.md)：严格保存、队列版本校验和局部恢复已完成；新增 28 个回归测试，Web 累计 41 个通过。
- [任务 1.1 实施记录](implementation/2026-10-12-task-1-1.md)：共享契约、输入解析、字段映射与原生节点构造已完成；新增 20 个测试通过。保留本项历史验收事实。
- [前置方法清单与开发基线](preflight/2026-10-10-native-methods-and-baseline.md)：本轮已完成的准备项；真实函数、导入方式、适用范围、回执缺口、41 个测试与 Web 现存诊断，以及下一步任务 1.1 的入口。这是实施前基线，后续进展见各项实施记录。
- [任务 1–3 开发实施计划](plans/2026-10-10-canvas-dialogue-tasks-1-3-implementation-plan.md)：当前开发拆解入口；明确文件、复用方法、严格保存回执、通信桥、四工具、实施步骤与验收。已勾选任务 1.1–1.3；1.4 服务化专项计划优先，旧 frame 运输章节已标记迁移。
- [任务 1–3 工具与通信契约](plans/2026-10-10-canvas-dialogue-tasks-1-3-contracts.md)：工具输入/输出、Host/Client/iframe 消息、路由归属、SSE、版本、去重与未知提交处理；配合实施计划阅读。
- [早期修订版：对话接入设计与 8 项编码任务](plans/2026-10-10-canvas-dialogue-bridge-design.md)：当前方案的主要依据；围绕 Skill、原生模板、工具和双向通信桥，复用画布已有依赖执行。
- [服务化修订前的交互说明](dialogue-bridge.html)：空画布、模板与节点修改三条实际路径，明确每一步由谁处理、调用什么、缺失信息如何阻断。离线设计演示，不调用真实 API。

## 历史参考

- [上一版交互案例](index.html)、[评审页](delivery-plan.html)和[执行蓝图](plans/2026-10-10-canvas-scheme-b-execution-blueprint.md)：此前引入额外阶段编排和本地媒体运行时，超出了本次对话接入目标；已被修订版替代，不作为首期编码依据。
- [上一版场景契约](plans/2026-10-10-canvas-scheme-b-reference/scene-template.json)与[薄 Skill](plans/2026-10-10-canvas-scheme-b-reference/product-trendy-video/SKILL.md)：保留草稿，未安装；其中默认人物、生成规模与成片方案不作为本期既定要求。
- [初始技术调研](research/2026-10-09-canvas-harness-integration-research.md)：保留源码观察、能力清单和方案比较。商品海报属于早期示例。
- [旧模板具体设计](plans/2026-10-10-canvas-skill-3c-trendy-design.md)：保留29节点映射、旧参数与实现参考；产品行为以当前修订版为准。
- [旧例模板草稿](plans/2026-10-10-canvas-phase1-reference/template.json)与[旧例 Skill](plans/2026-10-10-canvas-phase1-reference/skill-3c-trendy/SKILL.md)：用于理解迁移过程，不直接提交到后端。

## 文件用途

dialogue-bridge.html 是当前交互说明。index.html 是历史交互案例；delivery-plan.src.html 是历史评审源文件，delivery-plan.html 是其生成页面，二者均已标注替代状态。

开发阅读顺序：任务 1.4 服务化专项计划 → 1.1–1.3 实施归档与基线 → 更新后的主实施计划 / 契约。1.4 服务化要求优先于早期设计和交互页面里的自动打开画布路径。产品讨论可先阅读修订版交互说明。首期工作是对话工具、桥接、素材引用、模板业务说明、节点引用与状态反馈；页面没有连接真实远端任务，不能作为新增接入能力已实现的证据。
