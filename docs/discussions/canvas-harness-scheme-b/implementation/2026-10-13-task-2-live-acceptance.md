# 真实账号手测：SSE 会话连通与无界面节点保存

## 当前状态与目标

用户于 2026-10-13 恢复真实账号手测。已排除插件被禁用导致无桥接请求的问题，并在实际 Shell 中看到 attach / events / client-event 返回200。用户已提交画布103136的A/B/C结果：无界面读取、新增的严格保存回执、权威重载后的节点一致性均符合通过条件。原生UI显示、Network请求明细及bridge会话载荷尚待核对，完整实账验收仍未通过。

本轮目标：安装最终任务2插件后，聊天会话自动登记且SSE连接正常；已有测试画布不打开时，原生服务能读取、创建一个文本节点、取得严格保存回执，并从真实后端重新加载核对；最终原生UI显示相同节点。

本文件记录任务2Console手测，当时任务3未实施；任务3现已完成最小工具与自动验收，最终包实账对话改用[任务3手测](2026-10-13-task-3-live-acceptance.md)。当前Host bridge是Host插件内部对象，没有公开业务dispatch HTTP或人工按钮。下面Console操作直接调用runtime，**不经过Host→SSE命令发送**；因此这轮覆盖“真实SSE会话连通 + 真实业务服务保存”，不将其合并宣称为完整命令链路验收。完整实账命令及请求去重验证在任务3接通后完成，不为手测额外开放生产调试写接口。

## 步骤大纲

| 步骤 | 操作 | 目标与通过条件 |
| --- | --- | --- |
| 1 安装与启用 | Shell登录 → 菜单插件 → 导入本地插件 → 选择.tgz；确认当前账号的画布插件已启用 | 使用任务2最终包；不能仅凭安装成功判断插件已加载 |
| 2 准备 | 同账号、同服务环境新建空白测试画布，记录ID；关闭其他正在编辑此图的页面；Shell只保留聊天页 | 数据目标明确；进入验收时无canvas iframe；不要把已有业务图作为样本 |
| 3 SSE | 打开Harness页面DevTools Network，保留日志；刷新该Harness页面后进入一个聊天会话 | attach200且protocolVersion:3；events200且持续连接；session.sync的sessionIds包含当前会话，POST返回200 |
| 4 无UI读 | 在Harness主页面Console执行下方脚本A | rt可用，edit:true；read/confirmed/可信version；iframe始终0 |
| 5 创建/保存 | 仅一次执行脚本B，创建测试文本节点 | saved、可信version、实际节点ID；这次新增对应一次原partialUpdate，不调用workflow/invoke |
| 6 后端与UI核对 | 执行脚本C权威重载，再通过原打开画布控件打开同ID | 新get响应包含同节点ID/标题/文本；UI一致，测试节点只有一个 |

## 1. 安装与画布准备

安装包：`/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/insight-ai-desktop-canvas-plugin-0.3.0-alpha.8.tgz`。

该文件是任务2最终产物，SHA-256为 `e0dac8c8251d7d743f461d4347ad97e7e4b1b263bc9594546bc1c7ad875abcb1`。任务1.4与任务2版本号相同，不仅凭版本号判断；重新导入这份最终包。Shell已有菜单支持选择.tgz，导入流程会停止并重新启动Harness，不需要再手工覆盖安装目录。

安装与启用是两个独立条件：已有 Profile 的 `cordis.patch.yml` 可以通过 `id: insight-desktop-canvas-plugin` / `disabled: true` 禁用已安装的插件。存在该配置时，重新安装或仅刷新页面不足以恢复插件；先在当前账号的插件管理中启用画布插件，再使用 Harness → 重启 Harness。不要改其他插件的开关。本次已针对当前账号将这一项改为 `disabled: false`，保留配置备份后重启，未修改业务代码。

正式安装版使用生产服务，Dev使用测试服务；测试画布必须来自相同账号、相同服务环境。新图由现有Web画布入口手工创建，记录正Long字符串ID。这里只准备样本，不作为“Agent创建画布”的通过证据。

## 2. 进入正确的 DevTools

打开Harness内容页面对应的DevTools，先确认页面上下文。macOS顶部View菜单可能打开Shell外层的DevTools，不能只凭菜单入口判断。正确窗口标题应类似 `Developer Tools - http://127.0.0.1:端口/`；Console执行 `location.href` 应得到本机HTTP/HTTPS的Harness地址。若得到 `file://.../renderer/index.html`，关闭该外层DevTools并切回Harness内容页面对应的DevTools。不要在 `/desktop-canvas/view` iframe上下文执行脚本。

Network打开后开启Preserve log。在确认当前页面为Harness后，可以在Console执行 `location.reload()`，让新Client的attach/events/session.sync被完整记录。等待聊天页面恢复并进入一个空闲聊天会话，保持画布未打开。

