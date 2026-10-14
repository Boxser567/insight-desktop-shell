# Agent新增节点：自动放置与坐标契约实施

日期：2026-10-13。编码、review必要修复、完整自动回归、构建、打包与实际Core隔离检查已完成。新包alpha.11；本轮未自动安装到真实账号，未新增真实画布或执行真实坐标手测。桌面自动化两次读取超时，未取得可靠客户端状态，因此保留原安装，由用户按[手测步骤](2026-10-13-agent-placement-live-acceptance.md)导入新包。

## 实际行为

| 放置方式 | 新节点行为 | 范围 |
| --- | --- | --- |
| 省略placement / auto | 空画布从0,0；非空画布放到当前占用右侧+120，y与占用上边对齐 | 默认独立新增不再都落原点，旧节点不移动 |
| absolute | 使用指定的精确画布坐标，包括0,0、负坐标 | 不做避让，允许用户明确重叠 |
| after | 放在当前画布锚点的世界右边+120，y对齐 | 不搬到全图末尾、不建连线、允许与无关附近内容重叠 |

auto只处理本次新内容，不重排旧画布。纯函数支持一批顶层普通节点复用原生grid后整体追加；当前两个模型新增工具仍每次只新增一个节点，没有新增批量工具或全图layout工具。

实际调用：

```ts
canvas_node_edit({canvasId,expectedVersion,action:'add',node:{type:'text',
 changes:{title:'自动追加',text:'测试'},placement:{mode:'auto'}}});
canvas_asset_import({canvasId,expectedVersion,source,
 placement:{mode:'absolute',position:{x:-600,y:0}}});
canvas_node_edit({canvasId,expectedVersion,action:'add',node:{type:'text',
 changes:{title:'延展',text:'测试'},placement:{mode:'after',anchorNodeId}}});
```

模型工具不再接受裸position，提前返回INVALID_ARGUMENT并提示placement:absolute。共享协议和旧内部position仍保持精确语义，与placement互斥。五工具总数不变，无生成、连线、模板、Skill或节点更新/删除新入口。

## 结构与原生复用

主要修改位于 `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin`：

| 文件 | 责任 |
| --- | --- |
| 新agent-node-placement.ts | 约107行纯模块；本地几何、父链世界位置、自动/精确/锚点放置；不访问Store/API/DOM，不修改输入 |
| shared/canvas-agent-protocol.ts | NodePlacement、严格解析、legacy互斥、AgentWriteOptions.nodePlacement、可选几何回执 |
| Host canvas-tools.ts / canvas-asset-tools.ts | 统一模型schema、拒绝裸position、策略透传、坐标基准说明；资产指纹包含placement |
| Web agent-adapter.ts | 仅node.add/asset.add将策略归一并传入原生新增options |
| Web agent-node-policy.ts | 沿用原生工厂，构造时保留精确坐标；详情返回position/size/parentId |
| 原生flowStoreCore.ts | 新增1个import、1个放置计算及命名输入替换；仅options.nodePlacement路径生效 |
| 测试、隔离脚本、包元数据与README | 验证契约/Store/打包；alpha.11，无依赖变更 |

相对本轮baseline共14个已有文件修改、2个新增；不包含此前任务1–4的其他dirty文件变更。差异见[source audit](evidence/2026-10-13-placement-source-audit.json)。

关键执行位置：

```text
原生guard保护 → 原生节点构造 → prepareNodesForCreate等待媒体尺寸
→ 最新Store读取及assertAgentWrite → 同步计算位置
→ 原命名/set → 原partialUpdate队列 → saved/rejected/unknown
```

放置在同一受保护操作内、HTTP持久化队列之前计算；队列继续在实际发出前检查版本。没有新坐标队列，也没有新增保存后第二次自动排版请求。UI和旧直接Store调用未传nodePlacement时，坐标行为原样。

尺寸读取复用getCompleteMediaNodeDimensions；组额外读取有效style宽高，父链转换用于占用与after。原生媒体最短边400的尺寸策略保持，宽/长图使用准备后的真实显示尺寸。NodeDetail.position是本地坐标，有parentId时相对父组；absolute用画布坐标；after按祖先叠加后的世界位置计算。size是当前显示/占位尺寸，不是图片原始像素。

## Review及修复

两份独立只读review审阅本轮差异。发现并修复一项P1：原生复制/解组节点常用parentId:''表示顶层；新几何回执原样输出空字符串会被协议拒绝。现在序列化为parentId:null，原生Store仍保留旧值，合法父组ID保留。

对应回归先红后绿：describeAgentNode→parseCanvasOperationResult确认旧返回拒绝；另用真实Store→ClientEndpoint→HostBridge读取证明修复后通过，无保存/iframe。并补充工具描述区分本地/世界坐标，校正放置计算的队列注释。

本轮源差异范围内未发现其他阻断问题；不把源码审阅/fixture通过当作真实账号视觉验收。

## 自动验证与包

- 插件153/153；相对alpha.10新增8项契约/Host测试。
- Web207/207、19文件；新增15项纯放置/几何回归和10项原生Store集成。
- 原问题真实红测：已有节点右边界720，Agent默认新增仍x=0；修复后同一路径通过。算法模块最初原点占位测试不是生产入口红测，证据分开记录。
- 原生尺寸异步等待、宽/长图、空/负坐标、组/嵌套父链、批次、absolute0、after允许附近重叠、missing anchor无写、UI与旧strict调用、版本与编辑保护均覆盖。
- 默认插件类型、实际Shell Core类型通过；Web9条旧诊断逐文件/行列/代码/消息完全一致，无新诊断。
- 构建通过，保留原大chunk提示；58个包文件与当前构建/打包输入一致。
- 实际Core临时Profile确认仍5工具，普通和素材新增placement schema一致、无裸position；OSS依赖、v3鉴权/SSE/session/detach与卸载通过，未发业务命令。

包：`/Users/boxser.shi/Documents/harness/desktop-canvas-plugin/insight-ai-desktop-canvas-plugin-0.3.0-alpha.11.tgz`

SHA256：`d82da6fc0df3f1791063a437eef7ad6fb95a05526070906a23e9b6ad1846b1ec`；14,458,132字节。

## 范围与未验证

- 旧节点若已重叠不会自动排开；after和absolute按用户规则允许重叠。
- 原生媒体尺寸读取失败时仍以原生默认尺寸占位；以后实际尺寸变化不自动重排。这轮不承诺消除所有未来重叠。
- 仅顶层普通/上传新增；不新增组内插入、旧节点移动、工具结果/模板执行或自动全图排版。
- 原生UI、后台API、上传/登记规则及依赖保持。没有提交、发布或改Shell/Core业务。
- 真实账号alpha.11安装与手测待用户执行；客户端自动化超时属于工具连接限制，非自动审批拒绝。

证据：[checks](2026-10-13-agent-placement-checks.json)、[plugin](evidence/2026-10-13-placement-plugin-tests-final.log)、[Web](evidence/2026-10-13-placement-web-tests-final.log)、[native](evidence/2026-10-13-placement-native-green.log)、[geometry](evidence/2026-10-13-placement-geometry-green.log)、[类型基线](evidence/2026-10-13-placement-web-type-comparison.json)、[包](evidence/2026-10-13-placement-package-check.json)、[隔离](evidence/2026-10-13-placement-isolated.log)。
