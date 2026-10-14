# 任务 3 最小对话工具 Implementation Plan

> **For agentic workers:** 用户已批准继续任务3；沿用本会话的服务化/SSE设计与karpathy-guidelines，在当前工作区逐项实施。既有对话设计已经确认，不重复开启方案选择；本轮不启动子代理、不提交或发布代码。此文件优先于早期任务3的自动打开画布、四工具、生成预算章节。

**Goal:** Agent对话可创建空画布、读取画布和添加普通节点；返回真实ID、可信版本和保存结果，无需打开画布。

**Architecture:** Host固定API创建空画布，既有摘要API保留；详情读取/添加节点经过同一个任务2 Host bridge → SSE → Client原生runtime。执行身份来自exec.agent.id/callId，模型不能指定会话、连接、上下文或请求ID。创建成功但Client未就绪仍保留真实画布ID。

**Tech Stack:** 既有Cordis/defineTool、实际Core0.2.1-alpha.1、fetch/desktopToken、v3 bridge、1.1–1.4原生服务；只对齐必要工具类型依赖，不修改Web/Core/Shell业务或后端。

## Global Constraints

- 仅注册canvas_create、canvas_get、canvas_node_edit(action:add)；保留一个canvas_get，未接入run/update/delete/模板/模型生成。
- 不自动打开画布，沿用原dsh-resource地址及UI按钮。
- 创建固定POST canvas/saveOrUpdate，空图nodes/edges，不接收模板、节点ID、任意URL或execute参数。
- name默认“新画布”，trim后1–100字符；canvasId始终为合法正Long字符串，不将不安全number转为字符串。
- 创建请求发出后无法确认结果返回create_unknown，不自动重试。得到合法ID后服务准备失败仍返回created/runtime:not_ready/原地址。
- 添加必须提供expectedVersion与原NodeDraft，复用parseBridgeOperation和Client政策/Store/持久化队列；saved才表示已保存，不隐式执行。
- summary保持原输出；nodes返回read/confirmed或unconfirmed、version、缺失ID与truncatedFields。可省略nodeIds读取前20个节点与总数，空图也可取得版本；显式refresh:true才权威重载。
- 当前真实账号A/B/C输出已符合条件，UI/Network明细仍待核对；不把Console路径视为Agent工具验收。

## 1. 固定API与兼容摘要

**Files:** 插件src/host/canvas-api.ts新增；src/host/canvas-get.ts修改；test/canvas-api.test.mjs新增；test/canvas-get.test.mjs补充。

**Interfaces:**

```ts
interface CreatedCanvas { canvasId:CanvasId; name:string; version:string|null }
interface CanvasApiDependencies {
  tokenProvider:(signal?:AbortSignal)=>Promise<string>; transport:typeof fetch;
}
requestCanvasJson(operation:'get'|'create', body:unknown, signal?:AbortSignal,
  dependencies?:Partial<CanvasApiDependencies>):Promise<unknown>;
createEmptyCanvas(name:string, signal?:AbortSignal,
  dependencies?:CanvasApiDependencies):Promise<CreatedCanvas>;
```

- [x] 测试固定环境/Token/取消，既有get签名和摘要输出保持。
- [x] 实现共享固定Gateway请求；create发送以下精确空图体，不调用invoke：

```json
{"name":"新画布","temp":false,"canvasType":0,"version":"comfyui","data":"{\"nodes\":[],\"edges\":[]}"}
```

- [x] 创建响应支持data标量ID或{id,versionNumber}，只接受合法字符串/安全正整数；缺失/不安全ID及发出后的传输/5xx/畸形响应是unknown。明确4xx/业务拒绝与发出前失败区分，返回错误不泄露原响应或Token。
- [x] 摘要title优先node.data.title并兼容node.title；nodeCount维持原总数，节点摘要裁剪沿用现有行为。

## 2. 三工具注册与身份/回执

**Files:** 插件src/host/canvas-tools.ts新增；src/host/index.ts替换内联注册；src/shared/canvas-agent-protocol.ts迁移未使用的工具出参类型；test/canvas-tools.test.mjs新增。