Network筛选 `/desktop-canvas/api/bridge`：

- attach返回200，响应protocolVersion为3。
- events返回200，Content-Type为text/event-stream；持续Pending是正常的长连接。
- client-event里出现 `type:session.sync`，sessionIds含当前会话，响应200。一次mount可能有多个revision，不以总POST次数判断重复保存。
- 不调用attach创建第二个手动Client；不要把bridgeKey当业务Token或写入分享材料。

### Network没有桥接请求时

先在正确Harness页面的Console执行 `typeof window.__INSIGHT_CANVAS_RUNTIME_V1__`：

- 返回 `undefined`：先检查当前账号插件的启用状态、是否在安全模式，以及实际安装包。未加载Client时不会发起bridge请求，反复刷新和更换筛选条件不能解决。
- 返回 `object`：确认已进入聊天会话，Network正在录制、类型选择All或Fetch/XHR，清除额外筛选条件；打开Keep log后刷新正确Harness页面。Client在聊天输入控件登记会话时连接bridge，无需打开画布。
- 请求出现但失败：根据具体HTTP状态继续排查；不要手工调用attach或重复提交新增。

本次阻塞的实际原因是当前账号的画布插件被Profile禁用。启用并重启后，原来的 `/desktop-canvas/api/bridge` 筛选已经可以显示请求。

## 3. Console 脚本

脚本都在同一个Harness页面按A→B→C执行。变量使用var，便于分段操作；新增步骤另有本页防重复标记。

### A：准备与无界面读取

只改第一行画布ID。

```js
var liveCanvasId = '替换为测试画布ID';
var liveFrameCount = () => [...document.querySelectorAll('iframe')]
  .filter(frame => frame.src.includes('/desktop-canvas/view')).length;
if (liveFrameCount() !== 0) throw new Error('请先关闭Shell内的画布标签');
if (!window.__INSIGHT_CANVAS_RUNTIME_V1__) throw new Error('请检查插件安装或Console页面上下文');
var liveRuntime = await window.__INSIGHT_CANVAS_RUNTIME_V1__.ready;
var liveInfo = await liveRuntime.ensureContext({canvasId: liveCanvasId, capability: 'edit'});
var liveSnapshot = await liveRuntime.execute({
  canvasId: liveCanvasId, expectedContextId: liveInfo.contextId,
  operation: {action: 'canvas.read'}
});
console.log({info: liveInfo, snapshot: liveSnapshot, canvasIframeCount: liveFrameCount()});
if (!liveInfo.readiness.capabilities.edit || liveSnapshot.status !== 'read'
    || liveSnapshot.consistency !== 'confirmed' || liveSnapshot.version === null
    || liveFrameCount() !== 0) throw new Error('尚未满足写入条件，请记录状态与错误码，停止新增步骤');
```

### B：只创建一个文本节点

只执行一次；出现unknown不要重贴或换请求继续新增，应先核对权威图。

```js
if (window.__CANVAS_LIVE_ADD_STARTED__) throw new Error('本页新增步骤已经执行，不重复提交');
window.__CANVAS_LIVE_ADD_STARTED__ = true;
var liveTitle = '实账验收-' + crypto.randomUUID().slice(0, 8);
var liveText = '真实账号下，未打开画布创建并保存文本节点';
var liveAdded = await liveRuntime.execute({
  canvasId: liveCanvasId, expectedContextId: liveInfo.contextId,
  operation: {
    action: 'node.add', expectedVersion: liveSnapshot.version,
    node: {type: 'text', changes: {title: liveTitle, text: liveText}}
  }
});
console.log({added: liveAdded, title: liveTitle, canvasIframeCount: liveFrameCount()});
if (liveAdded.status !== 'saved' || !liveAdded.affectedNodeIds.length)
  throw new Error('新增未取得确认保存回执；先核对结果，不重新新增');
var liveNodeId = liveAdded.affectedNodeIds[0];
```

Network查看此次新增的 `canvas/partialUpdate`：请求目标ID正确，输入版本来自A，响应包含可信版本，回执version对应本次响应。首次准备可能有既有业务初始化迁移保存，单独区分；这里只计B新增对应的请求。不得出现workflow/invoke。

### C：权威重载，证明真实落盘

仅在B明确saved后执行。不要只用同一Store的缓存read证明落盘。

