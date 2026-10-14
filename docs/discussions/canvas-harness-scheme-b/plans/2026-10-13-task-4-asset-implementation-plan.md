# 任务4 聊天图片接入 Implementation Plan

> **For agentic workers:** 用户已授权任务4全部执行。沿用已批准方案B与karpathy-guidelines，在当前工作区并行完成独立Host/Web部分，由主Agent集成、review和验收；不重新开启审批、不提交或发布。保存位置遵循本专项目录约定，替代准备稿中未冻结的接口。

**Goal:** Agent能将当前会话图片或明确引用的已有画布图片保存为原生图片来源节点，无需打开画布、不触发生成，得到真实节点ID/版本及独立资产登记结果。

**Architecture:** Host从exec.agent.session.deriveMessages()筛选真实用户ImageAttachmentRef，经ctx.attachments.readImage验证字节，再调用既有STS/OSS上传。Host通过既有v3桥提交asset.add，由Client原生Store严格保存；保存成功后Host调用原业务资产登记API。模型不能指定身份、凭证、文件路径或任意URL。

**Tech Stack:** Shell1.0.6/Core0.2.1-alpha.1、附件SDK0.2.1-alpha.1、ali-oss6.20.0（同原Web版本）、现有defineTool/SSE/runtime/Store/版本队列。

**完成状态：** 4.1–4.4已执行。alpha.10已更新当前账号；实账103165/节点23a70961-ecc5-4ace-9447-8cdb8db56513/version1/registered/权威重载/原生UI通过。插件145/Web182；详见[实施归档](../implementation/2026-10-13-task-4.md)。底层HTTP次数及打开前数字iframe计数未实账采集；一次写入/无iframe的严格计数来自自动fixture。

## Global Constraints

- 后端与Shell/Core业务不改；原生Web UI、read/add及生成监听保持。
- 本期只处理当前模型可见用户消息中的图片附件；文件附件原始字节、被压缩移除的历史图片不伪称可用。
- 图片为Harness已归一化内容，非模型请求缩略图；PNG/JPEG/WEBP/GIF，小于原生20MiB边界；不承诺原文件字节保真。
- 复用原生upload字段与图片工厂，不复制Store/上传UI/节点展示。素材节点不依赖可用生成模型。
- 写入仍校验expectedVersion、编辑保护、队列版本与严格saved；unknown不能换调用自动新增。
- 上传、保存与登记分别报告；saved后登记失败不回滚、不重加节点。已确认上传在同账号/会话/附件范围复用，未知上传不自动重发。
- 真实账号图片验收与自动fixture分开记录，不伪填实账结果。

## 4.1 共享契约与文件

**Modify:** 插件src/shared/canvas-agent-protocol.ts、canvas-bridge-protocol.ts；src/host/canvas-bridge.ts；src/client/canvas-command-endpoint.ts。

```ts
interface CanvasAssetInput { url:string; title?:string; position?:{x:number;y:number} }
parseCanvasAsset(input:unknown):CanvasAssetInput;
// 内部operation，URL只由Host可信素材流程生成；不作为模型直接工具入参。
{ action:'asset.add', expectedVersion:string, asset:CanvasAssetInput }
```

- [x] 增加asset.add及严格parser：仅https、URL≤4096、无用户名/密码/fragment；title≤100与有限坐标；拒绝raw data/其他字段。
- [x] v3桥allowlist显式加入asset.add，所有“node.add才算写”断线/异常分支同时支持新写操作；不开放update/delete/run。
- [x] parser回归确认合法来源可过、任意额外字段/URL凭证拒绝；断线asset.add返回submission_unknown而非effect:none。

## 4.2 附件解析与Host上传

**Create:** src/host/asset-resolver.ts、canvas-assets.ts；test/asset-resolver.test.mjs、canvas-assets.test.mjs。
**Modify:** src/host/canvas-api.ts仅提取desktopGatewayProfile供固定环境复用；package.json/package-lock.json只增加必要SDK/OSS依赖。

```ts
sessionImages(exec:Pick<ToolRunContext,'agent'>):ImageAttachmentRef[];
readSessionImage(attachments:Pick<AttachmentStore,'readImage'>,
  exec:ToolRunContext,attachmentId:string):Promise<StoredImageAttachment>;
interface AssetIdentity { userId:string; token:string } // 仅Host，禁止进模型结果
createCanvasAssetApi(dependencies?).getIdentity(signal?):Promise<AssetIdentity>;
createCanvasAssetApi(dependencies?).uploadImage(stored,identity,signal?):Promise<UploadedCanvasImage>;
createCanvasAssetApi(dependencies?).registerImage(url,canvasId,nodeId,identity,signal?):Promise<AssetRegistration>;
```

