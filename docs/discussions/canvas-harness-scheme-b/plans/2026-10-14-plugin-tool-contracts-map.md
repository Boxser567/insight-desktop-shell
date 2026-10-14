# 插件内公共契约：七工具映射与兼容基线

日期：2026-10-14。实施基线是当前 `desktop-canvas-plugin@0.3.0-alpha.13` 工作树，保留已完成的修复；alpha.12 仅为前次分支比较基线。本表记录现状，不增加工具或修改返回格式。配套[实施计划](2026-10-14-plugin-tool-contracts-phase-1-2-plan.md)。

## 1. 共用规则及唯一来源

- 七个工具的 SDK 输出 Schema 均为 `{type:'string'}`；execute 返回 `JSON.stringify(...)`，render 返回一条 text。下述“出参”都是这段字符串解码后的对象，当前并非 SDK 结构化对象。
- 六个工具超时 90,000ms；`canvas_asset_import` 为 180,000ms。注册顺序固定为 create → get → node_edit → edges → models → assets → asset_import。
- 公共 canvasId 是正 Long 十进制字符串，最大 `9223372036854775807`；不转 Number。节点 ID 最长100字符；版本为原样传递的非空字符串，最长100字符，不强制转换为数值。
- `requestId` 仍由 Host 根据 `[agent.id, callId, toolName]` 哈希；session/connection/context/deadline/bridgeKey/signal 不由模型填写。
- SDK Schema、Host 分支检查、共享 parser、原生策略是现有分层。此次只集中第一层的声明，不前移检查或统一错误包装。SDK 可抛 `INVALID_ARGS`；进入 Host 后可返回 `rejected`，两条通道都保留。
- `nodeIds` 的共享 parser 当前接受重复 ID 并去重，限制唯一 ID 数不超过20；`edgeIds` 要求1–20个且不能重复。文案说“唯一”不代表可以在等价整理中将 nodeIds 重复输入改成拒绝。
- 空白字符串、上限、额外字段、模型参数合法性等保留原来的检查时机。Schema 中的 number 不能擅自改成 integer；运行时整数检查继续由原 parser 完成。

| 定义内容 | 当前唯一来源 | 本次安置 |
| --- | --- | --- |
| 七工具 name/timeoutMs/description/parameters | 三个 Host 工具文件 | 原样集中到新增 `src/shared/canvas-tool-contracts.ts` |
| 输出 Schema `{type:'string'}` | Host 两份相同声明 | 新模块导出一个常量；两个既有 renderer 保留 |
| NodeDraft/NodeChanges/NodeConfiguration/EdgeConnection、业务回执 | `src/shared/canvas-agent-protocol.ts` | 保持；不另建 Node/Edge/Receipt 类型 |
| v3 信封、请求关联、通信检查 | `src/shared/canvas-bridge-protocol.ts` | 保持；不添加字段、不升版 |
| CanvasId/资源地址 | `src/shared/protocol.ts` | 保持 |
| Source/ImportArgs、素材上传/登记类型 | `canvas-asset-tools.ts` / `canvas-assets.ts` | 本次保留原位置；只在实际跨层使用时迁移 |
| 参数运行时检查与命令构造 | Host helpers + parseBridgeOperation/parseNodeDraft | 保持；不增加第二套 parser |
| 实际可用模型/连线/尺寸/保存规则 | canvas-app 原生适配器、policy、Store | 保持；不是公共 Schema 的静态真相 |

## 2. 总映射

| 工具 | Host 入口 | 命令或服务 | Client / 原生复用 | 主要出参 |
| --- | --- | --- | --- | --- |
| canvas_create | registerCanvasTools | createEmptyCanvas → ensureContext(read) | context 初始化；不新增节点 | created / create_unknown / rejected |
| canvas_get | registerCanvasTools | summary: fetchCanvas；nodes: canvas.read；graph: canvas.graph.read | describeAgentNode / readAgentGraph | 旧摘要 / read / graph / rejected |
| canvas_node_edit | registerCanvasTools | node.add / update / delete / configure | addNode / updateNode / deleteNodes + 原生 policy | saved / submission_unknown / rejected |
| canvas_edges | registerCanvasGraphTools | edge.add / delete / reconnect / reorder | editAgentEdges → resolveAgentEdgeChange → 保存队列 | saved / submission_unknown / rejected |
| canvas_models | registerCanvasGraphTools | canvas.models.read | readAgentModels + modelsMap/账号权限 | models / rejected |
| canvas_assets | registerCanvasAssetTools | sessionImages(exec) | 无 Client 命令 | available / needs_input / rejected |
| canvas_asset_import | registerCanvasAssetTools | 附件解析/上传或 canvas.read → asset.add → registerImage | createAgentAssetNode → addNode → 保存队列 | saved / needs_input / upload_unknown / submission_unknown / rejected |