```js
if (!liveAdded || liveAdded.status !== 'saved') throw new Error('先处理新增回执，不跳到成功核对');
var liveReload = await liveRuntime.reloadContext({canvasId: liveCanvasId, capability: 'read'});
var livePersisted = await liveRuntime.execute({
  canvasId: liveCanvasId, expectedContextId: liveReload.contextId,
  operation: {action: 'canvas.read', nodeIds: [liveNodeId]}
});
var liveNode = livePersisted.status === 'read' ? livePersisted.nodes.find(node => node.id === liveNodeId) : undefined;
console.log({reload: liveReload, persisted: livePersisted, canvasIframeCount: liveFrameCount()});
if (livePersisted.status !== 'read' || livePersisted.consistency !== 'confirmed'
    || !liveNode || liveNode.title !== liveTitle || !String(liveNode.text).includes(liveText)
    || liveFrameCount() !== 0) throw new Error('后端核对未通过，请记录实际回执');
```

确认Network出现新的原 `canvas/get`，其graph含测试节点。最后使用原“画布ID→打开画布”控件打开同一ID，检查标题、文本、位置及只有一个测试节点。此时iframe数才允许变为1。保留测试节点作为证据，本轮不删除，不触发图片/视频生成。

## 4. 需要记录的结果

| 项目 | 填写 |
| --- | --- |
| 当前Shell/Core及实际包 | Shell 1.0.6 / Core 0.2.1-alpha.1；已安装Host、Client、服务manifest与本地任务2最终构建逐文件一致 |
| 服务环境、测试画布ID | 画布103136；当前Shell安装版，实际业务请求环境待随Network明细核对 |
| attach/events/session.sync | attach / events / client-event均200，events持续连接超过2分钟；v3及session.sync载荷、会话归属仍待单独核对 |
| A读取 | 用户返回符合条件：ready；read/edit/run:true；version:0；read/confirmed；空画布；iframe数0 |
| B保存 | 用户返回符合条件：saved；version:1；新增节点565e2522-51c8-4152-9f6e-2a47e5b39d0b；unchanged:false；iframe数0。一次partialUpdate的Network明细待核对 |
| C持久化/UI | 用户返回符合条件：reload后version:1；read/confirmed；nodeCount:1；读回同ID、标题、文本；iframe数0。原生UI待核对 |
| 失败信息 | A/B/C返回中无失败回执；未提供Network明细或UI结果 |

常见停止条件：AUTH_REQUIRED先处理登录；CONTEXT/FRAME_INACTIVE检查另一窗口是否占用；CONFIGURATION_ERROR检查实际配置接口；EDITOR_BUSY等待原生编辑保存；VERSION_CONFLICT重新读权威版本；submission_unknown不重发，先确认实际节点是否已保存。

### 2026-10-13 已执行的排障记录

1. 用户的原DevTools标题为Harness本机HTTP地址，录制与筛选正常；不是用户选错Network类型。
2. 启用前：画布runtime为 `undefined`，服务manifest请求404；实际安装文件已经包含任务2通信桥，当前账号Profile却存在 `disabled: true`。
3. 仅将该画布插件的开关改为false，原配置备份到 `/private/tmp/canvas-task-2-live-cordis-before-enable.yml`，通过现有Harness菜单重启。
4. 启用后：正确Harness页面runtime为 `object`；同一筛选下attach、events、client-event均200，SSE连接持续超过2分钟；最终保持正确Network窗口和Keep log开启。
5. 本次只确认插件加载和桥接HTTP连接恢复。没有执行A/B/C，没有新增或修改画布节点，没有触发生成；不据此宣称严格保存、完整Host命令或Agent对话验收通过。

### 后续用户提交的A/B/C实账结果

原始返回：[Console结果归档](evidence/2026-10-13-task-2-live-console-results.json)，来源为用户手测回传，本轮未重新执行新增。

- A：103136在iframe数0时完成上下文准备并读取空图；可信版本为0，具备edit能力。
- B：新增文本节点得到saved与版本1。节点ID为 `565e2522-51c8-4152-9f6e-2a47e5b39d0b`，标题为“实账验收-846dcd14”。
- C：显式reloadContext后仍为版本1，read/confirmed读回该节点和文本“真实账号下，未打开画布创建并保存文本节点”，nodeCount为1；iframe数仍为0。

A/B/C三项Console返回符合原验收条件，验证了在画布未打开时调用原生服务读取、创建并取得严格保存回执、重载后核对数据的路径。reload保留相同contextId符合当前registry复用上下文的设计，不要求刷新时更换ID。节点params中的默认model和status:success是原生文本节点字段；此结果不是模型生成验收。

下一步使用原“画布ID→打开画布”控件打开103136，确认上述标题和文本存在且只有一个测试节点；检查现有Network日志中B对应的一次partialUpdate及C的新get请求。无需重新执行B。bridge的v3 / session.sync载荷仍待核对；A/B/C不替代Host→SSE命令或Agent对话验收。

本轮这6步完成后，可把真实SSE连通和原生服务持久化标为实账通过。完整Host命令、相同requestId去重、断线未知回执和自然语言创建画布/节点，仍需任务3工具入口后验收，不能用本文件的Console直调替代。
