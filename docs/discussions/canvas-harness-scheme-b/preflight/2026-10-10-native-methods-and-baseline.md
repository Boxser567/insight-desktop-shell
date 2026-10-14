# 画布对话接入：前置方法清单与开发基线

本轮完成任务 1–3 实施前的信息准备。业务源码未修改，新增 adapter、桥和工具也尚未实现。开发依据为[实施计划](../plans/2026-10-10-canvas-dialogue-tasks-1-3-implementation-plan.md)与[工具及通信契约](../plans/2026-10-10-canvas-dialogue-tasks-1-3-contracts.md)；本文件补齐真实函数、调用限制、测试证据与下一步入口。

## 1. 准备结果与版本边界

| 项目 | 已确认事实 | 开发时的处理 |
| --- | --- | --- |
| 业务仓库 | `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin`；版本 `0.3.0-alpha.8`；核对时工作区干净 | 后续业务修改落在插件；Shell 本轮只保存专项文档 |
| 源码快照 | `bd2a7b663ec78c004ffbad00c32a035a379229e9` | 方法位置与基线针对该快照，后续代码变化需按符号定位 |
| 实际交付目标 | Shell manifest 中 Core `0.2.1-alpha.1`，Node `24.9.0`，darwin arm64 | 新能力最终在此安装环境验收 |
| 本轮检查环境 | 缓存运行时 Node `24.19.0`，满足插件 `>=22.12.0`；默认 shell Node 为 `20.10.0` | 本轮结果不是在精确的交付 Node 版本上取得；不要直接用默认 Node 执行插件检查 |
| 开发类型依赖 | 插件现有 dsh-* 开发依赖主要为 `0.1.6-alpha.2` | 现有类型检查通过不证明新增接口兼容 Core `0.2.1-alpha.1`；任务 3.4 对齐必要公开类型 |
| 画布业务 | 原生节点 CRUD、单节点生成、loading、结果轮询、模板依赖执行已经存在 | 接入层调用这些能力，不新建节点调度器 |
| Host 工具 | 当前注册 `canvas_get`，返回摘要 | 新四工具、原生节点详情读取、双向命令桥属于待实施能力 |

Shell 的已有根 README 变更保留，本轮不改动。源码观察与公开类型核对不是新增功能已在真实 Harness 中运行的证据。

### 已执行的基线

| 检查 | 结果 | 证明范围 |
| --- | --- | --- |
| 插件现有 Node 测试 | **41 / 41 通过**，退出码 0 | 既有协议、Gateway、摘要和本地测试行为；使用 mock，不调用真实生成 |
| 插件根 TypeScript 检查 | **通过**，退出码 0 | 根 tsconfig 下的 Host / Client；不包含 Web 源码 |
| Web TypeScript 检查 | **未通过**，退出码 2，10 条现存诊断 | 单独检查 canvas-app 与其 legacy 引用；不能把该结果记作全项目通过 |
| 插件打包、隔离安装、真实画布生成 | **本轮未执行** | 留到相应任务完成后的验收，不用 mock 替代 |

检查使用缓存 Node 直接执行 package scripts 的实际程序与同一 tsconfig，未安装或升级依赖。可复现命令、版本与逐条诊断见[机器可读报告](baseline-report.json)；原始输出见[插件测试](evidence/2026-10-10-plugin-tests.tap)、[Host / Client 类型检查](evidence/2026-10-10-host-typecheck.log)和[Web 类型检查](evidence/2026-10-10-web-typecheck.log)。Host / Client 日志为空，退出码在报告中记录。

Web 的 10 条诊断分布于 ProductList（1）、CombinedParamSelection（3）、HistoryUpload（1）、coverCropMedia（1）、ExtensionEngine（3）与 flowStore（1）。最后一条直接涉及任务 1.2 的写队列回调：`flowStore.ts:1219` 的返回类型可能是 Promise 或普通响应。实施严格回执时一并修正此处类型根因，不用强制类型转换掩盖问题；其余 9 条不随本任务顺带修复。后续比较以文件、错误码和根因判断，行号会随编辑变化。

## 2. 任务 1 可以直接调用的方法

下表中的“可直接复用”表示业务逻辑可以继续使用，**不表示现有方法已提供可靠的 Agent 保存回执**。路径均指向现有插件源码。

### 2.1 状态、初始化与节点构造

