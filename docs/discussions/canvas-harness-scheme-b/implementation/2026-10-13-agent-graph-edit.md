# alpha.12 Agent真实图编辑实施与Review

本轮已完成批准的基础图编辑阶段：Agent无需打开画布即可读取真实图、修改/删除普通节点、增删/改接/排序连线，以及查询和保存合法图片/视频模型配置。复用现有业务，后端与原生UI入口保持现状。仍只编辑和保存；生成执行、创建抠图工具节点、模板和完整版Skill尚未开放，不能据此宣称已达到80%业务覆盖。

## 本轮交付

| 能力 | 实现 | 关键约束 |
|---|---|---|
| 真实图读取 | canvas_get(view:graph) | 真实节点/边/handles/尺寸/允许输入；节点和边各1–20项分页，续页绑定confirmed版本 |
| 普通节点修改 | canvas_node_edit(update) | title/text/prompt/合法标量params；来源媒体title-only，空媒体改画幅同时更新原生尺寸 |
| 普通节点删除 | canvas_node_edit(delete) | 原生关联边/空组清理；返回affectedNodeIds及affectedEdgeIds，保留存活下游缺输入提示 |
| 连线 | canvas_edges(add/delete/reconnect/reorder) | 真实端口、类型、容量；防重复引用及新增环；改接保ID，排序仅目标槽位 |
| 模型目录 | canvas_models | 当前账号权限过滤，独立catalogVersion分页；目录默认参数和节点当前参数区分 |
| 合法生成配置保存 | canvas_node_edit(configure) | 显式值先校验，复用模式/模型迁移、级联默认、空节点尺寸；不执行生成 |

已有canvas_create、canvas_assets、canvas_asset_import及自动放置保留，总工具数七个。只修改既有工具的保存操作和增加两工具；没有引入新业务运行器、队列或Store。

## 开发文件与原生复用

下列路径相对 `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin`。

| 文件 | 职责与复用方法 |
|---|---|
| src/shared/canvas-agent-protocol.ts | NodeConfiguration、EdgeEditOperation、Graph/Models回执、strict解析器、isCanvasReadOperation、真实边ID和warnings |
| src/shared/canvas-bridge-protocol.ts | v3现有命令契约增加本轮操作，继续阻止node.run通过公开桥提交 |
| src/host/canvas-tools.ts | 既有get/node_edit分支扩展，复用会话、调用ID、去重与严格回执 |
| src/host/canvas-graph-tools.ts、src/host/index.ts | 新edges/models注册，实际七工具，不暴露session/token/raw data |
| src/host/canvas-bridge.ts、src/client/canvas-command-endpoint.ts | graph/models正确按read处理；timeout/disconnect不误报未知写入；校验对应回执status |
| canvas-app/src/agent-graph-read.ts | 聚焦图元信息，复用既有getAgentNodeGeometry及原生端口描述，长正文仍独立查详情 |
| canvas-app/src/agent-edge-policy.ts | 从handlersMap/targetTypeMap推导真实端口/输入，复用validateConnection/dealEdge/getHandleLimit；补防环/重复及目标局部排序 |
| canvas-app/src/agent-model-policy.ts | 原生modelsMap/modelNodePermission，applyMediaModelTypeChange/resolveParamsOnModelChange/getTransformItems/applyEmptyMediaNodeDimensions |
| canvas-app/src/agent-node-policy.ts | 原生标题规则、来源保护、合法字段；复用原生空媒体尺寸逻辑处理update参数 |
| canvas-app/src/agent-adapter.ts | 现有Context初始化、配置阶段检查、版本一致性、Store调用、saved/unknown/rejected及兼容性warnings |
| canvas-app/legacy/src/store/flowStoreCore.ts | 增Agent专用editAgentEdges，复用guardAgentOperation、partialUpdate、现有队列与snapshot；原UI connect/delete/order分支不改 |
| tests与scripts/verify-isolated.mjs | 契约/Host/Client/实际Store回归、当前实际Core七工具注册与打包资源检查 |

本轮对27个文件新增/修改，含9个新文件；完整自身差异与依赖核对在evidence。Shell仅更新本专项目录文档；Core、Web原业务仓库和后端无修改。

## 无界面通信与保存步骤

1. Harness执行工具，Host从exec.agent.id取得当前真实会话，从callId生成内部requestId。
2. 既有Host/Client SSE桥准备对应canvasId/contextId的常驻服务。未打开画布时仍初始化原生Store、图、模型/权限和生命周期；不创建iframe。
3. Host经既有SSE命令事件下发操作，Client端点检查会话、contextId、能力和截止时间，然后调用插件CanvasContext adapter。
4. 查询在Store完成；写入携带expectedVersion，使用既有编辑guard与持久化队列。边端点busy及版本在准备和真正发API请求前再次检查。
5. Store调用现有画布保存API，严格读取本次响应版本；Client经原有事件接口回传，Host完成工具回执。只有saved表示保存确认。
6. 画布UI后来打开时attach已有Context，绑定同一Store。iframe用于显示和原生交互，不承担Agent命令执行位置。

