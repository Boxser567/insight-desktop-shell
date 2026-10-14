# 任务4：聊天素材接入的准备与推进顺序

本文件保留任务4开始前的调查与未冻结判断；已由[详细实施计划](2026-10-13-task-4-asset-implementation-plan.md)和[实施归档](../implementation/2026-10-13-task-4.md)替代。2026-10-13任务4编码、自动验收及实账103165图片闭环均完成，当前安装alpha.10。以下各项“未编码/未执行”描述是历史准备状态，不作为当前停点。

## 目标与顺序

用户在Harness聊天中提供一张图片并要求放入画布时，Agent能引用该图片，由插件转换为画布可读取的素材，再通过原生Store保存一个图片来源节点。无需打开画布，不触发生成。之后任务5定义真实模板与输入槽位，任务6接入模板工具/Skill，任务7补齐明确节点引用与结果反馈，任务8收口发布。

| 步骤 | 本步目标 | 交付与验收 | 当前状态 |
| --- | --- | --- | --- |
| 4.1 素材与原生节点契约 | 确定当前会话图片怎样被工具可靠引用、现有上传怎么调用、原生upload节点怎样构造/登记 | 记录实际SDK接口、授权范围、媒体字段、上传/登记顺序与错误语义；给出可以编码的工具与桥契约 | 已定位下述源码和实际SDK；具体契约未冻结 |
| 4.2 素材解析与上传适配 | 当前会话附件→已验证图片字节→现有业务上传→受控素材引用 | 同一已确认素材可复用；模型不传本机路径、Token、STS或任意上传地址；上传失败不伪报可用 | 未编码 |
| 4.3 保存原生素材节点 | 使用4.2的素材引用，复用原生节点构造与Store队列 | saved返回真实nodeId/version；重载能读到相同素材；不修改已有节点，不调用invoke | 未编码 |
| 4.4 最小实账验收与归档 | 聊天上传一张图片，要求加入已有测试画布 | 对话完成素材节点保存，打开原生画布能看同图片；缺图一次收集、多个候选只在绑定不明时询问；保存未知不重复新增 | 未执行 |

先做4.1，确定契约后按4.2→4.3编码，每步有可独立核对的产出。4.4只需要一次真实小规模保存，不重跑任务3的已成功创建步骤。103161已有节点默认保留；只有用户明确要求时才在该图增加素材节点。

## 4.1 已定位的复用入口

路径以下均相对插件仓库 `/Users/boxser.shi/Documents/harness/desktop-canvas-plugin`，SDK路径相对Shell仓库。

| 位置 | 已确认事实 | 4.1必须形成的判断 |
| --- | --- | --- |
| Shell `build/core-runtime/node_modules/@deepseek-ai/dsh-attachment/lib/types/index.d.ts` | 实际0.2.1-alpha.1提供`ctx.attachments.readImage(ref, signal)`，返回已验证的ref/data；ref来自会话日志 | 从当前Agent可见的真实消息取完整ref，再按attachmentId绑定；附件存储ID本身不证明当前会话有权使用 |
| Shell `build/core-runtime/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts` | ToolRunContext带agent/callId/signal，复用任务3身份来源 | 定位Agent/Session公开读取入口；本轮只核到类型存在，未查询真实会话附件；不自行遍历账号文件目录 |
| `canvas-app/legacy/src/services/upload/uploadFile.ts`、`credentialProvider.ts`、`providers/aliyunOssProvider.ts` | 已有File上传、当前用户STS与OSS直传；credentialProvider依赖useUserStore | 判断哪些纯策略/字段可直接复用，哪些依赖需由Host适配注入；服务未打开时不能依赖页面初始化的用户Store |
| `canvas-app/legacy/src/api/upload.ts` | 既有`getStsToken`、`uploadAssetToLibrary`；资产登记含canvasId/nodeId/source/sourceType | 明确图片来源节点所需字段、登记回执和失败处理；旧canvasId声明为number，不未经确认转换Long字符串 |
| `canvas-app/legacy/src/components/canvasFlow/utils/util.ts`、`canvasAssetSync.ts`、`hooks/useFileUpload.ts` | 原生upload媒体结构、上传回调与资产登记已有实现 | 从真实调用提取最小构造/登记方法，避免复制整个Hook；区分节点严格保存与原先异步资产登记，不能把void登记当确认成功 |
| `canvas-app/src/request.ts`、`src/host/gateway-route.ts` | 当前桌面request拒绝FormData/绝对URL，Gateway是JSON转发 | 聊天上传不强行塞入既有JSON Gateway；优先Host薄上传适配，复用现有后端、STS规则与媒体政策；不笼统放开CSP |
| `src/shared/canvas-agent-protocol.ts`、`canvas-app/src/agent-node-policy.ts`、`agent-adapter.ts` | 当前NodeDraft不能表达已上传素材，upload节点不属于当前普通节点可写范围 | 增加独立受控素材操作及必要读取字段；不直接允许任意data/raw graph写入，不把空的生成图片节点冒充图片来源节点 |
| `src/shared/canvas-bridge-protocol.ts`、`src/host/canvas-tools.ts`、`canvas-app/legacy/src/store/flowStoreCore.ts` | 当前桥只read/add，已有expectedVersion/去重/严格保存队列 | 新素材操作显式通过桥parser/endpoint到现有Store；保留现有普通add语义、回执与UI默认行为 |