| 方法 / 导出 | 输入与输出 | 复用方式与限制 |
| --- | --- | --- |
| [`useFlowStore.getState()`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/flowStore.ts)；命名导出 | 无参数 → 当前 Store；含 nodes、edges、canvasId、versionNumber、modelsMap、权限与 actions | adapter 每次操作读取这一份状态；不缓存第二份 graph。内部 FlowState 未公开，用 ReturnType 推导 |
| [`actions.init`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/flowStore.ts) | `{data,taskStatus,versionNumber?}` 与可选 migration → boolean | 复用图解析、迁移、快照、尺寸初始化。boolean 表示是否发生订阅模型替换，**不是初始化成功标志**；还可能触发尺寸修正持久化 |
| [`util.createNode`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/util.ts)；默认对象成员 | `(modelsMap,basic,modelNodePermission?)` → Node 形状；basic 含 type、position，可选 value / tempFile / 尺寸 | 原 UUID、默认模型参数、标题、taskInfo 与特殊节点初始化。首三项只放行普通四类；工厂返回不证明存在可运行模型 |
| [`applyEmptyMediaNodeDimensions`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/util.ts)；命名导出 | Node → 原节点经尺寸处理后返回 | 仅空 image / video，无 value / tempFile 时依据 aspect_ratio 设置展示尺寸 |
| [`validateNodeTitle`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/nodeNaming.ts)；命名导出 | `{existingNodes,nodeId,nextTitle}` → `{ok:true,title}` 或 `{ok:false,reason}` | 复用 empty / duplicate / missing 判断；通过不代表已保存。新增标题仍交由原 addNode 分配规则 |

上表的源码跳转以符号为准。编写适配层时使用以下真实导入形式，不能把默认对象成员当成命名导出：

```ts
// 以下为未来 canvas-app/src/agent-adapter.ts 的导入示例，当前未创建此文件。
import { useFlowStore } from '../legacy/src/store/flowStore';
import util, { applyEmptyMediaNodeDimensions }
  from '../legacy/src/components/canvasFlow/utils/util';
import { buildMediaNodeParamState, isMediaParamValueUnavailable,
  validateMediaNodesForRun }
  from '../legacy/src/components/canvasFlow/utils/mediaNodeModelUtil';
import { validateNodeTitle }
  from '../legacy/src/components/canvasFlow/utils/nodeNaming';
import { usePointStore } from '../legacy/src/store/pointStore';

type CanvasState = ReturnType<typeof useFlowStore.getState>;
type CreateNodeArgs = Parameters<typeof util.createNode>;
```

`createNode`、`getSourceMap`、`isAllowRun`、`createDefaultParams` 是 util 默认对象成员；`partialUpdate`、`saveCanvas`、`excute` 是 toolUtil 默认对象成员。Store 私有 Data、Result、NodeUpdate 不在适配层复制成另一套业务类型。

### 2.2 模型参数与权限

| 方法 / 导出 | 真实输入与输出 | 接入判断 |
| --- | --- | --- |
| [`buildMediaNodeParamState`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/mediaNodeModelUtil.ts)；命名导出 | `(modelsMap,type,originParams,perm,options?)` → `{modelParam,modelOptionMeta,otherParams,timeParam,cameraControlParam,isModeSupported}` | **type 仅 image / video**；读取当前模型、模式和参数选项。本例不传模型切换 override |
| 同文件 `isMediaParamValueUnavailable` | `(value,options)` → boolean | 结合当前配置验证值；同时检查可见 / 可用权限，不能只验证“类型是 string” |
| 同文件 `validateMediaNodesForRun` | `(nodes,modelsMap)` → 错误提示 string 或 undefined | 只处理 image / video 的模型模式和部分参数；不是所有节点、所有字段的完整校验器 |
| [`validateBasicNodesParamsForRun`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/modelPermission.ts)；命名导出 | `(nodes,perm)` → boolean | 复用基本节点权限校验，参数修改后与原生执行校验一起使用；它不是任意字段 metadata 解析器 |
| 同文件 `normalizeModelNodeSettings` | 权限行数组 → 归一化 Map | 当前模型权限空表不启用额外前端权限限制；成功空表不等于查询失败，也不等于全部模型禁用 |
| 同文件 `normalizeToolNodeSettings` | 工具权限行数组 → 工具权限对象 | 工具权限的空表语义不同；不能与模型权限混为一谈。首三项工具节点写入仍不开放 |
| 同文件 `paramValuesEqual` | 两个参数值 → boolean | 沿用现有值比较规则，避免权限数据与 UI 值表达差异造成误判 |

此前计划中的 `getMediaNodeParamState` 名称已修正为真实的 `buildMediaNodeParamState`。具体字段开放规则如下：

