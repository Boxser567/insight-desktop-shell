# Agent新增自动放置与坐标契约 Implementation Plan

**Goal:** 修复默认新增普通/图片素材节点落在同一原点的问题，坐标在原生尺寸准备之后决定并随原严格保存提交。

**Architecture:** 一个纯放置模块负责几何读取与单节点/批次坐标；Store仅在Agent新增options路径调用它。模型工具公开auto/absolute/after三种策略，旧内部position语义保留；节点详情返回几何供核对。沿节点延展采用锚点右侧规则，不保证全图无重叠。

**Tech Stack:** TypeScript、原生Zustand Store、既有媒体尺寸协调器/持久化队列、原生autoLayout、现有HTTP/SSE桥、Node test与Vitest。

日期：2026-10-13。用户已授权编码，继续karpathy-guidelines。当前对话直接执行，多Agent按文件分工；不要求再次选择执行方式，不提交/发布。设计依据：[坐标调研](../research/2026-10-13-node-placement-and-layout.md)，用户进一步限定：不处理所有旧布局碰撞、不因延展而强行搬整图；代码高度内聚、合理拆分。

## 约束与固定接口

- 后端不改，原生UI默认调用不变；不新增模型、生成、连线、模板或Skill功能。
- 自动放置在prepareNodesForCreate之后、当前版本复核与最新Store读取之后完成；计算到set之间不await。
- 新节点位置随addNodes原保存提交，复用guard、版本队列、回滚和unknown；不新增独立坐标队列或全图排版保存。
- 当前公开新增均为顶层普通/图片素材；既有组按世界边界计入占用，不增加组内新增能力。
- 原生UI及旧内部position精确语义保持；模型工具不再接受裸position，显式使用placement:absolute。

```ts
type NodePlacement =
  | {mode:'auto'}
  | {mode:'absolute';position:{x:number;y:number}}
  | {mode:'after';anchorNodeId:string};
// shared NodeDraft / CanvasAssetInput: placement?:NodePlacement, position?:legacyPoint
// shared AgentWriteOptions: nodePlacement?:NodePlacement
// geometry是可选扩展回执，旧回执仍可解析；新服务实际返回以下三项。
type Geometry = {position:{x:number;y:number};size:{width:number;height:number};parentId:string|null};
getAgentNodeGeometry(node:Node):Geometry;
placeAgentNodes(newNodes:Node[],existingNodes:Node[],placement:NodePlacement):Node[];
```

auto：空图0,0；否则现有占用右边+原生gap，y取旧内容上边；多普通新增用原生grid先排内部再平移。absolute：精确位置，包括0,0；批次保持相对关系整体平移。after：锚点世界右边+gap、y对齐；不迁移旧节点，不搜索所有空位、不创建边；锚点缺失返回NODE_NOT_FOUND。

## 1. 契约与模型入口

文件：shared/canvas-agent-protocol.ts；Host canvas-tools.ts、canvas-asset-tools.ts；对应3个test/*.test.mjs；必要的verify-isolated.mjs目录断言。

- [x] 回归测试三模式、严格字段、非法有限数/ID、position与placement互斥；legacy位置保持。
- [x] 新模型schema只公开placement；裸position在调用dispatch/上传前明确拒绝，提示迁移。
- [x] 素材入参/原生asset.add完整透传placement，缓存指纹包含策略；不改身份/上传/登记。
- [x] NodeDetail允许position、size、parentId可选字段，旧回执兼容，新字段严格校验。

最小调用：

```ts
canvas_node_edit({canvasId,expectedVersion,action:'add',
 node:{type:'text',placement:{mode:'auto'},changes:{text:'测试'}}});
canvas_asset_import({canvasId,expectedVersion,source,
 placement:{mode:'absolute',position:{x:0,y:0}}});
```

## 2. 纯放置模块

新增：canvas-app/src/agent-node-placement.ts、canvas-app/test/agent-node-placement.test.ts。

- [x] 先红后绿验证独立新增不重叠、批次、不修改旧节点、宽/长图、组边界/父链、负坐标、absolute0、after及missing anchor。
- [x] 普通尺寸复用getCompleteMediaNodeDimensions；组考虑style；回退使用原生默认值。
- [x] 世界位置仅用于占用和锚点计算，本地position及parentId不被误解释；非法坐标/父链拒绝。
- [x] 模块只计算，不调用Store/API/DOM，不做全图重排或新调度；返回新节点副本。

## 3. 原生Store与适配集成

修改：canvas-app/legacy/src/store/flowStoreCore.ts、canvas-app/src/agent-adapter.ts、agent-node-policy.ts；集成测试复用agent-runtime-complete.test.ts的真实Store/API fixture。

- [x] 先确认当前缺省连续新增实际red，再接入业务。
- [x] adapter仅node.add/asset.add传nodePlacement：placement显式优先，legacy position映射absolute，否则auto。
- [x] addNode尺寸准备、assertAgentWrite及最新nodes读取后调用placeAgentNodes；无nodePlacement路径保持原坐标。
- [x] describeAgentNode补Geometry，不改变标题/正文/模型/素材。
- [x] 集成验证图片尺寸等待后的最终位置、权威重载、native无options/旧strict调用行为、missing anchor无保存、unknown和版本保护。

关键流程：

```ts
const preparedNodes = await mediaDimensions.prepareNodesForCreate(newNodes);
const {nodes,canvasId} = get();
if (options) assertAgentWrite(get(),targetCanvasId,options);
const placedNodes = options?.nodePlacement
  ? placeAgentNodes(preparedNodes,nodes,options.nodePlacement)
  : preparedNodes;
// 继续原assignNodeTitles、set、partialUpdate(...,options)，不另发排版请求。
```

## 4. Review、构建与交付

- [x] 按本轮baseline审阅差异，独立review坐标语义、组/尺寸、异步窗口、旧UI与去重回执，必要问题修复。
- [x] 插件与Web完整回归、默认/实际Core类型；Web旧9条诊断与基线对比，无新诊断。
- [x] Node24构建、alpha.11打包、文件与构建比对、实际Core隔离检查；不升级依赖。
- [x] 编写实际实施记录与手测步骤；当前客户端自动化两次读取超时，未做真实账号安装；交付手动导入步骤，不打断活动工作。真实坐标验收待用户反馈，不代报通过。

验收：无界面连续新增不落同一原点、实际宽/长尺寸生效、旧内容不动、精确坐标原样、after按源右侧可允许局部重叠、保存重载坐标一致、UI原有行为保持。截图/新实账结果未取得时明确标记未验收。
