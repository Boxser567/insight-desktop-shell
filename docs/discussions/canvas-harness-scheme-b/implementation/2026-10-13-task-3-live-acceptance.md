# 任务 3：真实 Agent 对话创建画布与节点

当前账号已安装并启用最终alpha.9包。2026-10-13用户通过两条真实prompt成功创建画布103161、文本节点及空图片节点；本次最小目标按用户报告通过，见[结果归档](evidence/2026-10-13-task-3-user-dialogue-results.json)。无需再次安装或重复创建。下方保留完整排查流程；用户第二条实际prompt是新增图片节点，并未执行这里的权威重载步骤。

已提供：真实对话、画布ID、两种节点成功。未提供：节点ID/保存版本/工具回执/SSE阶段/无iframe统计/权威重载/原生UI截图。连线不在当前read/add工具范围；第二条prompt的连线要求不记为通过。用户提到其他问题尚未逐项描述，暂存，不阻塞任务4前置准备。

## 目标与准备

目标：用户只通过对话创建一张新画布和一个文本节点，服务在画布未打开时真实保存；随后对话权威重载核对，最后用户打开原生UI查看同节点。本轮不运行图片/视频模型。

1. Shell保持真实账号登录；菜单插件→导入本地插件，选择 `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/insight-ai-desktop-canvas-plugin-0.3.0-alpha.9.tgz`。
2. 确认当前账号的画布插件已启用，等待Harness恢复。若未加载，使用Harness→重启Harness。目标Core0.2.1-alpha.1；不要选择旧alpha.8包。
3. 新建一个空闲聊天会话，关闭Shell画布标签。打开该Harness内容页DevTools（location.href为本机HTTP地址），Network开启Keep log、All/Fetch/XHR，保持画布未打开。

最终包SHA-256：`762abd3a19165dd7f9ce3bc92937915d6e273437a031543c5330332047401f62`。原任务2包保留，103136测试节点不需要删除或重建。

## 第一条对话：创建与保存

直接发送：

> 创建一个叫“Agent画布验收”的空画布，添加一个标题为“测试文本”的文本节点，内容为“通过Agent对话创建并保存”。只创建和保存，不生成图片或视频，不打开画布。完成后告诉我画布ID、节点ID和保存版本。

| 检查 | 通过条件 |
| --- | --- |
| 工具调用 | 实际调用canvas_create，再调用canvas_node_edit(action:add)；必要时调用canvas_get(view:nodes)取得版本。不能只看Agent自然语言“成功” |
| 创建 | 工具created含合法新ID/address；正常为runtime:ready和可信version。不使用手工已有103136替代新创建验收 |
| 新增 | 工具saved含实际affectedNodeIds和可信新version；不是submitted/unknown，也不是泛化“请求已发出” |
| 运输 | 既有bridge连接；events中canvas.prepare/canvas.command，client-event中prepared/accepted/started/settled，目标为本次新ID。只有settled的saved证明保存 |
| 持久化 | 本次节点新增对应一次原canvas/partialUpdate；输入版本与工具传入expectedVersion一致，返回版本与saved一致；没有workflow/invoke |
| 无界面 | Shell未打开画布；Console执行下方只读统计，结果0 |

```js
[...document.querySelectorAll('iframe')]
  .filter(frame => frame.src.includes('/desktop-canvas/view')).length
```

Host直接发起的saveOrUpdate不一定显示在Renderer Network中；创建结果以工具回执/随后后端get为依据。Client原生服务的get/partialUpdate应在正确Harness Network中查看。

## 第二条对话：权威重载

使用第一步返回的真实ID继续发送：

> 请从后端重新读取刚创建的画布，核对“测试文本”节点的ID、正文与保存版本，仍不要打开画布。

检查canvas_get入参为view:nodes、refresh:true，可带上刚返回的nodeIds。结果应为read/confirmed、source:plugin-service，新后端get包含同节点ID/标题/正文。没有其他编辑时版本应等于刚保存版本；若有合法外部修改可上升，不能下降。iframe仍为0。

最后在Shell原“画布ID→打开画布”控件输入本次新ID，确认只有一个“测试文本”节点，正文为“通过Agent对话创建并保存”。此时才允许iframe为1。这一步同时收尾此前未完成的同Store原生UI核对；不再执行Console B新增。

## 停止条件与记录

- created/runtime:not_ready：保留本次ID；恢复服务后读取或添加同画布，不再次创建。
- create_unknown：先在画布列表核对；不要重新发送“创建”来试运气。
- submission_unknown：按原ID权威读取核对节点，不换调用重复新增。
- VERSION_CONFLICT：读取最新事实后判断原请求；不自动用新版本覆盖用户内容。
- 未见工具调用：确认alpha.9已加载、当前账号插件启用、使用新会话；记录Agent回应及工具列表，不用通用网络/Console调用替代验收。

| 记录项 | 结果 |
| --- | --- |
| Shell/Core/插件版本 | 待真实对话填写 |
| 会话、新画布ID | 待填写 |
| create结果 | status/runtime/version |
| add结果 | status/节点ID/version/保存次数 |
| SSE命令 | 实际目标与阶段，勿提交bridgeKey/账号Token |
| 权威读取 | confirmed/ID/标题/正文/version/新get |
| 原生UI | 同节点且仅一个 |

本次“Agent对话创建画布与普通节点”的最小目标已按用户报告通过；上表明细仍是完整诊断标准，缺项不伪填。模板、生成、连线和节点更新/删除仍属于后续范围。