固定请求：GET user-server/getUserDetail；POST game-ai-editor-center/upload/sts/token，libraryId1001/type1/currentUserId；Node OSS secure/simple put/不自动重试；POST game-ai-editor-center/upload/asset，assetType1/source0/sourceType upload。复用原生文件命名、对象key、公开URL和上传政策函数；不依赖UI userStore，不开放JSON Gateway到任意地址。已验证Long字符串按原数字wire无损发送，禁止转为不安全Number。

- [x] 回归：外会话ID在readImage前拒绝，非用户图片不入列表；真实ref/data原样读取，旧压缩历史图片不伪造。
- [x] 回归：固定环境/当前账号、STS归属与有效期、可信bucket/region/key、Long数字wire；OSS单次PUT、成功与unknown、取消前后、HTTP业务登录过期；消息不含Token/STS。Review缺陷的红绿证据单独归档，不把测试加载错误当作行为红测。
- [x] 实现并通过上述单测；复用当前附件SDK类型，不扫描账户文件目录。

## 4.3 原生保存与两个模型工具

**Modify:** canvas-app/src/agent-node-policy.ts、agent-adapter.ts；src/host/canvas-tools.ts仅共享现有工具上下文helper；src/host/index.ts注册并依赖attachments。
**Create:** src/host/canvas-asset-tools.ts；test/canvas-asset-tools.test.mjs；canvas-app/test/agent-asset.test.ts。

```ts
createAgentAssetNode(state:AgentNodeState,asset:CanvasAssetInput):Node;
// util.createNode → util.buildMediaUploadNodeData → native actions.addNode(factory, strict options)
canvas_assets({}); // 当前用户图片列表，最多20条，真实总数/截断与归一化说明
canvas_asset_import({canvasId,expectedVersion,
 source:{type:'attachment',attachmentId}
   |{type:'canvas_node',canvasId,nodeId,outputIndex?}, title?,position?});
// 输出JSON字符串：native saved/unknown/rejected + asset及独立assetRegistration；
// 上传结果未知单独upload_unknown；缺图片返回needs_input。不打开画布/不invoke。
```

- [x] 素材构造使用原native upload字段，标题校验/分配与尺寸处理仍由原生方法；不要求生成模型配置。
- [x] import先prepare目标/核对版本，再解析指定来源。已有画布来源必须confirmed读取真实image节点outputs；多个产物未指定outputIndex时收集缺项，不猜第一张。
- [x] 上传缓存按当前账号/会话/附件隔离，调用回执按session/callId/完整参数去重；缓存/在途沿任务2上限，不驱逐未知写来重发。
- [x] 上传后再次核对当前账号，再提交asset.add；最终仍由原Store队列校验version。saved之后独立登记；登记失败保留已保存ID。
- [x] 单测覆盖列表/缺参/来源权限、相同调用去重/参数不匹配、已上传复用、账号变化、version冲突、保存unknown、登记失败不重加。
- [x] Web原生fixture覆盖upload结构/strict saved/read、模型加载失败可保存、editor/版本变化/未知屏障；Host+Client+Store集成确认一次partialUpdate、无iframe/noinvoke。

## 4.4 构建、review与实账验收

**Modify:** 插件README、scripts/verify-isolated.mjs及必要build依赖声明；归档本专项目录implementation/evidence。

- [x] 定向测试→完整插件/相关Web回归，默认与实际Core类型检查；Web现存9诊断逐项与任务3基线比对，只修新增问题。
- [x] 只review任务4与/private/tmp/canvas-task-4-baseline的差异；保留任务1–3及用户原改动，不提交发布。
- [x] alpha.10完整build/pack，核对tgz各关键文件与build一致；实际Core临时Profile隔离安装应出现五个画布工具，asset操作不影响普通add。
- [x] 真账号最小手测：聊天附一张图片，要求创建专用测试画布并将该图加入，禁止生成/打开；saved/节点ID/版本正确；权威读contentType upload、outputs同URL；最后原生UI看同素材。原103161不改动。
- [x] 本次已用自造PNG自主完成实账，未要求用户补素材；归档真实回执与尚未采集的诊断明细，不将自动fixture当作实账测量。

测试示例期望：

```ts
assert.equal(receipt.status,'saved');
assert.equal(read.nodes[0].contentType,'upload');
assert.deepEqual(read.nodes[0].outputs,[uploaded.url]);
assert.equal(partialUpdateCalls,1);
assert.equal(invokeCalls,0);
assert.equal(canvasIframeCount,0);
```
