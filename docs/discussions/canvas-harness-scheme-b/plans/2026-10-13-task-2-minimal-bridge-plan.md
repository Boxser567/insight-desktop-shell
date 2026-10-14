# 任务 2 最小通信桥 Implementation Plan

> **For agentic workers:** 按本会话已批准的 context/SSE 设计与 karpathy-guidelines 在当前工作区逐项实施；本轮不推进任务 3，不启动子代理、不提交或发布代码。旧任务 2 的 frame/postMessage 业务命令章节由本文件替代。

**Goal:** Host 对指定会话的已有画布发起读取或添加普通节点，Client 直接复用任务 1.4 服务执行，真实回执返回 Host，无需打开画布。

**Architecture:** Host 建立唯一 Client/session/context 路由；Client 从现有聊天输入区登记会话。一个 Client 生命周期内一条 fetch SSE 接收命令，HTTP POST 上报会话、上下文状态和回执。可见 iframe 和旧 selection v1 保持原行为。

**Tech Stack:** 现有 Node HTTP / Cordis、fetch ReadableStream SSE、React useEffect、CanvasServiceRuntime、原生 Store / 队列 / API；不增加依赖。

## Global Constraints

- 后端及 Shell/Core 业务不改；Agent 工具注册、创建画布 API 工具仍属任务 3。
- 新服务信封使用 protocolVersion:3；旧 v2 frame parser 保留兼容测试，不把 contextId 填进 frameId。
- 本轮命令仅 `canvas.read`、`node.add`；准备能力仅 read/edit。不得经桥调用 update/delete/run，既有内部 runtime 能力不删除。
- canvasId 为正 Long 字符串；模型、桌面 Token、iframe Window/Document 不进入桥消息。
- Core requestRejection 是首道 Host/Origin/浏览器鉴权；其后验证登记的 origin 和随机桥 key。桥 key 用 header，不放 URL。
- 写命令一旦交给 SSE writer，超时/断线即 submission_unknown，不以缺少 accepted 证明未执行；不自动重发、不将断线解释为后端取消。
- 编码阶段测试使用 fixture 和本地 HTTP；后续真实账号手测已恢复并取得A/B/C Console返回，剩余核对见[实账记录](../implementation/2026-10-13-task-2-live-acceptance.md)。不宣称真实对话已接通。

## 1. 文件与接口

| 文件（插件根目录） | 职责 |
| --- | --- |
| `src/shared/canvas-bridge-protocol.ts` 新增 | v3 信封、严格解析、规范化指纹、数量/字节上限；复用既有 operation/result/readiness |
| `src/shared/canvas-agent-protocol.ts` | 导出现有 readiness/failure parser；增加 context 错误码，不改原字段限制 |
| `src/host/canvas-bridge.ts` 新增 | Client/session/context 路由、固定目标、pending/去重/未知回执；提供任务3所需对象 |
| `src/host/bridge-route.ts` 新增 | 受鉴权保护的 attach/events/client-event HTTP；有界 SSE 背压、heartbeat、关闭清理 |
| `src/client/canvas-command-endpoint.ts` 新增 | 命令去重、deadline/context 校验、直接调用 runtime、readiness 订阅 |
| `src/client/canvas-bridge.ts` 新增 | 单连接、会话引用计数与版本化快照、回执 outbox、只重连运输 |
| `src/client/sse.ts` 新增 | UTF-8/CRLF/跨 chunk/多行 data 解析及事件字节限制 |
| `src/host/index.ts`、`src/client/index.tsx` | 生命周期注册；输入区 useEffect 登记真实 sessionId，保留原 OpenCanvas/CanvasTab |
| `test/*bridge*.test.mjs`、`test/canvas-command-endpoint.test.mjs` 新增 | registry、HTTP/流、命令与重连集成；真实 native service 集成置于 Web runtime 测试 |

```ts
type BridgeOperation = Extract<CanvasOperation, {action:'canvas.read'|'node.add'}>;
type BridgeCapability = 'read'|'edit';
interface BridgeTarget {
  connectionId:string; sessionId:string; canvasId:string; contextId:string;
  readiness:FrameReadiness;
}
interface CanvasHostBridge {
  ensureContext(sessionId:string, canvasId:string, capability:BridgeCapability,
    requestId:string, signal?:AbortSignal, refresh?:boolean):Promise<BridgeTarget>;
  dispatch(target:BridgeTarget, requestId:string, operation:BridgeOperation,
    signal?:AbortSignal):Promise<CanvasOperationResult>;
  dispose():void;
}
interface CanvasClientBridge {
  retainSession(sessionId:string):()=>void;
  dispose():void;
}
```