## 3. canvas_create

**输入：** `{name?: string}`。省略为“新画布”，`canvasName()` trim 后检查1–100字符；不新增任何必填字段。

**执行：** `createEmptyCanvas(name, exec.signal)` 在 Host 调用既有 saveOrUpdate 创建空图；然后 `ensureContext(sessionId, canvasId, 'read', requestId+':prepare', signal)` 准备插件服务，不打开视图。

**输出：**

- `created`：requestId、canvasId、address、name、version、runtime；runtime 为 ready 或 not_ready，后者可带 runtimeError。创建成功但上下文准备失败仍为 created，保留真实 ID。
- `create_unknown`：requestId、error，retry=never_auto，不自动再建。
- `rejected`：复用 ToolRejection。

**复用/兼容：** create 的同 call 缓存、名称指纹、并发上限、取消位置不变；不把 create 接到新增的图写入后端。

例：`{ "name": "契约整理验收" }`。

## 4. canvas_get

| view | 输入字段 | 映射与默认 | 输出 |
| --- | --- | --- | --- |
| summary（默认） | canvasId，view可省略 | fetchCanvas → 摘要最多20节点；不经桥，不要求 Agent/Client 上下文 | `{canvasId,name,nodeCount,nodes,address}` |
| nodes | canvasId、view:'nodes'，nodeIds?、refresh? | `{action:'canvas.read',nodeIds?}`；省略读前20节点，refresh默认false | ReadReceipt + requestId/address/source:'plugin-service' |
| graph | canvasId、view:'graph'，refresh?、nodeOffset?、edgeOffset?、limit?、expectedVersion? | `{action:'canvas.graph.read',...分页字段}`；两个offset独立，默认0；limit默认20，范围1–20 | GraphReadReceipt + requestId/address/source:'plugin-service' |

refresh 仅传给 ensureContext 的刷新参数，**不是 CanvasOperation 字段**。任一 graph offset >0 必须带 expectedVersion，版本不符从第一页重读；source 标记只附加在成功 read/graph。

summary 不接受 nodeIds、refresh、分页字段，连显式 `refresh:false` 也不接受。summary 目前没有 status/requestId/version/consistency/truncated 字段，不能趁本次统一补上，也不能把 nodeCount 当已返回数量。summary 成功不要求 Agent，但仍使用当前桌面鉴权访问后端。

nodes 复用 `describeAgentNode()`：正文 text 与生成 prompt 分离；outputs 是素材 URL，inputs 才含入边引用；paramHints、truncatedFields、missingNodeIds 原样返回。graph 复用 `readAgentGraph()`：真实 ports、allowedInputTypes、canConfigureGeneration、parentId、几何及 edges、next offsets 不丢失。

两种详情的 version 可为 null，consistency 为 confirmed/unconfirmed。前者只有 confirmed 且版本可信时才可作写入依据。失败复用 ToolRejection/原生 rejected，不统一为“空图”。

例：`{"canvasId":"103161","view":"graph","refresh":false,"limit":20}`。

## 5. canvas_node_edit

共同必填：canvasId、expectedVersion、action。action 对应的一组字段如下，其他分支字段由现有 Host 检查拒绝。

| action | 专属字段 | 业务命令 | 原生执行 |
| --- | --- | --- | --- |
| add | node | `{action:'node.add',expectedVersion,node}` | createAgentNode → util.createNode / 原生默认 / 尺寸 → Store addNode |
| update | nodeId、changes | `{action:'node.update',expectedVersion,nodeId,changes}` | resolveAgentNodePatch → Store updateNode |
| delete | nodeIds | `{action:'node.delete',expectedVersion,nodeIds}` | Store deleteNodes；原生关联边同流程移除 |
| configure | nodeId、configuration | `{action:'node.configure',expectedVersion,nodeId,configuration}` | resolveAgentNodeConfiguration → Store updateNode |