节点的position有parentId时仍是组内坐标，size沿用原生测量规则。真实图读取保留边顺序；不移动既有节点，不执行全图排版。模式不匹配是分步构图的兼容性提示，保存后返回warnings；没有自动切换模式或删边。

## 端口、素材及参数规则

- 普通text/image/video/audio及上传/工具产物媒体可作source；目标可为已有工具的合法输入。工具本体source→产物的管理边拒绝直接操作；组/工具本体节点不开放update/delete。
- 省略handle时从原生已注册端口推导；显式假端口、方向/类型不符、自环、重复source-target输入、容量超限、新循环均拒绝。不会因为别处已有坏环而拒绝无关合法编辑。
- reconnect保留真实边ID、原slot及无关metadata；reorder必须提供目标完整入边集合，一次1–20个ID，保留其他目标槽位。
- 原图/工具产物是素材来源，不能用configure转换成生成节点。NodeDetail的outputs是素材URL，inputs里edgeId才是边；图的canConfigureGeneration明确来源与生成配置的差异。
- 配置只接受modelType/model与标量params，不能在params内放prompt/model/modelType。当前目录允许值必须严格匹配类型，例如字符串`"1"`与数值`1`不能混用。
- 指定非法模型不静默fallback。隐式旧参数采用原生迁移；改变父参数时补齐未指定的子默认，显式子参数再按最终合法组合检查。update直接严格校验最终组合；需要模型迁移/级联默认时用configure。
- 空媒体画幅变更复用原生尺寸计算；已有产物尺寸不改。模型目录paramHints来自默认父参数组合，实时choices从节点详情获取。

## 保存与异常边界

- old version、用户草稿/拖动、相关节点running均拒绝；读取可以返回unconfirmed，但不能据此做下一次写入或继续分页。
- 已知保存拒绝只回滚本次字段/边关系，不覆盖后续用户或poll更新。
- unknown保留真实节点/边ID和optimistic结果，拦截后续盲写，不自动重试；权威重载核对后继续。
- 删除原图会清理真实关联边；存活图生图节点缺参考图的提示仍返回。warnings失败不会将已保存结果反转成rejected。
- 模型目录配置/权限revision独立于画布version；跨revision分页返回CATALOG_VERSION_CONFLICT。
- 泛型只读异常返回READ_REJECTED，不误报SAVE_REJECTED，不置写入不确定屏障。

## Review修复

1. 统一graph/models读取分类，补纯读取错误分类。
2. 删除来源节点后纳入旧边存活target的兼容性提示。
3. 原生cascade子choices为空时，在调用原生helper前拒绝INVALID_ARGUMENT，防止TypeError。
4. update标量画幅也返回原生空媒体尺寸补丁，保持无界面与UI展示一致。
5. reconnect明确失败时，旧端点若已被后续Store变化删除，不恢复悬空旧关系；保留当前有效关系并设置核对屏障，否则仅移除本次失效边。新增3回归先失败后通过。

三位协作Agent分别实现契约、边保存、模型策略，并交叉审阅其他模块；已确认问题均已修复，无剩余阻断。仅与本轮baseline比较，未清理历史dirty代码。

## 自动化与包

- 插件Node tests：172/172。
- Web Agent tests：266/266，22个测试文件；包括真实Host→Client→Store的文案更新、原图标题、两入边、合法图生图配置、重排、改接、删除与权威重载；模型执行请求0、iframe0。
- Host默认SDK与Shell实际Core映射类型：通过。
- Web类型：既有9诊断同位置/代码，无新增；一条消息仅联合字段顺序变化。不是宣称Web全库类型通过。
- build：通过；alpha.12包58个文件逐项与本地构建一致，旧alpha.11包保留。
- Shell实际Core临时Profile：七工具注册、保存动作范围/坐标schema、服务manifest/chunks、SSE认证/握手/会话同步以及卸载通过，业务命令0。
- 当前账号安装：已从alpha.10升级alpha.12，58文件匹配，启用配置确认；实际运行加载及新会话七工具只读查询待核验，真实图编辑手测待反馈。见[账号安装记录](evidence/2026-10-13-alpha12-account-install.json)。临时Core注册/卸载结果不替代当前运行实例或实账保存验收。

包：`/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/insight-ai-desktop-canvas-plugin-0.3.0-alpha.12.tgz`，14,462,662字节。

SHA-256：`a6d1737a2070bd32a4c7fbe4aa9ea6f483878d0546ad7f5f9e732d7042e34dda`。

入口：[实施计划](../plans/2026-10-13-agent-graph-edit-implementation-plan.md) · [手测步骤](2026-10-13-agent-graph-edit-live-acceptance.md) · [验收摘要](2026-10-13-agent-graph-edit-checks.json) · [本轮diff](evidence/2026-10-13-graph-own-changes.diff) · [源码/依赖审计](evidence/2026-10-13-graph-source-audit.json)。

后续先用真实账号验收本轮业务图编辑，再开放现有生成与抠图执行入口完成耳机产物闭环；这需要另一轮明确接入工作。本轮不恢复任务5/6或完整Skill推进。