```ts
registerCanvasTools(ctx:Context, bridge:CanvasHostBridge):void;
// canvas_create: {name?:string}
// canvas_get: {canvasId:string,view?:'summary'|'nodes',nodeIds?:string[],refresh?:boolean}
// canvas_node_edit: {canvasId:string,expectedVersion:string,action:'add',node:NodeDraft}
// 输出继续为JSON字符串，由defineTool output.render渲染text。
```

- [x] 用真实defineTool注册/execute验证三名称、不重复get、错误字段不调用API/bridge。
- [x] 写操作及nodes读取必须有Agent身份；从agent.id取会话，hash(sessionId,callId,toolName)生成稳定且有界的内部requestId，不同prepare/read/add步骤使用不同后缀。模型没有身份入参。
- [x] create用同一调用ID和规范化参数去重，包括并发、unknown和created/runtime失败；不同内容拒绝。缓存有上限，不能驱逐旧创建回执再重复创建。
- [x] create得到ID后ensureContext(read)，返回runtime状态和实际version；prepare失败保留ID/address/name/API版本，不能重新create。创建请求取消后按是否已发出区分。
- [x] get默认直接fetchCanvas；nodes调用ensureContext(read,refresh?)和dispatch(canvas.read)，source:plugin-service。summary拒绝nodeIds/refresh，详情最多20个唯一ID，空数组拒绝。
- [x] add调用ensureContext(edit)和dispatch(node.add)；预期版本不自动替换。saved/unknown/rejected的状态、版本和节点ID保留，补充requestId/address；unknown的工具级retry规范为never_auto；工具描述明确仅保存、不生成和unknown不重试。
- [x] 输出不含Token、bridgeKey、raw graph、connection/session/context；未知异常使用受控错误文案。

## 3. 运行包与集成验收

**Files:** 插件package.json/package-lock.json必要工具类型对齐；README.md说明；scripts/verify-isolated.mjs增加工具目录检查；canvas-app/test/agent-runtime-complete.test.ts补充两项原生集成（复用既有fixture，不重复创建另一套原生模拟）。

- [x] 将dsh-tools开发/peer对齐实际0.2.1-alpha.1，必要Cordis开发SDK对齐4.0.5-alpha.1；不引入本轮不用的userQuestions/sessionProjection或更新React/Web依赖。
- [x] 集成使用真实注册工具 + 原Host/Client endpoint，以API/runtime fixture闭环create→get nodes→add→refresh read；验证session路由、稳定context、一次新增、版本及不打开UI。
- [x] 验证同调用重复创建/新增不重复执行、创建成功但prepare失败仍返回ID、断线写unknown、错误/取消不伪报saved。
- [x] 一次完成插件回归、Host/Client类型、build/pack；Web仅运行与共享工具类型/构建有关检查，保留原类型基线。归档最终包hash。
- [x] 实际Shell自带Core隔离安装验证工具目录三名称各一项且无canvas_run；卸载隔离包，不替换当前真实账号安装。
- [x] Review最终diff，只补本次发现的必要问题；归档实施、检查和真实对话手测步骤。

## 4. 真实Agent验收步骤

安装最终任务3包并确认当前账号插件启用，重启Harness；新聊天页保持画布关闭。发送：

> 创建一个叫“Agent画布验收”的空画布，添加一个标题为“测试文本”的文本节点，内容为“通过Agent对话创建并保存”。只创建和保存，不生成图片或视频，不打开画布。完成后告诉我画布ID、节点ID和保存版本。

通过条件：真实工具调用create→必要读取→add，created含合法ID，add返回saved/实际节点ID和可信版本；Network出现v3 prepare/command回执和一次节点保存，canvas iframe仍0。随后对话要求“从后端重新读取这张画布，核对测试文本节点”，使用get(view:nodes,refresh:true)，读取结果与保存一致。最后用户打开原生UI核对同节点。

自动fixture、隔离工具目录和真实对话手测分别记录；尚未执行的实账对话不标为通过。若created但runtime:not_ready，保留原ID，等Client准备后处理同画布；create_unknown不换call重建。

实施完成与证据见[任务3归档](../implementation/2026-10-13-task-3.md)。本清单代码/自动检查已完成；2026-10-13用户报告画布103161及文本/图片节点成功，本次最小对话目标通过。第4节的权威重载、详细回执、UI和iframe统计未提供，保留为诊断缺项；连线不在本项工具范围。下一阶段进入[任务4准备](2026-10-13-task-4-asset-preparation.md)。
