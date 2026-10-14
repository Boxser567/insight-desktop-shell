# alpha.12 实账反馈与 alpha.13 修复归档

本轮处理用户对画布 **103161** 的手测反馈。复用现有插件服务、原生 Store、保存队列、尺寸和上传方法；后端、原生 UI 代码、公开工具契约不变。没有操作真实账号画布，没有提交生成、模板或代码生成任务。alpha.13 是独立修复包，alpha.12 原包保留；本轮没有替换客户端安装。

## 实际反馈与验收边界

| 步骤 | 用户实际观察 | 当前判定 |
| --- | --- | --- |
| P01 | 未打开画布时 FRAME_NOT_READY / effect:none；打开侧栏后文本、原图、空图片三节点成功 | 三节点已由用户确认；无界面入口未通过 |
| P01 参数 | Agent 将 title/text 放在 node 根部，SDK 校验拒绝；改成 node.changes 后继续 | 契约正确，工具说明不够明确；本地校验错误未触达服务写入，与业务 rejected 回执区分 |
| P02 | 标题、正文和 prompt 修改基本正确；可见画布有 2–3 次整图重载 | 字段修改已确认；重载原因需结合实际调用参数判断 |
| P03 / P04 | 此次未提供具体连线及模型配置回执 | 不据“测试到第五步”推断已通过 |
| P05 | refresh:true 读失败；普通读 confirmed 19；两种导入来源均被 CONFIGURATION_ERROR / model params 502 拒绝 | 新素材未保存，终态仍 19；素材复制未通过 |
| 停步协议 | rejected 后 Agent 换来源再次导入 | 与用户指令不符；effect:none 不是重试授权 |

原图节点仅提供 `1ae0d03a…`，附件仅提供 `sha256:14fd5252…`，不能据此构造真实调用。两次导入 requestId 分别为 `canvas-960bcd9a…` 和 `canvas-87d32bc8…`。保留用户报告事实，不补造节点 ID、完整回执或未提供的操作结果。

## 根因、修复及边界

### 1. 已有画布的首次权威读取不能依赖打开界面

确定的缺陷链：`canvas_get(nodes/graph, refresh:true)` → Client 的 `reloadContext` → registry 尚无该上下文 → FRAME_NOT_READY。侧栏打开会先建立上下文，所以可绕过该条件。用户未提供 P01 的首个原始工具入参，**该缺陷已复现，但尚不能断言是实账那次报错的唯一原因**。

`canvas-app/src/canvas-service.ts` 现在对尚未初始化的上下文复用 `contextFor → acquireOwnership → initialize`，首次加载本身就是权威加载，不再要求先打开画布，不多加载一次图。已有上下文仍走原 `reload`。取消、编辑互斥、保存互斥和原生所有权仍生效；后台请求不强行抢占其他标签页的所有权。

### 2. 模型配置故障不能封死已确认图的素材编辑

确定的缺陷链：正常初始化后 `prepare(true)` 重新请求配置 → 任一配置失败直接抛错 → `loadFailure=CONFIGURATION_ERROR` → 普通读仍可返回旧图 confirmed 19，但 edit 被封闭 → `canvas_asset_import` 在准备目标上下文时拒绝。来源解析和上传尚未开始，因此换 attachment / canvas_node 都无法解决。

`canvas-app/src/canvas-context.ts` 现在允许**没有既存保存或版本不确定性**的权威图刷新在配置故障时完成。新图和新版本必须来自成功的原图 API；配置阶段记为 failed，纯文本编辑、标题/prompt 修改、删除/连线和上传来源节点可继续走原 Store。上传节点原生 factory 已支持空模型配置，不需要另写上传业务。

保留原安全边界：

- 未知保存、版本冲突或 polling barrier 不确定时，配置失败仍保留旧图和原保护，不解除写入限制。
- 新图没有可信版本时保持只读，不能拿旧版本继续写。
- 图 API 本身失败仍封写；配置/权限请求的 401、403、登录失效仍撤销上下文权限，不能读取旧缓存绕过。
- 模型目录、媒体生成节点新增、技术参数修改及 configure 仍检查当前模型和权限；本轮不开放生成。
- 此修复消除了插件的连锁阻断，**没有修复远端模型接口的 502**。模型配置步骤仍可能因此失败。

### 3. 普通编辑和回读不应逐次权威重载

已确认的机制：`refresh:true → reloadContext → prepare(true) → readiness.loading → 可见 CanvasSurface 显示加载页 → CanvasFlow 卸载并重新挂载`。普通 `node.update` 本身不会走这条路径。P02 没有完整工具参数，所以不宣称所有重载均由 refresh 引起。

`src/host/canvas-tools.ts` 和 `src/host/canvas-asset-tools.ts` 明确：正常写前及写后读取使用 `refresh:false`，当前 confirmed 版本可直接用于下一次写入；`refresh:true` 留给显式权威同步或冲突/未知回执恢复。保留显式刷新原生行为，没有更改 UI 生命周期代码。