node：`{type:'text'|'image'|'video'|'audio',placement?,changes?}`；public node 不允许 position。changes：`{title?,text?,prompt?,params?}`，提供时至少有一个字段；text 只用于文本正文，params 仅开放普通 image/video 的合法标量字段。params 不能含 model/modelType/prompt、危险键或嵌套对象；这些规则仍由共享 parser 与 native policy 负责。

configuration：`{modelType?,model?,params?}`，至少一个字段；只用于普通 image/video 生成节点。modelType/model 使用目录返回的真实值，最多200字符；不新增 expectedCatalogVersion 入参，目录版本当前是查询分页契约。上传/工具产物的能力限制保持原生检查。

placement 三种形式：`{mode:'auto'}`、`{mode:'absolute',position:{x:number,y:number}}`、`{mode:'after',anchorNodeId:string}`。省略使用原生自动放置；absolute 为画布坐标；after 只按锚点延展，不自动连接、不保证清除附近全部重叠、不重排旧节点。

**输出：** saved 为 SaveReceipt + requestId/address，含 version、affectedNodeIds、unchanged，可含 affectedEdgeIds/warnings；submission_unknown 保留受影响 ID，retry=never_auto；rejected 保留 error/effect:none，原生拒绝可能有 version，Host 提前拒绝未必有 version。

例：`{"canvasId":"103161","expectedVersion":"19","action":"add","node":{"type":"text","changes":{"title":"测试文本","text":"正文"}}}`。title/text 仍在 node.changes，不能上移到 node 根部。

## 6. canvas_edges

共同必填：canvasId、expectedVersion、action。

| action | 专属字段 | 命令与语义 |
| --- | --- | --- |
| add | connection | edge.add；原生创建新边 |
| delete | edgeIds | edge.delete；删除指定真实边 |
| reconnect | edgeId、connection | edge.reconnect；保留原边 ID |
| reorder | targetNodeId、edgeIds | edge.reorder；完整列出该目标所有入边的新顺序 |

connection：`{sourceNodeId,targetNodeId,sourceHandle?,targetHandle?}`。端口省略由原生合法默认解析，显式值不能自动替换。edgeIds 不得重复，长度1–20；原生继续检查类型、容量、重复、循环、受管理边。四类普通节点可作为来源，原生合法工具输入可为目标；工具本体输出管理边和组不在公开编辑范围。

所有动作：dispatchCanvasWrite → bridge → `state.actions.editAgentEdges()` → `resolveAgentEdgeChange()` → 同一保存队列。结果与节点写入同一 saved/unknown/rejected 规则；不丢 affectedEdgeIds、warnings 或 reorder 的顺序。

例：`{"canvasId":"103161","expectedVersion":"19","action":"add","connection":{"sourceNodeId":"source-node","targetNodeId":"target-node"}}`。示例 ID 仅表示字段形态，实际必须来自读取。

## 7. canvas_models

必填 canvasId、nodeType:'image'|'video'；可选 modelType、model、modeOffset、modelOffset、limit、expectedCatalogVersion。不新增 text/audio、全类型能力列表或生成工具。

去掉 canvasId，其余字段映射到 `canvas.models.read`；Host ensureContext(read) → dispatch → `readAgentModels()`。modelType/model 省略时读取原生可用默认；mode/model 两个offset独立分页，limit默认20且为1–20整数；任一offset >0 必须携带第一页 catalogVersion。

输出 ModelsReadReceipt + requestId/address/source:'plugin-service'：status=models、canvasId、version、consistency、catalogVersion、nodeType、modes/modeCount/modeOffset/nextModeOffset、modelType、models/modelCount/modelOffset/nextModelOffset、model、paramHints。失败为 rejected。

paramHints 依据所选模型的默认父参数组合；已有节点的当前参数选项从 canvas_get(nodes) 取得。不把该目录误当当前节点配置，不新增参数自动填写或模型切换行为。

例：`{"canvasId":"103161","nodeType":"image"}`。

## 8. canvas_assets

输入严格 `{}`；不接受 canvasId、sessionId、路径、URL。Host `sessionImages(exec)` 只枚举当前会话可见用户消息里的 image 附件，按最近出现去重排序；不会读取文件字节、上传或准备 Client 上下文。

输出：