1. title 先做原生命名校验；text 只映射 text 节点 `data.value`；prompt 映射原生 `data.params.prompt`，不把同名 prompt 重复放进 changes.params。
2. image / video 的 changes.params 仅允许当前模型明确暴露、权限允许的标量字段。先合并到当前 params，再检查完整组合；保留未改变的模型、模式与其他参数。
3. `gen_count` 的选项在 **timeParam**，不是 otherParams；须单独验证合法正整数与当前选项 / 权限。原生部分参数检查跳过它时，适配层不能漏检，也不能缺省猜为 1。
4. text / audio 保留原生工厂默认技术参数；首三项开放合法的基础内容 / 标题修改，**拒绝其 changes.params 技术修改**。不能把它们强制转成 MediaNodeType。后续有明确的原生字段元数据和校验入口后再扩展。
5. 首三项不开放 model、modelType 切换、cameraControl 等对象字段、上传节点内容替换或特殊节点写入。非法字段整次拒绝，不静默丢弃。

配置与权限成功查询的状态须显式记录，不能根据 Store 权限是否非空推断 readiness。模型列表虽成功返回但当前节点缺有效模型时，读取仍可用，该节点的生成返回具体配置错误。

### 2.3 编辑和保存：业务继续复用，回执要补齐

| 现有入口 | 当前行为 | 任务 1.2 要补什么 |
| --- | --- | --- |
| [`actions.addNode(nodes)`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/flowStore.ts) → Promise<void> | 媒体预处理、分配标题、选中新增节点、乐观状态 / 快照、一次 partialUpdate；失败回滚但 catch 吞错 | 可选严格路径把明确拒绝 / 未知写入交给 adapter，不因 Promise resolve 就报 saved |
| 同文件 `updateNode` / `updateNodeData` → void | 准备媒体 data、合并、触发持久化；保存内容不直接写 taskInfo | 严格 overload 返回真实 operation Promise，延续原生数据过滤，不再发第二次保存 |
| 同文件 `deleteNodes(ids)` → void | 原生删节点、关联边、空父组、尺寸状态与快照 | 返回可等待回执；affectedNodeIds 包含实际删除的空父组 |
| 同文件 `renameNode` → 标题校验结果 | 校验后调用更新 | adapter 复用 validator 并走严格更新；rename 的同步返回不能作为保存凭据 |
| 同文件 `actions.partialUpdate` → Promise<void> | 统一 enqueueMutation，更新后端版本，但最终不返回原业务 envelope | 严格参数沿链传递，在同一队列内检查版本，输出确认后的 Store 版本 |
| 同文件私有 `enqueueMutation` | 串行、polling barrier、versionConflict / uncertain 检查、更新版本 | 保留唯一写队列；expectedVersion 在实际执行位置检查，不能仅在消息到达时检查 |
| [`queuePersistence`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/flowMediaDimensionCoordinator.ts) | 按 ID 排队，catch 后返回吸收失败的 Promise | 区分 operation 与供后续排队的 settled tail；严格调用获得 operation，失败不堵住下一次 |
| 同文件 `persistNodeData` → void | 按场景直接持久化或进入上述队列 | 严格调用返回实际 Promise；补 waitPersistenceIdle，并与 mutationQueue 共同形成稳定 barrier |
| [`toolUtil.partialUpdate`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/toolUtil.ts) | 原生 JSON 序列化、版本、固定 updateCanvas API；只读时可直接 resolve | adapter 先拒绝只读，严格路径保留响应 / 错误信息；不能把只读无请求当保存成功 |

这些方法不可作为对外通用 API 直接暴露。Agent 可控字段经过 policy 后再调用；后端现有 partialUpdate payload、媒体预处理与版本串行机制继续使用。

### 2.4 单节点生成与已有输入依赖

| 原生入口 | 已有能力 | 接入动作 |
| --- | --- | --- |
| [`actions.excuteSingle(id)`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/flowStore.ts) → Promise<Result> | capacity、isAllowRun、单点 payload、版本队列和 invoke | 复用完整路径；增加严格错误回执，不直接从 Host 构造 invoke graph |
| 同文件命名导出 `buildSingleWorkflowPayload` | 当前目标及递归上游输入，`executeStrategy='single'`，`runningNodeIds=[nodeId]` | 沿用输入图；携带上游不表示逐个重跑上游 |
| [`util.getSourceMap`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/util.ts) | 提取文本、图、视频、音频等输入，保留原生输入顺序 | 读取输入来源 / 解释缺失条件时复用；不根据标题重新匹配节点或重建 handles |
| 同文件 `util.isAllowRun` → Promise<{isAllow,message}> | prompt / 上游文本长度、模型权限、模式、媒体和输入规则等原生校验 | 最终执行经 excuteSingle 调用；普通字段详情读取不触发它的远端业务检查 |
| [`toolUtil.excute`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/utils/toolUtil.ts) | invoke；大部分异常转 info | 严格路径须区分明确拒绝与请求已发出后未知；保留原 UI 缺省行为 |
| [`useHandleSend`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/hooks.ts) | 成功后目标节点 running、积分刷新等 UI 副作用 | adapter 复用相同成功副作用，不在 React 外调用 hook 本身 |
| Store `updateNodeStatus` 与 [`usePointStore`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/store/pointStore.ts) | 本地节点状态更新 / 原生积分刷新 | 接受后目标 loading；updateNodeStatus 仅改本地状态，不证明已持久化；费用未知不猜零 |
| [`usePolling` 的既有调用](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/legacy/src/components/canvasFlow/index.tsx) | 等待并展示真实素材结果 | 保持原有结果监听。工具返回 submitted 不等于媒体生成完成 |

