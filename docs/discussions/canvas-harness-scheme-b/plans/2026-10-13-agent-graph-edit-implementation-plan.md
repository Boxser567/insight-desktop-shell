# Agent 画布图编辑 Implementation Plan

**Goal:** Agent 无需打开画布，即可读取真实图、修改或删除普通节点、管理业务连线、查询并保存合法图片/视频模型配置。

**Architecture:** Host 工具 → 既有 Client 命令桥 → 插件常驻 CanvasContext → 原生 Store → 既有持久化队列/API。图与模型策略集中在插件侧；画布 UI 与 Agent 使用同一 Store。所有写入沿用版本检查、编辑保护和严格回执。

**Tech Stack:** TypeScript、Zustand、React Flow、现有 Host/Client bridge、Node test、Vitest。

用户已批准本计划的规划和执行；本轮使用现有协作 Agent 分工，不提交 Git。文档集中在本专项目录。

## 全局约束

- 后端、Shell/Core 业务、原生 UI 操作行为保持现状。
- 本轮只编辑与保存，不开放生成、模板和 Skill。
- 不引入第二个 Store、持久化队列、运行器或全画布排版。
- 保留已有工作区改动；本轮基线为 `/private/tmp/canvas-graph-baseline`。
- 未知保存结果保留真实节点/边 ID，禁止自动重试；必须权威重读核对。
- 删除仅普通 text/image/video/audio 节点，支持上传或工具产物媒体；工具/分组本体不开放修改或删除。
- 上传或工具产物节点可改标题、删除、作为输入素材，禁止改成生成节点。
- 允许向已有工具的真实输入端口连线；工具本体→产物管理边不开放编辑。

## 1. 固定共享契约与工具入口

**修改文件（插件仓库相对路径）：**

- `src/shared/canvas-agent-protocol.ts`：图、端口、模型快照、配置、边操作、回执及严格解析器。
- `src/shared/canvas-bridge-protocol.ts`：开放本轮操作，继续拒绝执行生成。
- `src/host/canvas-tools.ts` / `src/host/canvas-graph-tools.ts` / Host 注册入口：扩展原工具、增加两工具。
- `src/host/canvas-bridge.ts`、`src/client/canvas-command-endpoint.ts`：统一读取分类与回执验证。
- `test/*.test.mjs`、`scripts/verify-isolated.mjs`：七工具实际注册和协议回归。

**操作契约：**

```ts
type NodeConfiguration = {
  modelType?: string;
  model?: string;
  params?: Record<string, string | number | boolean | null>;
};
type EdgeConnection = {
  sourceNodeId: string; targetNodeId: string;
  sourceHandle?: string; targetHandle?: string;
};
// 所有写操作必须 expectedVersion；不接受任意原始 graph/node.data。
{ action: 'node.configure', nodeId, configuration, expectedVersion }
{ action: 'edge.add', connection, expectedVersion }
{ action: 'edge.delete', edgeIds, expectedVersion }
{ action: 'edge.reconnect', edgeId, connection, expectedVersion }
{ action: 'edge.reorder', targetNodeId, edgeIds, expectedVersion }
```

工具分工：`canvas_create`、`canvas_get`、`canvas_node_edit`、`canvas_assets`、`canvas_asset_import` 保留；新增 `canvas_edges` 和 `canvas_models`。`canvas_node_edit` 开放 add/update/delete/configure；每个分支只允许自身字段。

- [x] 写契约测试：缺版本、未知字段、假端口、重复边 ID、非标量参数拒绝。
- [x] 实现解析器和 `isCanvasReadOperation()`；canvas.read/graph.read/models.read 全部为读取。
- [x] 更新 Host/Client 使用同一分类，读取超时不能进入未知写入状态。
- [x] 跑 Node 测试；验收结果为七工具，且不能通过工具提交 node.run。

## 2. 读取真实图与模型目录

**新增文件：** `canvas-app/src/agent-graph-read.ts`、`canvas-app/src/agent-model-policy.ts`。

**图查询：**

```ts
{ action: 'canvas.graph.read', nodeOffset: 0, edgeOffset: 0, limit: 20 }
// 返回 status:'graph'、version、consistency、节点/边总数、两类nextOffset。
// 节点：id/type/title/position/size/parentId/ports/allowedInputTypes/canConfigureGeneration。
// 边：id/source/target/sourceHandle/targetHandle，保留真实顺序和缺失端点。
{ action: 'canvas.graph.read', nodeOffset: 20, edgeOffset: 20,
  limit: 20, expectedVersion: '18' }
```

**模型查询：**

```ts
{ action: 'canvas.models.read', nodeType: 'image', modelType: 'reference_image_to_image',
  model: '来自当前目录的模型值', limit: 20 }
// 返回当前有权限的模式/模型、该模型标量字段与合法choices、catalogVersion。
```