```ts
{
  status: 'available' | 'needs_input',
  requestId: string,
  scope: 'current_visible_user_images',
  encoding: 'harness_normalized',
  total: number,
  truncated: boolean,
  images: ImageAttachmentRef[] // attachmentId 序列化为 string；保留原有可选元数据
}
```

最多返回20张；total 是全部可见引用数。无图时附 `missing:['image']` 和原 message；无 Agent/其他错误走 rejected。已有媒体尺寸、name 等 SDK 元数据原样保留；本次不新增自定义 ImageAttachmentRef，也不把图片称为原文件字节。

## 9. canvas_asset_import

必填 canvasId、expectedVersion、source；可选 title、placement。

- attachment 来源：`{type:'attachment',attachmentId:string}`，ID 非空，最多200字符；必须属于当前可见用户消息。
- canvas_node 来源：`{type:'canvas_node',canvasId:string,nodeId:string,outputIndex?:number}`；nodeId最长100字符；outputIndex整数0–19。来源仅一个产物时省略取0；多个产物时省略返回 needs_input，不能默认挑第一张。
- title trim 后不能空白且最多100字符；placement 与新增节点共用。顶层 position 明确拒绝；不开放模型自填 url/path/token。

调用顺序保持：

1. sessionOf → parseArgs → request fingerprint / 同 call 缓存。
2. getIdentity → ensureContext(edit) → 校验 readiness.version 与 expectedVersion。
3. attachment：readSessionImage → uploadImage（可复用同账号/环境/会话/附件上传缓存）；canvas_node：来源 ensureContext(read) → canvas.read → 核对 confirmed 图片产物。
4. 再验账号/环境 → `asset.add` → createAgentAssetNode → 原生 addNode/尺寸/保存队列。
5. 仅 saved 且恰有一个 node ID 时调用 registerImage；保存与登记结果分开返回。

| 状态 | 必须保留的区别 |
| --- | --- |
| saved | SaveReceipt + requestId/address/asset/assetRegistration；登记失败不改变节点已保存事实 |
| needs_input | requestId/canvasId/missing:['source.outputIndex']/message/outputCount；当前没有 address/version 字段 |
| upload_unknown | requestId/canvasId/address/error；不能自动重复上传 |
| submission_unknown | phase:'save'/version/affectedNodeIds/requestId/address/error；可能附asset，保留真实ID与never_auto |
| rejected | ToolRejection；已上传但未成功保存时可附 asset，effect:none 不代表上传副作用不存在 |

asset.status 是 uploaded 或 reused；来源不同，url、attachmentId、mediaType、bytes、尺寸字段的存在性不同，不统一补 null。assetRegistration 为 registered 或 rejected/registration_unknown + error。不要因登记失败重新新增节点。

例：`{"canvasId":"103161","expectedVersion":"19","source":{"type":"attachment","attachmentId":"实际附件ID"},"title":"商品原图"}`。

## 10. 通信及失败边界冻结

- 保留现有 Host→Client SSE 命令、Client→Host HTTP 回执、prepare/command 与 accepted/started/settled；协议版本仍为3。
- 图读用 :prepare/:read，图写用 :prepare/:write；素材有 :source-prepare/:source-read/:asset-add。字符串及请求指纹保持，不能借迁移改变去重身份。
- 保留 signal 传递；素材仍组合 exec.signal 与插件 lifetime.signal，不改变取消、卸载或超时语义。
- 业务版本在队列执行时校验；不改成 Host 自动取最新版本。编辑/节点运行保护、unknown 栅栏和局部恢复不动。
- retry 是恢复前提，不是重试授权；用户要求失败停步仍须遵守。不要新增自动刷新、重试、打开视图或生成。
- 新公共模块不会替换 canvas-agent-protocol.ts 中保留的旧 v2 类型；现有生产服务桥使用 v3，清理历史类型不属于本次工作。

源文件：
[基础工具](</Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/host/canvas-tools.ts>)、
[图工具](</Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/host/canvas-graph-tools.ts>)、
[素材工具](</Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/host/canvas-asset-tools.ts>)、
[共享业务契约](</Users/boxser.shi/Documents/harness/desktop-canvas-plugin/src/shared/canvas-agent-protocol.ts>)、
[业务适配器](</Users/boxser.shi/Documents/harness/desktop-canvas-plugin/canvas-app/src/agent-adapter.ts>)。
完整 Schema、文案和23份源文件哈希见[冻结目录](../preflight/2026-10-14-canvas-tool-contracts-baseline.json)。