首步不需要用户提供模型信息。需要开发阶段核对的是当前账号附件入口、可复用上传身份与原生upload节点事实，优先直接读代码/实际类型完成，不先要求用户整理技术表格。

## 实施前必须定下的几个问题

1. **图片来源与画质：** 聊天图片的ImageAttachmentRef可能经过归一化，不能声称是未经压缩的原图。如果业务要求原图保真，应使用既有文件附件的原始字节路径，并明确图片解码/大小政策。模型请求专用缩略图不作为业务上传素材。
2. **授权与歧义：** 模型只能选择当前会话已存在的附件引用或当前画布可授权读取的资产。无素材则先收集；两张候选图片且用途未定则问绑定关系；不能默认最后一张就是商品图。
3. **上传与保存不是同一事务：** 上传成功而节点保存失败时，保留已上传引用与原画布，不重复上传；资产登记尚未确认则如实报告阶段，不伪报整个流程完成。节点保存unknown沿用任务2/3策略，先核对，不自动重加。
4. **并发与账号：** 上传较慢期间用户编辑画布仍然合法；最终保存继续校验原expectedVersion，冲突不自动覆盖。切换账号/卸载时取消未提交操作，已提交结果不转给新账号。
5. **幂等边界：** 复用当前工具callId/bridge回执规则；本机去重不承诺旧后端具备跨重启exactly-once。上传/资产登记的真实回执和未知语义先查清，不能默认可安全重发。

## 待实现文件范围

4.1结束后的详细实施计划再冻结签名，不先写未经核实的SDK调用。当前预期文件边界：

- Host：新增`src/host/asset-resolver.ts`，必要时新增独立`canvas-assets.ts`承载固定上传/登记调用；`canvas-tools.ts`注册受控素材入口，`index.ts`注入实际需要的attachments/session服务。
- 共享/Client：扩展`canvas-agent-protocol.ts`和`canvas-bridge-protocol.ts`的显式素材操作；复用原Host bridge、Client endpoint和runtime，只补新operation处理，不增加第二条通信桥。
- Web服务：`agent-node-policy.ts`/`agent-adapter.ts`只补素材构造、引用读取与原生保存调用；仅在现有Store无法返回所需严格回执时补最小支持，不修改原手工UI路径。
- 测试：附件归属/缺失/歧义、上传成功与未知、保存冲突/未知、新operation parser，以及真实原生Store fixture；现有read/add回归作为兼容检查。
- 文档：本专项目录继续记录契约、实施与验收；插件README更新实际开放能力。Shell/Core业务和后端保持不改。

## 本阶段不会误算为已完成的能力

普通空图片节点已成功，不等于图片来源节点/聊天上传已接通。任务3第二条prompt中包含连线要求，但当前工具没有边写入能力；本次仅记录节点成功。通用手工连线编辑在后续独立适配；模板节点关系优先复用原生模板导入，不让Agent逐条重建成熟模板。模型运行与产物状态反馈属于后续生成/模板闭环，本阶段保存素材即可。

用户本次提到的其他问题暂未提供具体表现。后续若发现选错画布、覆盖用户内容、重复保存或泄漏账号素材，应先修复再继续写入；其他交互问题随所属步骤收口。当前只有体验问题的概括，不把任何一项猜成已定位根因。