图节点/边分别分页，每页1–20项。续页必须绑定 confirmed 的画布版本。模型模式/模型分别分页；续页绑定模型配置与权限的独立 catalogVersion，不能用画布版本代替。长文/素材URL继续按节点详情查询，避免整张画布内容进入上下文。

- [x] 测试两类分页与缺版本拒绝、过期版本拒绝、保留边次序与组内坐标。
- [x] ports/allowedInputTypes 读取原生 handlersMap，尺寸复用现有 geometry helper。
- [x] 模型查询仅使用已加载模型/权限；加载失败明确拒绝，不伪造默认目录。
- [x] 验收：无 iframe、无写 API、无模型执行请求即可返回真实结构与配置。

## 3. 普通节点修改、删除与合法配置

**修改文件：** `canvas-app/src/agent-node-policy.ts`、`canvas-app/src/agent-adapter.ts`；复用原生 Store `updateNode/deleteNodes`。

- [x] update 复用已有 title/text/prompt/params 策略。素材 title-only 允许，正文与生成参数拒绝。
- [x] delete 使用原生空分组清理和关联边删除，回执包含 affectedNodeIds/affectedEdgeIds。
- [x] configure 先检查显式模式、模型存在且有权限；使用原生模式/模型迁移与父子参数默认补齐，再严格检查显式选择。
- [x] 空图片/视频画幅修改复用原生尺寸逻辑；已有产物不重写实际尺寸。
- [x] 模式与当前输入不匹配时返回 warnings，允许用户分步构图；不自动删边或切换模式。
- [x] 验收：非法模式/枚举不保存、不静默回退；编辑/运行中的节点和旧版本拒绝；已知失败恢复本次改动，未知结果不重试。

配置示例（模式与模型必须先查目录）：

```ts
{ action: 'node.configure', expectedVersion: '20', nodeId: 'poster',
  configuration: { modelType: 'reference_image_to_image', model: '目录中的合法值',
    params: { aspect_ratio: '目录中的合法值', gen_count: 1 } } }
```

## 4. 原生边操作的严格保存分支

**新增文件：** `canvas-app/src/agent-edge-policy.ts`。

**修改文件：** `canvas-app/legacy/src/store/flowStoreCore.ts`。

新增 `actions.editAgentEdges(operation, options)`，options 包含 expectedVersion/strictReceipt/signal/affectedNodeIds。原生 UI connect/delete/order 方法保持原样。

- [x] 按原生注册端口推导省略的 handles；显式不存在/方向错误的端口拒绝。
- [x] 复用原生 validateConnection/dealEdge/getHandleLimit，补自环、重复输入、新引入环检查。
- [x] add 创建真实 ID；reconnect 保留 ID；delete 返回真实删除 ID。
- [x] reorder 必须提供目标节点完整入边集合；只替换这些边的数组槽位，保留其他目标顺序。
- [x] 使用 guard + 原持久化队列；准备及实际发出请求前检查相关端点的编辑/运行状态。
- [x] 已知拒绝仅恢复本次边 delta；未知结果保留 optimistic 边及 ID，拦截后续写入。
- [x] 验收：合法连线重载仍存在；非法端口/循环/数量超限/管理边不会调用保存；原生 UI 无 strict options 的路径回归通过。

## 5. 集成、review 与交付

**测试文件：** 既有 `canvas-app/test/agent-runtime-complete.test.ts`，新增图、模型、边纯策略与实际 Store 测试。

- [x] 通过 Host→Client→常驻服务实测 fixture：创建/导入 → 更新 → 连线 → 配置 → 重排/改接/删除 → 权威重载读取，无生成请求、无 iframe。
- [x] 复核 cancellation、queue 内版本/编辑保护、unknown 回执、分页一致性。
- [x] 按本轮 baseline review 修改文件，修复确认问题，保护无关改动。
- [x] Plugin Node tests、Web agent tests、Host 默认/实际 Core types；Web类型与既有9条基线诊断对比，不新增诊断。
- [x] build、alpha.12不可变打包、实际 Core 隔离注册七工具；保存日志与校验摘要。
- [x] 更新专项入口、实施归档、真实账号手测步骤。自动化测试与真实账号测试分开记录。

## 手测交付目标

在一个测试画布中，用Agent导入耳机图、创建文案和空图片节点，把两者连接到图片节点，查询当前可用图生图模型并配置，修改文案、删除临时节点、读取保存版本和边ID。打开画布检查真实连线/位置/参数，关闭后重读仍一致。此轮图片节点仍为空，没有抠图或生成产物；完整出图另行推进现有业务执行入口。