## 3. 初始化与手工编辑的必要前置状态

现有 CanvasFlow 依次取得模型地图、模型参数、模型 / 工具权限、迁移所需数据，再 init 图；某些异常捕获后仍会将 loading 设为 false。`canvasId` 在外层设置，init 的返回值也不是 ready。

需要准备给 adapter 的信号是：目标 canvasId 已确认、图解析是否成功、模型与权限查询是否成功、原 tab guard 是否拥有写入权、是否只读、版本是否已取得，以及手工编辑 / 持久化是否未完成。read / edit / run 能力分别据实开放；iframe load、loading=false、权限空表都不能代替这些信号。

手工输入也不能用固定安静时长代替 pending 状态：`usePromptModelCommon` 默认 debounce 为 **1500ms**，并已返回 `flushPrompt`；文本和部分音频编辑为 500ms，时长控件另有 debounce。任务 1.3 在真实 debounce 创建、flush、取消和完成处标记 pending，沿用已有提交行为。Agent 遇到草稿返回 EDITOR_BUSY，不自动 flush 用户草稿或覆盖本地内容。

## 4. Host / Client / iframe 可复用的接入位置

| 层 | 现有依据 | 后续补齐项 |
| --- | --- | --- |
| Host 身份 / API | [`fetchCanvas`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/host/canvas-get.ts)、现有 desktopToken、固定 Gateway；[`parseCanvasId` / `canvasAddress`](/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/shared/protocol.ts) | 从摘要请求提取固定 API helper；新增空画布创建。ID 保持正 Long 字符串，不转 Number |
| Host 请求防护 | 现有 Gateway 在读 body 前调用 requestRejection，使用配置的 Host / Origin 和浏览器身份 | 新桥路由复用检查；JSON Gateway 的 buffer / 30s 超时不能作为 SSE 通道 |
| Host 工具上下文 | 已安装 Core 的 ToolRunContext 可取得 exec.agent、callId、signal | sessionId 固定为真实 agent.id，requestId 从 callId 派生，模型不能传路由身份 |
| Client 会话 | sidebar tab 与 conversation input 的 scoped slots | 登记可信 SessionId；wire string 回到已登记 Map，不能随意强转品牌类型 |
| Client 打开页 | 已安装 Core `sidebarRight.openResourceIn(sessionId,address)` | 固定在发起会话；opening 回执不等于 frame ready |
| CanvasTab | 当前 iframe、资源地址、source / origin 检查与 v1 node.selection 摘要 | 新 frameId、v2 bind / command / ack；仍保留 v1 草稿行为 |
| iframe | DesktopCanvas、原生 tab guard、CanvasFlow / Store | 安装 agent-message；真实 readiness 主动通知，命令进入同一 adapter |
| 用户确认 | 已安装 Core `ctx.userQuestions.ask` | 仅实际存活的 runtime root caller 可发问；子 Agent 触发超阈值时返回 CONFIRMATION_UNAVAILABLE，不转投猜测的会话 |

`ask` 的已安装公开类型注明 CALLER_NOT_LIVE / DELEGATED_CALLER 等拒绝条件。任务 3 要将不可用确认与用户主动取消区分，并在两种情况下都保证不 invoke。本轮仅核对了公开类型，没有在真实 Host 中注册服务或运行确认弹窗。

### 既有 Web API 不需要后端改造

