# 画布对话接入任务 1–3 Implementation Plan

> **For agentic workers:** 本文是按 writing-plans 编写的开发交接计划，使用勾选步骤记录实施。任务 1.1–1.4.7 编码及任务 1.5 自动检查已完成；1.4.8 的构建 / 隔离安装 / 本机 Core 浏览器 fixture 验收已执行，真实业务 / Electron 完整手测由用户明确暂缓。见[最新前置核对](../implementation/2026-10-13-before-task-2.md)与[1.4 完整归档](../implementation/2026-10-13-task-1-4.md)。未勾选项的具体实施/验收状态以说明为准。后续执行按仓库 AGENTS.md 与已安装能力逐项落实，不依据本文擅自启动子代理。

**Goal:** 让 Agent 能创建空画布、读取真实节点、可靠保存节点修改，并调用原有单节点生成；开发者可依据本计划直接拆解编码与验收。

**Architecture:** Host 提供工具、身份绑定、空画布创建与现有 API 代理；本地 SSE 将命令交给会话所属 plugin Client 服务。Client 按 canvasId 持有独立原生 Store 上下文，无需创建画布 iframe 即可操作；用户打开的同源 iframe 绑定同一 vanilla Store。具体执行位置、生命周期、文件和手工验收以 [任务 1.4 服务化专项计划](2026-10-12-task-1-4-service-plan.md) 为准。

**Tech Stack:** TypeScript、Cordis / Harness Tools、Node HTTP、fetch SSE、React、postMessage、Zustand 与既有 ReactFlow / 画布 API。插件 Node 最低版本保持 >=22.12.0。

## 当前迭代范围与任务 2 前置状态

2026-10-13 用户将本轮目标缩小为 **Agent 对话创建画布、添加普通节点及内容并真实保存**。本轮后续只实施任务 2 的必要通信能力，以及任务 3 的 `canvas_create`、`canvas_get` 与 `canvas_node_edit action:add`；不接入 `canvas_run`、节点更新/删除、模板或实际媒体生成。下文保留完整方案的后续范围，不能将其全部视为当前迭代要求。

任务 1.1–1.4.7 编码和任务 1.5 自动检查已完成。1.4.8 的真实账号手测由用户明确暂缓，不标为通过，也不再作为进入任务 2 的开发阻断；在真实对话验收时补齐相关读取、节点保存与原生 UI 核对。当前前置闭环及证据见[任务 2 前置核对](../implementation/2026-10-13-before-task-2.md)。任务 2 最小桥已完成编码及自动验收，见[最新归档](../implementation/2026-10-13-task-2.md)；任务3最小三工具已完成代码和自动检查，见[专项计划](2026-10-13-task-3-minimal-dialogue-tools-plan.md)与[实施归档](../implementation/2026-10-13-task-3.md)，最终包实账对话仍待执行。

## Global Constraints

- 已完成任务1服务、任务1.5自动检查、任务2桥与任务3最小三工具。用户已恢复手测并回传Console A/B/C；真实Agent链路待alpha.9安装验收。任务3当前文件/接口以专项计划为准；本文件保留的生成/update/delete内容是后续范围。实施记录继续集中到Shell专项目录。
- 实施对象是 `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin`；Shell / Core 首三项无需功能改造，业务后端不改。
- Shell 当前 `build/runtime-manifest.json` 实际打包 Core 为 **0.2.1-alpha.1**，以此作为本轮运行验收目标；不能用最新 Core 源码代替真实安装验证。
- 原画布已能执行模板并等待依赖；本轮不创建 DAG 调度器、媒体运行时或另一条节点查询轮询。
- 本轮 SSE 是本机命令桥；远端业务 SSE / 聊天完成卡属于任务 7，保留现有画布结果监听。
- canvasId 始终使用正 Long 十进制字符串；不转 Number。Token 不交给模型、iframe 或桥消息。
- 普通规模直接生成；同一请求累计超过 **30 张图或 6 条视频**，必须得到真实用户确认，无需付费确认。
- 首三项开放普通 text / image / video / audio 的受控内容修改与单节点执行；技术 params 修改先限 image / video。读取覆盖其他节点，特殊工具 / 组的写入明确拒绝。素材、模板、连线、模型切换与 text/audio 技术参数编辑由后续任务开放。
- “保存成功”和“任务接受”分别验收；超时不能自动重发写入；目标不随用户切换标签而变化。
- 保留旧 canvas_get 摘要调用与 node.selection v1 行为，不扩大节点修改为整画布重跑。

配套 [工具与通信契约](2026-10-10-canvas-dialogue-tasks-1-3-contracts.md) 是本计划的接口依据。所有新增类型、工具条件参数、错误码、消息信封、超时与去重规则均在其中定义。实际函数签名、导入方式、适用范围与检查证据见[前置方法清单](../preflight/2026-10-10-native-methods-and-baseline.md)。

---

## 0. 开发大纲与文件地图

### 每项完成后能做什么

| 顺序 | 独立交付目标 | 下一项依赖它什么 |
| --- | --- | --- |
| 1 插件业务服务 | 不打开画布即可调用节点读 / 增 / 改 / 删 / run；原生 UI 绑定同一业务上下文 | CanvasServiceRuntime、adapter、严格回执、业务 readiness |
| 2 双向桥 | Host 测试命令精确到会话与 service context，拿到同一 requestId 结果，不打开标签 | ensureContext / dispatch 与 HTTP / SSE；原 v1 selection 保留 |
| 3 Agent 工具 | 对话“创建空画布”“修改这个节点并生成”完成闭环，普通请求不需要用户打开 DevTools | 四工具、默认摘要兼容、错误反馈与数量确认 |

**完成任务 1–3 不等于模板首期全部完成。** 任务 4–6 负责聊天素材和业务场景；任务 7–8 负责对话状态反馈与发布。这次把单节点接入底座做到可独立验收，后续模板入口复用同一 bridge 和 adapter。

### 代码文件地图