实际 execute 增加可选 `expectedContextId`。桥调用必须传固定 contextId，由原 runtime 在捕获 Store 前再次校验；原生 UI 不传该字段，保持兼容。

Host 创建对象后交给 route；任务 3 再把同一对象传给 tools。无需新增公开业务 dispatch HTTP 入口。

## 2. HTTP 与 SSE 信封

所有 HTTP 路径位于 `/desktop-canvas/api/bridge`。Client 发送 `x-canvas-bridge-origin:location.origin`；该字段用于 Origin 缺省的同源 GET，不能绕过 Core fence。有真实 Origin 时必须相同。除 attach 外还需 `x-canvas-bridge-key`。

| 方向/入口 | 字段与行为 |
| --- | --- |
| POST `/attach` | `{protocolVersion:3,clientId}`；按 Client 生命周期 UUID 幂等返回 `{protocolVersion:3,clientId,connectionId,bridgeKey}`，不含桌面 Token |
| GET `/events` | SSE `bridge.connected`、`canvas.prepare`、`canvas.command`；同登记同时只允许一个 stream |
| POST `/client-event` | `session.sync`、`canvas.prepare.ack`、`canvas.context.state`、`canvas.command.ack` |
| POST `/detach` | 主动释放登记；Client unload 清理，同时 Host dispose 有独立保底 |

所有事件都有 `protocolVersion:3,connectionId`。prepare/command 再含 `sessionId,canvasId,requestId,deadline`；command 必须有固定 `contextId,payload`。prepare 含 `capability,refresh?`。prepared 回执返回真实 contextId/readiness，不能把 loading 当 ready。command 回执 phase 为 accepted/started/settled，只有 settled 中的 saved 才代表本次保存成功。

`session.sync` 是 `{revision,sessionIds}` 的完整快照，最大64项；Host 忽略迟到旧 revision，避免解绑与重连乱序留下旧会话。ack 即使会话已解绑仍可给原 pending 收口，新命令不得再选该会话。

## 3. 执行与恢复

1. Host 只选择已连接、已登记该 session 的唯一 Client；零个 CLIENT_UNAVAILABLE，多个 CLIENT_AMBIGUOUS，不广播。
2. Host ensureContext 发 prepare；Client 调原 ensureContext 或明确请求的 reloadContext，先发送 prepare 回执，再订阅 readiness。
3. Host dispatch 固定上述 target；Client 在 await runtime 后同步检查 contextId 并调用 execute，中间无 await。已替换 context 明确拒绝，不隐式新建。
4. Client 接收时先登记 requestId 与规范化内容，再执行。重复相同内容重放当前回执，不同内容 DUPLICATE_REQUEST_MISMATCH。deadline 在等待 runtime 后再次检查，过期命令不得开始执行。
5. SSE 断线不停止已进入 runtime 的操作；Host 写等待返回 unknown，Client 继续收口。重连复用登记/命令缓存，只重发失败的 HTTP 回执和最新 session/readiness，不重发业务命令。
6. Host 和 endpoint 对请求数、消息2MiB、回执缓存字节、在途数量设硬上限；不驱逐仍需去重的写回执来放行新写，上限返回 BRIDGE_OVERLOADED。缓存仅在所属生命周期结束时释放，不承诺进程重启后的 exactly-once。
7. 显式权威刷新走 prepare refresh:true → reloadContext；依旧受原草稿/队列/unknown保护，不打开 UI。

## 4. 步骤与验收

- [x] 2.1 共享 v3 契约与 Host registry：已实现并验证错误版本/frame字段/跨目标/重复/断线、唯一会话路由、固定目标、unknown、迟到回执与不重发。
- [x] 2.2 HTTP route 与流：已实现 Core fence、origin/key、独立 SSE、有界队列/背压、关闭清理；真实本地 HTTP 测试覆盖鉴权/路由/JSON限额，隔离 Core 安装验证实际注册。背压drain/溢出关闭已加交互回归；未声称做过慢接收端压力测试。
- [x] 2.3 Client endpoint/运输/会话登记：已实现并验证 context替换、重复、过期、UTF8/CRLF/跨chunk、重连、会话解绑与草稿/版本复用；没有 iframe 业务端点。
- [x] 2.4 完整回归与归档：插件84/84、Web170/170，Host/Client类型、build、pack、实际Core隔离安装通过；9条旧Web类型诊断逐项相同。后续实账Console三项符合条件，完整人工验收未完成，见[实施与验收](../implementation/2026-10-13-task-2.md)。

核心集成测试：Host ensure(edit) → Client 原服务准备已有空图 → Host dispatch(add text) → native Store/队列/API fixture保存一次 → 同request重放不再保存 → Host read核对节点内容与版本；过程中 canvas iframe 数为0。任务 2 完成不代表 Agent 自然语言工具已注册。