| 原生封装 | 固定路径 | 使用阶段 |
| --- | --- | --- |
| getFlowData | POST `/game-ai-editor-center/api/canvas/get` | 既有初始化 / 摘要；Agent 详细读以已初始化 Store 为准 |
| saveFlow | POST `/game-ai-editor-center/api/canvas/saveOrUpdate` | 任务 3 空画布创建；现有画布整图保存行为保留 |
| updateCanvas | POST `/game-ai-editor-center/api/canvas/partialUpdate` | 任务 1 严格编辑，沿用当前 payload 与版本 |
| excuteWorkFlow | POST `/game-ai-editor-center/api/v2/workflow/invoke` | 任务 1 单点执行，经原生 excuteSingle |
| getModelParams | 配置的静态 URL，或原有 listNodeSetting 请求 | 使用当前初始化来源，不在 Skill 写死模型 / 分辨率 |
| listModelNodeSetting / listToolNodeSetting | 原有模型 / 工具权限 GET | 显式记录查询成功 / 失败，保留原权限语义 |

任务 2 新增的本机 `/desktop-canvas/api/bridge/{attach,events,ack}` 负责 Host 与 Client 命令 / 回执，iframe 仍用 postMessage。远端业务 SSE 推送任务状态属于任务 7，不阻塞任务 1 的本地适配测试。

## 5. 下一步要写的函数：任务 1.1

以下都明确是**待开发**，不冒充现有能力。本轮准备了来源与验收口径，不生成没有业务实现的占位文件。

| 顺序 | 文件与函数 | 本步目标 | 本步验收 |
| --- | --- | --- | --- |
| 1.1.1 | 插件 `src/shared/canvas-agent-protocol.ts`：契约类型、运行时解析 / 字段上限 | 固定 canvas.read / node.add / node.update / node.delete / node.run 的信封与错误分类；保留原 v1 协议 | 合法消息可解析；未知字段、错误 action、无效 ID / version、超大消息被拒；原 ID parser 测试仍通过 |
| 1.1.2 | `canvas-app/src/agent-node-policy.ts`：describeAgentNode、resolveAgentNodePatch、getAgentGenerationCounts | 单一 Store 派生受控详情与字段映射，不保存、不执行 | 函数按契约导出，状态类型由 Store 推导；读取不改变状态 / 不发请求 |
| 1.1.3 | 同文件：受控 mapping 与整组参数校验 | 保留未改字段，沿用实际配置与权限 | prompt 更新保留其他 params；text/audio 技术修改被拒；非法级联 / 禁用选项整体拒绝 |
| 1.1.4 | 同文件：原生 createNode 调用与默认参数处理 | 新增节点沿用工厂；不手写模型 / UUID / 原生业务结构 | 默认参数来自实际配置；缺配置可识别；新增 text 的内容进入 data.value；空 image/video 尺寸沿用原生方法 |
| 1.1.5 | 同文件：真实数量与可执行节点判定 | 数量来自当前合法 gen_count，不猜 1 | gen_count 位于 timeParam 的选项被检查；普通 text/audio 图视频计数为 0；特殊 / 上传节点拒绝 |

上述准备表对应原实施计划 1.1，验收必须执行真实 parser / policy，而非另写一套测试实现。先提前准备 1.5.1 的 Web 隔离测试配置，设置现有 alias（AuthContext、routes、legacy `@/*` 等）并隔离 API，让本阶段协议 / policy 单测可以立即执行；当前根测试不能覆盖这些 Web 行为。测试准备不代表 1.5 的完整验收已通过。

**任务 1.1 完成后再进入 1.2 的严格回执。** 此时字段已锁定，1.2 可只处理一份已验证 patch，并在既有 Store / coordinator 队列里等待一次真实保存；1.3–1.5 再接 adapter、手工 pending / readiness 与运行验收。桥和 Agent 工具继续等待任务 1 的本项验收，不提前用薄 Host 封装掩盖保存问题。

## 6. 后续准备项与当前完成标准

| 信息 / 验证 | 最迟需要时点 | 当前处理 |
| --- | --- | --- |
| 可登录测试账号、当前可用图片 / 视频模型与合法输入 | 任务 3 真机 A5 / A6 | 本轮不要求用户手填技术参数；运行时从画布配置取得。没有实际生成证据前保持未验证 |
| 原生模板填充 / 执行入口、业务槽位和角色绑定 | 任务 5–6 | 原模板作为参考；不阻塞任务 1–3，不提前新建调度器 |
| 远端 SSE 字段、鉴权、重连 / 任务终态语义 | 任务 7 | 不与本机桥混用；画布现有结果轮询继续工作 |
| 精确交付 Node 与 Core 版本的安装 / 运行检查 | 任务 3.4–3.5 | 本轮 Node 24.19 的基线只作源码开发依据 |

前置阶段通过标准：真实函数与导出方式已确定；参数适用范围、保存吞错、ready 误判与确认 caller 限制已记录并回写计划；原始测试证据归档；下一步的文件、输入输出和验收可直接执行。**业务任务 1–3 尚未完成。**