新增服务工厂、初始化与 UI 绑定文件的准确清单见 [1.4 文件地图](2026-10-12-task-1-4-service-plan.md#3-文件地图)。下表 1.1–1.3 行保留已实现定位；涉及旧 frame 运输的行仅供后续迁移参考。

以下路径全部相对 `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin`；“新增”描述实施位置，当前已完成的子项以勾选状态及实施记录为准。

| 任务 | 文件 | 修改 / 新增职责 |
| --- | --- | --- |
| 1 | `src/shared/canvas-agent-protocol.ts`（新增） | 契约中的纯类型、v2 消息解析、字段上限与错误码 |
| 1 | `canvas-app/src/agent-adapter.ts`（新增） | read / edit / run 适配、回执分类、短时操作互斥 |
| 1 | `canvas-app/src/agent-node-policy.ts`（新增） | 受控字段映射、当前模型参数校验、真实生成数量 |
| 1 | `canvas-app/src/agent-edit-guard.ts`（新增） | 追踪未提交编辑、短时互斥和 Desktop iframe 捕获事件 |
| 1 | `canvas-app/src/agent-editor-debounce.ts`（新增） | 包装原 debounce，标记至原 callback 入队 / cancel，保留原 flush |
| 1 | `canvas-app/src/request.ts` | 可选 Agent 严格错误元数据；原 UI 默认请求行为保留 |
| 1 | `canvas-app/legacy/src/api/workflow.ts` | 将可选 receiptMode 传给 saveFlow / updateCanvas / excuteWorkFlow |
| 1 | `canvas-app/legacy/src/components/canvasFlow/utils/toolUtil.ts` | 可选严格保存 / 执行错误路径；保留序列化、校验与默认 UI 行为 |
| 1 | `canvas-app/legacy/src/store/flowStoreCore.ts`；`flowStore.ts` 默认 UI 包装 | 1.4.1 已迁移原业务与唯一队列到工厂；严格回执 / barrier / 持久状态复用，原 UI 导入方式不变 |
| 1 | `canvas-app/legacy/src/store/flowMediaDimensionCoordinator.ts` | 严格调用不吞异常；失败不会阻塞下一次排队 |
| 1.4 | `canvas-app/legacy/src/components/canvasFlow/index.tsx` | 在真实初始化阶段报告 readiness；1.3 手工事件保护已由 DesktopCanvas 负责 |
| 1 | `canvas-app/legacy/src/components/canvasFlow/hooks.ts` | prompt debounce 的 pending 标记；复用现有 useHandleSend 成功副作用 |
| 1 | `canvas-app/legacy/src/components/canvasFlow/customNode/text/index.tsx` | 文本 debounce 的 pending 标记 |
| 1 | `canvas-app/legacy/src/components/canvasFlow/customNode/audio/SeniorParams.tsx` | 音频标题 / 歌词 debounce 的 pending 标记 |
| 1 | `canvas-app/legacy/src/components/canvasFlow/components/promptControl/DurationSliderControl.tsx` | 时长 debounce 的 pending 标记 |
| 1 | `canvas-app/package.json`、`canvas-app/pnpm-lock.yaml` | 仅添加 Web 测试命令和 Vitest / jsdom 开发依赖，复用旧锁快照 |
| 1 | `canvas-app/vitest.agent.config.ts`（新增） | Web 源码 alias、Node 环境、隔离原有 API 的单测配置 |
| 1 | `canvas-app/test/agent-adapter.test.ts`、`agent-node-policy.test.ts`、`agent-save-receipt.test.ts`、`agent-readiness.test.ts`、`agent-edit-guard.test.ts`（均新增） | 对应 Web 适配与真实队列边界测试 |
| 1.3 | `canvas-app/test/agent-desktop-edit-guard.test.ts`、`agent-native-editors.test.ts`、`agent-native-text.test.ts`（新增） | Desktop 生命周期、原生防抖 / flush 回归，隔离 API 和外观组件 |
| 2 | `src/host/canvas-bridge.ts`（新增） | Client/session/context 归属、唯一路由、pending/回执缓存 |
| 2 | `src/host/bridge-route.ts`（新增） | attach、独立 SSE 流、ack 路由和鉴权 |
| 2 | `src/client/canvas-bridge.ts`、`sse.ts`（新增） | 一条 Client SSE、会话revision快照、回执outbox/重连与流解析 |
| 2 | `src/client/canvas-command-endpoint.ts`、`src/shared/canvas-bridge-protocol.ts`（新增） | v3直接service执行、context目标、requestId去重/回执/readiness |
| 2 | `src/host/index.ts` | 注册本地桥路由，绑定 ctx.effect 清理 |
| 2 | `src/client/index.tsx` | 创建桥、session scoped slot 注入；输入区会话登记 |
| 2 | `src/shared/canvas-service-runtime.ts`、`canvas-app/src/canvas-service.ts` | execute可选expectedContextId，在捕获Store前拒绝旧目标；UI调用兼容 |
| 1.3 | `canvas-app/src/desktop-canvas.tsx` | 已有DOM编辑保护；任务2不在iframe安装业务命令端点 |
| 2 | `test/canvas-agent-protocol.test.mjs`、`bridge-route.test.mjs`、`canvas-bridge.test.mjs`、`client-canvas-bridge.test.mjs`（均新增） | Host 路由 / 流解析 / 假窗口消息验证 |
| 2 | `test/canvas-command-endpoint.test.mjs`（新增） | Client服务去重、context/deadline、回执异常与订阅释放 |
| 2 | `canvas-app/test/agent-runtime-complete.test.ts`（新增回归） | Host/endpoint与真实Store/队列/工厂wire集成，零iframe保存一次 |
| 3 | `src/host/canvas-api.ts`（新增） | 从现有 fetchCanvas 提取固定环境 / Token / JSON 请求，再增加空画布创建 |
| 3 | `src/host/canvas-get.ts` | 复用固定请求 helper，保留摘要解析；修正 data.title 的取值 |
| 3 | `src/host/canvas-tools.ts`（新增） | 四工具注册、条件参数、目标固定与结果渲染 |
| 3 | `src/host/canvas-run-budget.ts`（新增） | 真实数量预算、Host 互斥预留、原生用户确认、日志恢复 |
| 3 | `src/host/index.ts` | 替换内联 canvas_get 注册，注入已安装 Core 的问答 / Session projection 服务 |
| 3 | `package.json`、`package-lock.json` | 对齐新增 Host 类型依赖与实际 Core 版本，不升级无关依赖 |
| 3 | `README.md` | 更新新增对话工具的最低 Core 兼容说明 |
| 3 | `test/canvas-api.test.mjs`、`canvas-tools.test.mjs`、`canvas-run-budget.test.mjs`（均新增）；`test/canvas-get.test.mjs`（修改） | 创建 / 工具闭环 / 批量确认与旧摘要回归 |

注：同一任务涉及多处现有文件，是为了补齐现有方法的“可等待回执”和入口，**不重构其业务结构**。文件地图列出必须接通的调用链，不能只新增 adapter 后忽略原函数吞异常、debounce 和版本队列。

### 开始实施时的准备步骤

- [x] P1：已记录插件工作区干净、源码快照与运行版本。检查使用 Node 24.19.0，符合 >=22.12.0；最终安装验收目标仍为 Shell Core 0.2.1-alpha.1 / Node 24.9.0，本轮未在精确目标 Node 上运行。
- [x] P2：已用上述 Node 直接执行 package scripts 的同一程序与 Web tsconfig，记录基线：现有测试 41/41 通过；Host/Client 类型检查通过；Web 类型检查退出 2，有 10 条现存诊断。原始日志与文件 / 错误码见[基线报告](../preflight/baseline-report.json)。该勾选表示“基线已记录”，不是 Web 已通过；后续不得新增诊断。
- [x] P3：从原生 Web 方法开始实施，不先写 Host 工具。每项完成本项验收后再进入下一项；首三项可作为三个独立提交，提交仅由后续实际实施阶段决定。

**当前停点：** 任务 1 代码/自动检查与任务 2 最小桥已完成，见[任务 2 归档](../implementation/2026-10-13-task-2.md)。任务3最小三工具已实现，实账Agent对话待执行，见[最新归档](../implementation/2026-10-13-task-3.md)。

---

## 1. 任务 1：给 Web 业务补一个可靠的调用适配

**目标：** adapter 能调用已有方法，并如实回答“读到了什么、保存了没有、生成提交了没有”。不要求 Agent、SSE 或新模板参与即可测试。

**输入：** plugin Client 服务准备的每画布 vanilla Store、业务 readiness 和受控 CanvasOperation；不要求有可见 iframe。

**输出接口：** 以 [任务 1.4 第 4 节](2026-10-12-task-1-4-service-plan.md#4-接口入参出参与类型)的 CanvasServiceRuntime、CanvasContext、CanvasViewBinding 和严格元数据为准。旧 getReadiness 捕获 React ref、以组件卸载 dispose adapter 的设计已被替代；1.3 的锁由 context 保有，adapter 不再取得第二份锁。

### 1.1 锁定字段与复用关系

- [x] 1.1.1：在 shared 文件落入配套契约的类型；对 v2 输入做运行时解析，拒绝未知 type / action、额外字段、无效 ID / version 和超大消息。保留旧 protocol.ts 的 parseCanvasId / canvasAddress。
- [x] 1.1.2：在 agent-node-policy.ts 导出以下函数，状态类型通过现有 Store 推导；仅类型导入，不创建 Store 实例或调用 actions：

```ts
import type { Node } from '@xyflow/react';
import type { useFlowStore } from '../legacy/src/store/flowStore';
import type {
  GenerationCounts, NodeChanges, NodeDetail, NodeDraft
} from '../../src/shared/canvas-agent-protocol';

export type AgentNodeState = Pick<ReturnType<typeof useFlowStore.getState>,
  'nodes' | 'edges' | 'modelsMap' | 'modelNodePermission'>;
export function describeAgentNode(state: AgentNodeState, node: Node): NodeDetail;
export function resolveAgentNodePatch(
  state: AgentNodeState, node: Node, changes: NodeChanges
): { data: Record<string, unknown> };
export function createAgentNode(state: AgentNodeState, draft: NodeDraft): Node;
export function getAgentGenerationCounts(
  state: AgentNodeState, node: Node
): GenerationCounts | null;
```

- [x] 1.1.3：实现受控 mapping：只合并变化字段，保留当前模型 / 模式和其他 params；prompt 进入 params.prompt，text 只允许 text 节点，title 走 validateNodeTitle。image/video params 的可选值从当前 modelsMap / 权限中取，复用真实命名导出 buildMediaNodeParamState、isMediaParamValueUnavailable、validateMediaNodesForRun 与既有基本节点权限检查；按合并后的整组参数校验，非法级联组合整体拒绝，不偷偷修正为另一组参数。gen_count 的选项在 timeParam，须单独校验当前选项 / 权限与正整数；不能只遍历 otherParams。上述媒体 helper 仅支持 image/video；text/audio 首三项保留原生默认技术参数，changes.params 明确拒绝，不强制转换节点类型。
- [x] 1.1.4：createAgentNode 封装 util 默认对象中的 createNode(modelsMap, draft, modelNodePermission)，保持原生默认参数、ID 和默认标题；空媒体节点继续用命名导出 applyEmptyMediaNodeDimensions。未指定位置采用 {x:0,y:0}。禁止用一份手写 Node JSON 绕过默认配置；工厂返回不代表已存在可运行模型。该函数只构造草稿，最终标题分配和保存仍由后续原生 addNode 路径执行。
- [x] 1.1.5：真实数量结合当前 state 配置 / 权限，使用节点 params.gen_count 的合法正整数。image 得到 {images:n,videos:0}，video 得到 {images:0,videos:n}，普通 text/audio 为 {0,0}；image/video 缺数量 / 模型不合法时返回 null。合法数字字符串只在模型明确提供该字符串选项时计数，不改写原值。contentType 为 upload/tool、特殊工具节点修改返回 UNSUPPORTED_NODE，计数返回 null；不能把它们算作生成节点。

**本项验收已通过：** 更新 prompt 不改变模型 / 其他参数；不支持字段被拒且无写请求；工厂生成 ID 和原生默认参数；标题修改沿用原校验；详情保持原始边顺序与截断提示。目标已删除的修改返回 NODE_NOT_FOUND。新增标题自动分配、批量 read 的 missingNodeIds 组装属于后续 Store / adapter 路径，未在 1.1 宣称已运行。

原方法定位与复用规则：

| 原方法 | 现有文件定位 | Agent 路径如何复用 |
| --- | --- | --- |
| addNode / updateNode / deleteNodes | [flowStoreCore.ts](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/flowStoreCore.ts:377) | 原生 ID/标题、媒体预处理、空父组与边清理；仅增加严格回执参数 |
| enqueueMutation / updateVersionNumber | [flowStoreCore.ts](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/flowStoreCore.ts:1394) | 同一写队列、polling barrier、后端版本同步；在队列内检查 expectedVersion |
| queuePersistence / persistNodeData | [flowMediaDimensionCoordinator.ts](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/flowMediaDimensionCoordinator.ts:188) | 原媒体持久队列；严格调用保留 rejection |
| createNode / applyEmptyMediaNodeDimensions | [util.ts](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/util.ts) | 原默认模型/参数、UUID、空媒体尺寸；不手造节点 |
| 当前模型参数/权限工具 | [mediaNodeModelUtil.ts](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/mediaNodeModelUtil.ts:252) | 使用真实枚举、模式与权限；不在 Skill 复制模型配置 |
| excuteSingle | [flowStoreCore.ts](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/flowStoreCore.ts:1327) | 原 isAllowRun / capacity / single payload / invoke |
| useHandleSend 的成功路径 | [hooks.ts](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/hooks.ts:1840) | 接受后目标 running、积分刷新；不复制 React hook 本身 |
| useWorkflowTabGuard / usePolling | [desktop-canvas.tsx](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/src/desktop-canvas.tsx)、[CanvasFlow](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/index.tsx) | 原写入所有权及结果监听；bridge 不接管调度 |

### 1.2 先修回执，不增加第二次保存

源码已确认的缺口：addNode 捕获错误后不继续抛；updateNode / deleteNodes 返回 void；mediaDimensions.queuePersistence 会吞掉 rejection；toolUtil.excute 将大多数异常转为 info。不能简单 await 这些旧调用后返回成功。

- [x] 1.2.1：新增可选严格 overload，旧 UI 调用不传 options 时维持原返回 / toast 行为：

```ts
// flowStore actions；Options 来自 shared 契约
addNode(nodes: Node[], options?: AgentWriteOptions): Promise<void>;
updateNode(id: string, patch: NodeUpdate,
  isRecord?: boolean, isSubmit?: boolean): void;
updateNode(id: string, patch: NodeUpdate,
  isRecord: boolean, isSubmit: boolean,
  options: AgentWriteOptions): Promise<void>;
updateNodeData(id: string, data: unknown,
  isRecord?: boolean, isSubmit?: boolean): void;
updateNodeData(id: string, data: unknown,
  isRecord: boolean, isSubmit: boolean,
  options: AgentWriteOptions): Promise<void>;
deleteNodes(ids: string[]): void;
deleteNodes(ids: string[], options: AgentWriteOptions): Promise<void>;
partialUpdate(canvasId: string, payload: ParamsContent,
  options?: AgentWriteOptions): Promise<void>;
excuteSingle(id: string, options?: AgentRunOptions): Promise<Result>;
awaitMutationsIdle(): Promise<void>;
```

Node / NodeUpdate / ParamsContent / Result 均沿用该文件既有类型。CanvasMutationHandlers、coordinator 的 partialUpdate 回调同步增加可选 options，不能让调用链中途丢失 strictReceipt / expectedVersion。

前置 Web 基线在此链有一条 TS2345：现有 partialUpdate 的队列回调可能返回 Promise 或普通响应，与 enqueueMutation 要求不一致。实施本步骤时将回调统一为正确的异步返回并保持响应语义；不使用类型断言掩盖，也不顺带修复其他无关诊断。

- [x] 1.2.2：coordinator 的 queuePersistence 新增 `options?: {strictReceipt?: true}`；供内部排队的 tail 吸收失败，供 Agent await 的 operation 不吸收失败。persistNodeData 严格路径也返回 operation，并传递写 options；默认路径仍维持旧的 void 调用。

```ts
const operation = Promise.all(barriers).then(persist);
const tail = operation.catch(() => undefined);
uniqueIds.forEach(id => persistences.set(id, tail));
void tail.finally(() => {
  uniqueIds.forEach(id => {
    if (persistences.get(id) === tail) persistences.delete(id);
  });
});
return options?.strictReceipt ? operation : tail;
```

以上变量 barriers、uniqueIds、persistences 与 persist 均来自现有 queuePersistence 函数。新增 waitPersistenceIdle() 等待其当前 tails；awaitMutationsIdle 同时等待媒体持久队列和 mutationQueue，重复检查队列引用直到稳定，避免媒体队列尚未入 mutationQueue 时提前返回。

- [x] 1.2.3：expectedVersion 在 enqueueMutation 的实际执行位置、等待现有 polling barrier 之后检查。旧 UI 未传 options 不添加这项校验；Agent 严格路径先判断 canvasId、readOnly、版本与 uncertain 状态，再调用现有 mutation：

```ts
if (options?.strictReceipt) {
  const state = get();
  if (state.canvasId !== canvasId || state.readOnly) {
    throw Object.assign(new Error('画布不可编辑'), { agentCode: 'READ_ONLY' });
  }
  if (state.versionNumber === undefined || state.versionNumber === null) {
    throw Object.assign(new Error('画布缺少版本'), { agentCode: 'VERSION_UNAVAILABLE' });
  }
  if (String(state.versionNumber) !== options.expectedVersion) {
    throw Object.assign(new Error('画布已发生变化'), { agentCode: 'VERSION_CONFLICT' });
  }
}
```

外层校验不能代替这里的校验。后端版本冲突 5011 继续沿用既有 isVersionConflict 和 versionConflict 状态。保存响应的 versionNumber 仍通过现有 updateVersionNumber 更新，不自行 +1。

- [x] 1.2.4：严格保存复用 updateNode 的 prepareNodeData、taskInfo 剔除、value/product 变化规则和 dimensions 队列；删除复用 getEmptyGroupIdsAfterDelete 与 incident edges 清理。每命令只调用一次已有持久化路径，禁止“先用旧方法保存，再另发 partialUpdate 等回执”。
- [x] 1.2.5：request.ts 添加可选 `receiptMode:'agent'`。开始 fetch 前为 not_sent；发出后网络错误、超时、无效响应、HTTP 5xx 为 sent_unknown；合法业务拒绝、401/403、5011 为 rejected。通过 workflow.ts 可选 CanvasRequestOptions 传递至 toolUtil 和 Store；严格 excute 路径抛出带元数据的错误，旧 UI 的 info 行为保留。
  错误元数据统一为 `requestPhase:'not_sent'|'sent_unknown'|'rejected'` 与原 status/code/raw；新增 options 只在 Agent 调用启用。客户端无法知道 Gateway 是否已转发时取 sent_unknown，不能把 502/504 当确定拒绝。严格保存响应缺 versionNumber 时返回 unknown、标记未确认；不能沿用提交前版本冒充新回执。
- [x] 1.2.6：Store 增加仅供 adapter 判断的 `agentPersistenceIssue: Failure | null`，在 init/reset 的权威加载后清空。在保存结果未知、保存成功却缺可信新版本、或旧 UI 保存失败后不能证明内存与后端一致时标记。后续单个成功 patch 不自动清除此标记；否则会掩盖此前未保存字段。读取可以返回 unconfirmed；禁止 Agent 在这种状态继续写 / run。
- [x] 1.2.7：严格写入明确拒绝时仅恢复本命令触碰的字段 / 新增节点 / 删除节点和相关边，保留期间到达的其他节点产物；记录快照按成功 / 恢复结果收口。结果未知时保留未确认标记，不自动回滚成“后端未改”，不自动重试。版本冲突沿用原有刷新恢复入口。
  对更新字段只在当前值仍等于本命令乐观写入值时恢复；如果期间已收到更新，不覆盖新值，并保留 persistence issue。新增节点 catch 的旧自动回滚在 Agent sent_unknown 时也必须跳过；仅旧 UI 或确定拒绝继续原有恢复逻辑。

**验收：** 保存延迟期间工具无 saved；业务拒绝不 run；网络超时为 unknown；一次 prompt 修改只有一个更新请求；第一条严格保存失败不会毒化下一条队列；旧 UI 仍可正常手工编辑与生成。

任务 1.2 的实际改动和验收边界见[实施记录](../implementation/2026-10-12-task-1-2.md)。严格 Store 可等待真实回执；完整 adapter/readiness 未接通。

### 1.3 防止覆盖正在编辑的内容

- [x] 1.3.1：agent-edit-guard 提供 markAgentEditorBusy / isAgentEditorBusy；Set 只存节点 / 字段 / 实例 ID，不含业务内容。DOM 组合输入和 pointer gesture 独立追踪；重叠 debounce 实例不互相清除。
- [x] 1.3.2：prompt、文本、音频标题 / 歌词、时长使用 createAgentEditorDebounce 包装原 debounce；分别保留 1500 / 500 / 1000ms。callback 同步入原持久队列后清标记；已有 cancel / flush 行为保持。数字时长保留原 blur 提交，blur 不提前清除其他待提交防抖。原 prompt / 文本 / 音频在卸载后仍会执行，因此对应 pending 标记保留到原 callback 执行；不能以“卸载清理”为由提前清标记或取消用户最后一次保存。滑块继续原卸载 flush，纯数字草稿按原卸载舍弃。
- [x] 1.3.3：保护已接在严格 Store actions，供后续 adapter 复用；写 / run 检查 activeElement 的 input / textarea / contenteditable 与 pending guard，有草稿返回 EDITOR_BUSY/not_sent，不 blur / flush。无草稿先取短时锁，再等待 awaitMutationsIdle，读取当前值 / 版本；发送队列内再次检查编辑状态和 Canvas 生命周期。等待期间的画布切换 / 卸载为 READ_ONLY/not_sent。默认 UI 调用继续原行为；adapter 不要在严格 actions 外重复取得同一锁。
- [x] 1.3.4：busy 同步通知 DesktopCanvas 安装的 root inert / window 捕获事件，覆盖 document 快捷键与 body portal 手工操作，阻止删除、连线、拖动、粘贴、drop 和手动生成。useLayoutEffect 跟随 canvasId / tabStatus 安装与清理，恢复原 inert；不设置 Store readOnly，不修改原 CanvasFlow UI 结构。
- [x] 1.3.5：锁覆盖 idle 等待、原生预校验和保存 / invoke 回执，以 finally 释放，不延长至媒体完成。严格 edit / delete / run 对 running 目标返回 NODE_BUSY；run 入队再复查，不调用中断。原生结果监听和系统 Store 更新继续执行。

**已通过本项自动验收：** 用户 debounce 未入队时无乐观修改 / API；等待中的 UI 保存改变版本后旧 expectedVersion 拒绝；回执期间 document / portal 事件被阻断；回执结束即解锁且原 loading / 系统产物仍能更新。共新增 21 个测试，Web 累计 62/62，通过生产构建；Web 类型仍有 9 条旧诊断，无新增。详见[1.3 实施记录](../implementation/2026-10-12-task-1-3.md)。真实浏览器 / Shell 烟测、真实 API / 生成未在本轮执行。

### 1.4 无需展示画布的插件服务与运行回执

本节以 [2026-10-12 服务化专项计划](2026-10-12-task-1-4-service-plan.md) 替代旧 CanvasFlow readiness / ensureFrame 方案。以下为专项计划的开发顺序，1.4.1–1.4.7 已完成编码；完整1.4.8人工验收仍未结束：

- [x] 1.4.1：将现有 Store、版本 barrier、guard 的模块单例转换为每实例工厂，保留 standalone / 默认 UI 接口与 1.1–1.3 行为；Web79/79、插件48/48，9条旧Web类型诊断无新增。见[实施归档](../implementation/2026-10-12-task-1-4-1.md)。
- [x] 1.4.2：共用原模型/权限loader与原init，context准备图/配置/版本和真实readiness，失败与成功空表分开；未知保存仅显式权威reload恢复，草稿/在途队列保护。Web113/113、插件48/48，9条旧类型诊断无新增。见[实施归档](../implementation/2026-10-12-task-1-4-2.md)。
- [x] 1.4.3：Client独立effect安装lazy ESM服务和按画布registry，固定路径加生命周期UUID防ESM缓存；不打开iframe，Host代理保持。1.4.3当时Base仅开放基础六方法；execute/view方法已在1.4.4–1.4.7补齐。Web127/127、插件59/59，build/本地pack/Node24.9.0产物fixture smoke通过；真实Shell浏览器烟测留在1.4.8。见[归档](../implementation/2026-10-12-task-1-4-3.md)。
- [x] 1.4.4：原生 iframe 绑定同一 vanilla Store / point API；owned UI 不重复 init/reset，原生错误提示、视图 metadata、只读 preview 和所有权规则保持。
- [x] 1.4.5：guard/timer 随 context 持有；聊天输入及隐藏残留焦点不误报；关闭整个 iframe 不丢原生已排队输入，不取消 service 写入；空闲 prompt 面板能接收外部更新。
- [x] 1.4.6：实现 read/add/update/delete adapter，严格回执返回本次服务端版本与实际受影响 ID，不重发保存、不重复取得锁。
- [x] 1.4.7：复用原单点生成，队列内复核真实数量；补接受后的原生副作用；每 context 复用唯一原 monitor，无 UI 也更新结果。
- [ ] 1.4.8：执行完整服务专项自动与 M1–M17 手动验收、真实 Shell 安装检查并归档；已完成Web167/插件59、构建与最终包隔离安装及本机Core浏览器fixture验收；真实业务 / Electron M1–M17 全项由用户于 2026-10-13 明确暂缓，未记为通过。

**本项独立完成标准：** 未打开画布、canvas iframe 数为 0 时可直接调用插件服务；打开后原生 UI 订阅同一 Store，关闭展示不销毁正在操作的 context。真实 Agent 调用仍需任务 2/3。

### 1.5 本项自动测试与验收

- [x] 1.5.1：已为任务 1.1 提前增加测试开发依赖与配置，不改运行依赖；采用旧 lockfile 已有的 Vitest 4.1.7，避免重新解析无关依赖：

```sh
pnpm --dir canvas-app add -D vitest@4.1.7
```

canvas-app/package.json 增加 `"test:agent":"vitest run --config vitest.agent.config.ts"`。配置复制 Vite 的 @/contexts/AuthContext、@/routes、@ alias，并使用 Node 环境。API 请求、toast、容量查询 mock；Store mutationQueue 与 media coordinator 用真实实现，不能全部 mock 后声称验证了保存队列。

- [x] 1.5.2：agent-save-receipt.test.ts 先加入失败传播和队列不被毒化的回归：

```ts
import { expect, it, vi } from 'vitest';
import { useFlowStore } from '../legacy/src/store/flowStore';
import { createFlowMediaDimensionCoordinator } from
  '../legacy/src/store/flowMediaDimensionCoordinator';

it('严格保存抛错，后续同节点保存仍可排队', async () => {
  const coordinator = createFlowMediaDimensionCoordinator({
    getState: useFlowStore.getState,
    setNodes: nodes => useFlowStore.setState({ nodes }),
    partialUpdate: vi.fn().mockResolvedValue(undefined),
  });
  const failed = coordinator.queuePersistence(['n-1'], async () => {
    throw new Error('save rejected');
  }, { strictReceipt: true });
  await expect(failed).rejects.toThrow('save rejected');
  const persist = vi.fn().mockResolvedValue(undefined);
  await coordinator.queuePersistence(['n-1'], persist, { strictReceipt: true });
  expect(persist).toHaveBeenCalledTimes(1);
});
```

补充同文件真实 Store 用例：模拟一个 queued UI mutation 改版本，再执行 expectedVersion 旧值的 Agent partialUpdate，断言第二条 API 调用为 0。保存返回前 saved 为 0；rejected / unknown 分别核对局部恢复和持久标记。

- [x] 1.5.3：测试覆盖下表并核对一次写入 / invoke 次数。随 1.4 服务化，早期拟定的 adapter/readiness 测试已落入以下实际文件；补齐勾选和定位，不新建重复测试：

| 测试文件 | 必须断言 |
| --- | --- |
| agent-runtime-complete.test.ts、agent-node-policy.test.ts | read 真实 params/边顺序/缺失节点；add 默认工厂；update 保留未改字段；delete 空父组；run 原生成功副作用；错误不运行 |
| agent-node-policy.test.ts | 禁 model/modelType/复杂对象；非法枚举与级联拒绝；gen_count 合计准确；upload/tool 不可运行 |
| agent-context-initialization.test.ts、agent-service.test.ts、agent-runtime-complete.test.ts | readiness 取实际上下文初始化与所有权，不以 iframe load/loading=false 判定；模型或权限失败限制对应媒体创建/参数写/生成，安全文本编辑独立判断；版本缺失、inactive、权限未知禁止严格执行 |
| agent-edit-guard.test.ts | blur 不清除 pending；composition / debounce / cancel / unmount 正确收口；严格修改期间不能手工再生成 |

- [x] 1.5.4：分项实现、失败回归和最终自动检查已归档：Web167/167、插件59/59、Host/Client 类型与完整构建通过；Web 类型保留原有 9 条诊断，无新增，不记为类型全通过。见[1.4 checks](../implementation/2026-10-13-task-1-4-checks.json)及各分项初始失败日志。任务 2 前另定向执行 6 个实际测试文件、126/126 通过；43 个已归档源文件、5 个构建文件及最终 tgz 哈希一致，未重复运行完整构建。

**任务 1 完成定义：** 不依赖 Agent 的测试调用能获得 read / saved / submitted / rejected / unknown；严格路径可靠，现有手工 UI 能力保持；原生单点提交后目标节点 loading 正常。

---

## 2. 任务 2：Host → Client service → Host（最小范围已实施）

**目标：** Host 对指定会话的已有画布读取或添加普通节点，真实回执返回，不打开画布。

**当前实施依据：** [任务 2 最小桥专项计划](2026-10-13-task-2-minimal-bridge-plan.md)已替代原 frame/ensureFrame/canvas.open/postMessage 业务命令拆解；[实施与验收](../implementation/2026-10-13-task-2.md)记录真实文件、v3协议、API、SSE、生命周期、回归和未验证项。旧selection v1和普通CanvasTab保持。

**实际接口：**

```ts
interface CanvasHostBridge {
  ensureContext(sessionId:string, canvasId:string, capability:'read'|'edit',
    requestId:string, signal?:AbortSignal, refresh?:boolean):Promise<BridgeTarget>;
  dispatch(target:BridgeTarget, requestId:string, operation:BridgeOperation,
    signal?:AbortSignal):Promise<CanvasOperationResult>;
  dispose():void;
}
interface BridgeTarget {
  connectionId:string; sessionId:string; canvasId:string; contextId:string;
  readiness:FrameReadiness;
}
interface CanvasClientBridge {
  retainSession(sessionId:string):()=>void;
  dispose():void;
}
```

共享wire类型位于 `src/shared/canvas-bridge-protocol.ts`，protocolVersion:3。BridgeOperation仅read/add；原runtime其他内部能力保留，本轮不通过桥开放。execute携带optional expectedContextId，原runtime在捕获Store前再次校验。

- [x] 2.1：Host registry与本地HTTP/SSE route；Core fence先校验、再校验origin/key；唯一会话路由、固定context、请求去重、unknown、背压/关闭清理。
- [x] 2.2：Client聊天输入区scoped inject与effect登记会话；单SSE连接、revision快照、active/settled回执outbox，重连不重发业务写入。
- [x] 2.3：Client常驻命令端点直接调用ensure/execute/reload；deadline与context检查、readiness主动通知、重复只回放已有结果，无iframe业务端点。
- [x] 2.4：插件84/84、Web170/170、Host/Client types、build/pack、实际Core0.2.1-alpha.1隔离安装通过；Web类型9条旧诊断无新增。

**完成定义：** 在本地HTTP/SSE及原生Store fixture范围内，Host→Client服务→Host链路真实闭环，指定目标新增节点保存一次，断线不重复执行，未创建iframe。真实账号/Electron手测由用户暂缓，未宣称通过。任务3未实施，Agent自然语言创建画布/节点仍未接通。

---

## 3. 任务 3：注册空画布与节点工具

**当前实施状态（2026-10-13）：** 已完成create/get/add三工具与自动验收；用户真实对话确认画布103161及文本/空图片节点成功，最小目标按用户报告通过，详细诊断证据未齐。实际接口以[最小工具专项计划](2026-10-13-task-3-minimal-dialogue-tools-plan.md)和[实施归档](../implementation/2026-10-13-task-3.md)为准，下一阶段见[任务4准备](2026-10-13-task-4-asset-preparation.md)。以下完整四工具步骤保留后续参考；其未勾选生成/预算/update/delete项不属于本轮缩小目标，旧ensureFrame、view、source:iframe不用于已交付工具。

**服务化迁移：** 本节旧 ensureFrame / 打开页面依赖已由 1.4 第 10 节替代；创建后准备 runtime、详情 source 使用 plugin-service，工具操作不打开标签。四工具参数限制、确认预算及 requestId 安全规则继续保留，运输签名在任务 2 联动修订。

**目标：** 将稳定的 adapter / bridge 开放给当前 Harness；正常用户无需先手工打开画布。对话闭环的必要动作全部由四个真实注册工具完成。

**输入：** CanvasHostBridge、现有 desktopToken / fetchCanvas、ToolRunContext 与 Core 原生问答 / Session projection。

**输出：** canvas_create、canvas_get、canvas_node_edit、canvas_run；实际工具入参出参见配套契约第 3 节。

### 3.1 固定 API 创建与兼容摘要

- [ ] 3.1.1：canvas-api.ts 提取现有 fetchCanvas 的环境 / Token / 固定 Gateway / JSON 响应边界；只开放 get 与 createEmptyCanvas 两个方法，不增加模型可控 URL：

```ts
export interface CreatedCanvas {
  canvasId: CanvasId; name: string; version: string | null;
}
export interface CanvasApiDependencies {
  tokenProvider: (signal?: AbortSignal) => Promise<string>;
  transport: typeof fetch;
}
export function requestCanvasJson(
  operation: 'get' | 'create', body: unknown, signal: AbortSignal,
  dependencies?: CanvasApiDependencies
): Promise<unknown>;
export function createEmptyCanvas(name: string,
  signal: AbortSignal,
  dependencies?: CanvasApiDependencies): Promise<CreatedCanvas>;
```

CanvasId 引用旧 shared/protocol；缺省依赖 desktopToken / fetch。requestCanvasJson 的 operation 只映射固定 canvas/get 与 canvas/saveOrUpdate 两个路径；fetchCanvas 保留原签名，通过此 helper 请求后继续 parseCanvasGet，createEmptyCanvas 固定构造空图并解析 ID。HTTP / 业务状态与写请求是否已发出分类按契约，创建响应未知抛带 requestPhase 的错误，由工具转 create_unknown。

- [ ] 3.1.2：严格解析 saveOrUpdate 的返回 ID，安全 number / string / {id,versionNumber} 合法；超大 number、缺 ID、非 JSON、成功响应不完整都不能宣称已创建。name / 空图 payload 完全按契约；不拿模板 API 创建，不发 invoke。
- [ ] 3.1.3：canvas-get.ts 继续输出旧 CanvasSnapshot。title 优先 node.data.title，兼容旧 node.title；nodeCount 不受摘要裁剪影响。原 parseCanvasGet / fetchCanvas 测试保留并补充 title 来源；不把 raw graph 解析成第二套可写状态。

### 3.2 工具注册与参数校验

- [ ] 3.2.1：将 host/index.ts 的内联 canvas_get 移至 canvas-tools.ts，注册一次。registerCanvasTools(ctx:Context,bridge:CanvasHostBridge):void 负责四工具，输出仍为 JSON 字符串：

```ts
output: {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}
```

所有字段使用当前 defineTool 参数格式；required 为该 DSL 的 boolean。canvas_node_edit 使用 action enum + 可选 node/nodeId/changes/nodeIds，execute 内再按 action 严格判别字段组合，不能假设 Schema 支持后就免校验。

- [ ] 3.2.2：工具有 exec.agent 时取 `String(exec.agent.id)` 作为 sessionId；写工具和需要打开页面的详情读若无 agent，返回 AGENT_CONTEXT_REQUIRED。摘要读取保持旧能力。目标固定 canvasId / nodeId / expectedVersion，exec.callId 派生 command requestId；不向模型开放 frameId / sessionId。
- [ ] 3.2.3：create：验证业务参数 → createEmptyCanvas → ensureFrame(read) → created。创建成功、页面不就绪时保留 canvasId/address 返回 view:not_ready。返回绝不含 Token、bridgeKey 或 full graph。
- [ ] 3.2.4：get summary 调旧 Host 方法；get nodes ensureFrame(read) 后 canvas.read；read 回执带 consistency，若未确认必须告诉 Agent 当前内容未证明持久化。Node 缺失不使用标题模糊匹配另一个节点。
- [ ] 3.2.5：node_edit ensureFrame(edit) 后发 add/update/delete。返回 saved 后仍不运行；需要生成由下一次 canvas_run 明确发起。版本冲突先读取再按用户原要求重新判断，不静默覆盖。
- [ ] 3.2.6：run ensureFrame(run) → 读取数量与版本 → budget 确认 / 预留 → 重读确认目标未变 → node.run。expectedVersion 或真实数量改变即拒绝，approvedGeneration 由 Host 写入内部 command；iframe 在实际 executeWorkflow 队列中再次校验。
  run execute 入口先调用 beginCanvasRun 登记本进程 live call，finally 释放 live 标记；数量 reservation 的生命周期独立，不能随 execute finally 无条件释放。
  两次读取使用不同 requestId：`callId:read:preflight` 与 `callId:read:after-confirm`；不能都用 callId:read，否则 iframe 去重缓存会返回旧状态。写请求使用稳定的 callId:run，仅一次发出。

### 3.3 数量确认与工具结果恢复

- [ ] 3.3.1：canvas-run-budget.ts 导出如下工厂，捕获 ctx.userQuestions / ctx.sessionProjections；预留按会话回合互斥、callId 去重，等待确认期间不持有 Web 修改锁：

```ts
export interface CanvasRunBudget {
  beginCanvasRun(exec: ToolRunContext): () => void;
  reserveCanvasRun(exec: ToolRunContext, counts: GenerationCounts,
    signal: AbortSignal): Promise<{
      release(): void;
      settle(result: CanvasRunOutput): void;
    }>;
}
export function createCanvasRunBudget(ctx: Context): CanvasRunBudget;
```

ToolRunContext 来自 dsh-tools，Context 来自 Cordis，GenerationCounts / CanvasRunOutput 来自 shared 契约。工厂在注册工具时创建一次，不在每次 run 重新创建。
- [ ] 3.3.2：读取当前回合 Session 的 tool/call / tool/result，按 callId 将提交或未知的 generation 纳入累计；结果 JSON 从原生 text / tool-result 内容读取，不依赖“Agent 回答正在生成”这种自然语言。相同 callId 内存和日志只计一次；有未完成旧 run 但无可信 counts 时拒绝继续，提示先核对画布。预算不是新增节点调度 / 执行账本。
  扫描排除当前 exec.callId 和本进程已经登记的 live/preparing call，避免把当前工具尚未有 result 误判为历史未知；其他 live 调用在各自 reserve 时原子纳入数量。非 live 的旧调用结果缺失则按未知阻断，不能因 Host 重启丢内存而归零。
- [ ] 3.3.3：超阈值问答用原生服务，不给模型一个 confirmed 字段：

```ts
const questionId = 'canvas-run-' + String(exec.callId);
const reply = await ctx.userQuestions.ask({
  agent: exec.agent,
  signal: exec.signal,
  questions: [{
    id: questionId,
    question: '本次累计将生成 ' + totals.images + ' 张图、'
      + totals.videos + ' 条视频，是否继续？',
    options: [
      { label: '继续生成' },
      { label: '取消本次生成' },
    ],
  }],
});
const confirmed = reply.answers.some(answer =>
  answer.id === questionId
  && answer.selected.length === 1
  && answer.selected[0] === '继续生成');
```

totals 是 reserveCanvasRun 在互斥区得到的真实累计值，类型 GenerationCounts。未确认返回 CONFIRMATION_DECLINED，不能从 custom 文本推断默认同意。确认覆盖当前确切数量，不无限复用此前同意。

已安装 Core 公开接口要求实际存活的 runtime root caller；CALLER_NOT_LIVE / DELEGATED_CALLER 或问答服务不可用映射 CONFIRMATION_UNAVAILABLE，未发出 reservation 释放，无 invoke。不用猜测父会话或替子 Agent 静默跳过确认；普通规模也仍须有可定位的会话 / Client。

- [ ] 3.3.4：submitted / unknown 在正常工具输出记录 generation；settle 保留内存预算直到对应 Session 结果可见，release 仅用于未发出 / 明确拒绝。run unknown 后只允许查看 / 读取事实，不能把先前预算释放为零再尝试。
- [ ] 3.3.5：普通执行失败返回原生限制信息：没有模型配置是 CONFIGURATION_ERROR，容量 / 参数 / 输入不足为 RUN_REJECTED 或字段可解释错误，不要求用户填写全部技术参数。工具描述指导 Agent 根据用户业务请求处理，不能把配置错误包装成用户没填表。

### 3.4 对齐实际运行版本

- [ ] 3.4.1：新增 Host 类型 imports 使用公开包 `@deepseek-ai/dsh-agent`、`dsh-session`、`dsh-session-projection`、`dsh-user-questions`，开发类型以 0.2.1-alpha.1 安装包为准；现有 dsh-tools 开发类型也对齐同版本。只改这些必要类型依赖与 lockfile，不升级 React / 构建器 / Web 运行依赖。
- [ ] 3.4.2：host/index.ts 注入 userQuestions / sessionProjections 与 type module declarations，注册桥与工具。插件 peer dsh-tools 收敛为当前验收目标 0.2.1-alpha.1；更新插件 README 的兼容说明，明确新增对话工具依赖此版本，不能仍宣称新能力已验证 0.1.6。
- [ ] 3.4.3：客户端 scoped slot / openResourceIn、Host ToolRunContext / question answers / turnBoundary / snapshotEvents 在实际安装类型上 typecheck。若某发布包与源码观察不同，应停在具体编译接口修正，不修改 Core loop 或改成轮询；验收报告记录实际包版本。
- [ ] 3.4.4：打包后用 Shell 当前 Core 实例验证四个工具目录，确保没有重复 canvas_get、没有提前注册 template_apply / template_instance。

### 3.5 本项测试与验收

- [ ] 3.5.1：canvas-api.test.mjs 用 mock fetch 捕获请求：无 ID / 无模板的空图、固定环境、当前 Token、不发送 invoke。mock 创建成功 + bridge 打开失败，断言工具仍返回 created 与真实 address；响应丢失则 create_unknown 且 transport 只调用一次。
- [ ] 3.5.2：canvas-tools.test.mjs 用假 ctx.tools 注册器捕获 definitions，execute 使用真实 schema 判别 / 编排与 fake API / bridge；断言错误参数不 dispatch，update 不 run，get 默认摘要不打开 frame。测试必须执行注册后的 execute，不能只验证工具名称。
- [ ] 3.5.3：canvas-run-budget.test.mjs 的核心断言：30 图 / 6 视频无 ask；31 图 / 7 视频 ask；同回合 20+11 图与 4+3 视频也 ask；并发预留不绕过阈值；用户取消 / 无回答无 invoke；非 live / delegated caller 的确认拒绝无 invoke；unknown 保留计数；Host 内存清空后从 Session 日志恢复数量；缺未完成调用的计数则阻断。Audio 不计图 / 视频但仍复用原生运行权限。
- [ ] 3.5.4：一次完成本轮必要自动检查：

```sh
npm test
pnpm --dir canvas-app test:agent
npm run typecheck
npm run build
npm run verify:isolated
```

verify:isolated 用既有隔离安装流程，不覆盖日常 Shell profile；它证明包可安装，不证明真实远端生成成功。若真实登录态 / 模型权限尚未提供，下面真机生成项标记未验证，不能用 mock 代替。

**任务 3 完成定义：** 真实 Harness 对话调用四工具；普通单节点路径自动打开目标画布；只编辑不生成；需要生成时只提交一次；接受后 loading 沿用现有画布；失败、未就绪和未知均有可操作反馈。

---

## 4. 真机验收脚本与通过标准

验收采用测试账号、当前实际可用模型和合法小规模输入；不沿用旧模板中的硬编码模型或假素材。大量阈值用 mock 核验，不为验收真的生成 31 张 / 7 条。

| 编号 | 操作 | 必须看到的结果 / 证据 |
| --- | --- | --- |
| A1 | 对话“创建一个空画布，叫测试 A” | 只一次 saveOrUpdate；返回合法字符串 ID / address；右栏打开同会话；节点为 0；无 invoke |
| A2 | 对话在 A 新增 text 节点“脚本草稿”，填写文字 | saved 带真实 nodeId / version；Web 立即显示；关闭重开仍存在；无 invoke |
| A3 | 对话新增 image 节点并设置提示词，不生成 | 使用真实默认模型配置；一次保存；节点标题 / 参数正确；无 loading / invoke |
| A4 | 读取 A3 节点详情后修改 prompt | 未改模型 / 分辨率等保留；一次更新；saved 返回后重开仍是新 prompt；未请求生成不运行 |
| A5 | 对话“用当前参数生成这个节点” | 单次 workflow/invoke；runningNodeIds 只有目标；有 taskId 后 submitted；原生目标 loading，已有轮询最终展示真实图片 |
| A6 | 用一个已有可执行视频节点要求“动作缓慢一点，再生成” | get → edit saved → run submitted；输入边 / handles 保留；不重跑整画布；Web 展示原有视频结果 |
| A7 | 删除普通节点；节点位于组中且为最后一个子节点 | 回执列出实际受影响 ID；incident edges / 空父组按原逻辑清理；重开仍删除；其他节点不变 |
| A8 | 同时打开 A、B；操作 A 期间切到 B | A 的固定 frame 收到命令；B 不变；目标消失返回 unknown / unavailable，不改发 B |
| A9 | 手工正在编辑 / 还有 debounce，再从对话修改 | EDITOR_BUSY；无业务写请求；不覆盖草稿。草稿保存后旧 version 请求拒绝，读取新版本可重试 |
| A10 | 模拟保存明确拒绝 / invoke 明确拒绝 | 前者不 run，显示未保存；后者保留已保存节点但未生成，不伪造完成 |
| A11 | 模拟 invoke 已发出后丢响应 / iframe 被关闭 | submission_unknown；没有自动再 invoke；工具取消也不冒充后端取消 |
| A12 | 模拟模型 / 权限初始化失败、画布只读、tab guard inactive | 不假 ready；仅具备读取条件时可读；写 / run 无请求；提示具体原因 |
| A13 | iframe 初始化先完成，再建立 bind | 当前 readiness 被补发；不一直等待 / 不增加 ready 轮询 |
| A14 | 原生 UI 新增、改提示词、手动生成、删除与撤销 | 原行为保持，加载 / 积分 / 结果照常；严格路径只在 Agent 调用启用 |
| A15 | 假输入跨阈值；选择取消或不答复 | 原生确认只显示真实累计数；无 invoke；没有模型可填写的 confirmed 后门 |
| A16 | 重复相同 requestId，及相同 ID 不同 payload | 前者只有一次业务调用；后者拒绝；来源伪造 / session 不匹配不执行 |

真实生成验收只需 A5 图片与 A6 既有视频各一次成功，加关键失败注入，不重复跑模板或大量生成。证据记录工具 JSON、Network 请求计数、Web 状态及重开后的保存结果；日志不记录 Token、bridgeKey 或整幅图。

## 5. 已做判断与实施风险

| 已发现问题 | 本轮采取的处理 | 不能承诺什么 |
| --- | --- | --- |
| void / catch 吞错 | 原方法可选 strictReceipt，排队 tail 与结果 Promise 分离 | 不能用 await void 证明持久化 |
| 内存状态可能不同于后端 | 待保存 barrier + persistence issue + 局部恢复 + 权威 init 清标记 | 不能凭当前画面证明已经保存 |
| 初始化 catch 后仍 loading=false | readiness 按真实阶段和能力报告 | 不能把 iframe load 当 ready |
| excuteSingle 不直接设置目标 running | 补 useHandleSend 原有成功副作用 | 不能只见 canvas RUNNING 就声称节点 loading 已正确 |
| 多标签 / 多会话 / 多窗口 | 可信 scoped session、唯一 frame、原生 tab guard、拒绝歧义 | 不广播，不猜最后活跃窗口 |
| 断线时后端可能已接受 | unknown，保留计数与回执，不自动重发 | 本地 requestId 不等于后端 exactly-once |
| 标签可能实际卸载 | 1.4 将上下文生命周期从 UI 分离；只解绑 view，context 在 Client 生命周期内继续 | 不承诺客户端退出后继续；不创建隐藏 iframe 来弥补 |
| 旧依赖与实际 Core 不同 | 新增 Host 公开类型对齐 0.2.1-alpha.1，包安装验收 | 不仅凭最新源码宣称兼容 |
| 原生复杂节点 / 模型切换 | 首三项写入范围受控，其他节点可读、写入显式拒绝 | 不宣称已开放任意类型的所有能力 |
| 同一业务跨多条用户消息 | 首三项聚合同一 Host 回合；场景入口再持有原始请求关联 | 不假装自然语言能可靠识别跨回合相同意图 |

## 6. 交接结果

开发者先做任务 1 的回执与 adapter，再做任务 2 的运输与定位，最后做任务 3 的四工具。三项完成后，后续场景工具只需收集业务槽位、调用已有模板填充 / 执行方法并复用桥，不需要改写此处的身份、版本、保存或去重规则。

现已完成任务 1.1–1.3：插件 48、Web 62 个测试通过，Host/Client 类型检查通过，Web 剩余 9 条既有诊断。1.4.1–1.4.7已编码并完成自动回归，见最新归档；桥和四工具未接通。该状态不能当作 Agent 已能修改 / 生成画布，真实 Shell 安装与手工验收按专项计划执行并记录。