新增节点示例已放入工具字段说明：

```json
{"type":"text","changes":{"title":"测试文本","text":"hello"}}
```

`title/text/prompt/params` 必须在 `node.changes`；更新则使用顶层 `changes`。严格 schema 保持不变。工具说明也明确：用户要求失败停止时，参数校验失败/rejected 均应停步，不换来源、参数或调用续试。**说明有助于 Agent 决策，不等于运行时已强制实现任意用户停步策略**。

## 开发与验证

生产改动集中于上述四个文件，测试复用现有 context/service 和完整 Host → Client fixtures；README、包版本及本目录文档同步。

新增模型故障测试在修复前出现三个预期失败，冷刷新测试在修复前出现两个预期失败。修复后覆盖：冷态/并发首次刷新、取消、健康配置降级、未知状态保护、缺失版本、鉴权撤销、普通编辑视图绑定、两种来源导入及无重复上传。

可见视图 fixture 连续保存文本标题/正文、原图标题、目标 prompt，验证一次初始图加载、三次保存、相同 Context/Store/Binding、readiness 不进入 loading、原图 URL/尺寸/坐标保持。该证据验证服务与视图绑定生命周期，不能替代真实窗口视觉验收。

全量结果、包 SHA、类型基线与 review 记录见 [alpha.13 检查摘要](2026-10-14-alpha13-checks.json)。安装后先执行下述三步复测，再继续 P03/P04 和 P06–P10；已成功节点无需重建。

## 三步短版复测

安装 alpha.13 后重启 Harness、新建对话。为测冷上下文，先关闭 103161 的画布标签，重启后保持不打开画布。先用当前工具目录只读核对七工具；安装版本以客户端实际加载结果为准。

每条 prompt 可独立复制。若节点同名不唯一，Agent 应先列 ID 并等用户绑定，不能猜。失败后留在该步反馈，不自动重试。

### R01 冷上下文只读

```text
开始alpha.13修复复测。全程只调用当前画布工具，不编写或执行代码，不提交任何素材生成，不执行模板，不自动打开画布。参数校验失败、rejected、upload_unknown或submission_unknown都立即停止本步骤，报告实际回执；effect:none/error.retry不授权换来源或参数重试。

对已有画布103161首次调用canvas_get(view:graph, refresh:true)，必要时按返回版本分页读完整图；随后用view:nodes、refresh:false读取“头部文案-V2”“耳机参考实拍”“头部卖点图”。只读，不新增或修改。报告consistency、版本、节点/边总数、三个真实ID和原图outputs；同名不唯一时列ID并停下等我绑定。
```

目标：没有打开画布也能首次读取；read/graph + confirmed，原节点保留。若仍 FRAME_NOT_READY，请保留首个真实工具入参、requestId、完整 error.message 和客户端启用版本，继续定位实账路径。

### R02 普通编辑保持可见画布

用户打开 103161，观察右侧画布后发送：

```text
继续复测103161。写前/写后只用canvas_get(refresh:false)读取最新confirmed版本，不做权威刷新。在原“头部文案-V2”节点将标题改为“头部文案-V3”，正文改为“通勤轻负担，音乐随身听”；将“耳机参考实拍”的标题改为“耳机参考实拍-复测”；将“头部卖点图”的prompt改为“保持参考商品外观，简洁背景，预留标题区域，alpha13保存复测”。依次用canvas_node_edit(action:update)保存并回读，报告每次真实节点ID、expectedVersion、回执version和实际变更字段。原图URL/尺寸/坐标及边保持。任一步失败立即停止，不换调用重试。只编辑保存，不生成。
```

目标：三个原 ID 不变、字段正确；用户没有编辑草稿时各次 saved，右侧不出现整图加载页/重挂闪烁。若仍重载，需要记录是否实际使用 refresh:true；不要据 Agent 最后摘要判断。

### R03 复用已有原图

```text
继续复测103161，用refresh:false读取当前confirmed版本及“耳机参考实拍-复测”的真实ID和outputs。若“备用参考图-alpha13复测”已存在，报告其ID后停止新增。否则通过canvas_asset_import(source.type:canvas_node)复用该原图的第0个output，新增一个独立图片素材节点，标题“备用参考图-alpha13复测”。不重新上传附件，不生成，不连接。保存后普通回读，报告新旧两个真实ID、outputs、contentType、保存版本及当前节点/边数。任一步失败立即停止，不换attachment来源或参数继续尝试。
```

目标：新旧 ID 不同、同一图片 URL、contentType=upload；仅新增一个素材节点，原节点和已有边保持。此步不人为制造生产 502；故障场景由本地 API fixture 覆盖。完成后可沿用原 P06–P10，但要使用实际最新节点名和 ID，不能重复执行已完成项。
