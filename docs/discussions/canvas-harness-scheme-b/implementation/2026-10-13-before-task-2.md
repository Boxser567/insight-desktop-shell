# 任务 2 前置核对与收口

## 结论与范围

任务 1.1–1.4.7 的业务编码、任务 1.5 自动测试及 1.4.8 的构建/隔离安装/本机 Core 页面 fixture 验收已完成。主计划遗漏的 1.5.3、1.5.4 完成记录已补齐，并用实际测试文件替换早期拟定文件名。**没有剩余的任务 1 编码前置，可以进入任务 2 开发。**

用户在本轮明确回复真实账号保存手测“此项先搁置、我稍后完成”。因此真实账号及完整 Electron 人工验收记为用户暂缓，既不标为通过，也不继续调用真实业务接口。本轮没有修改业务代码、安装到主 Profile、修改已有业务节点、触发媒体生成或推进任务 2/3。

当前下一阶段仅验收：用户对话创建画布，添加普通节点及文本/提示词，取得真实保存回执。实际媒体生成、模板、节点更新/删除留后续；已实现的服务能力保留，只限制后续工具的当前开放范围。

## 本轮执行结果

| 核对项 | 执行与结果 |
| --- | --- |
| 任务 1 是否还有代码步骤未完成 | 主计划 1.1–1.3 和专项 1.4.1–1.4.7 完成；任务 1.5 的两项未勾选属于归档遗漏，已按现有实现与证据补齐 |
| 字段映射、严格保存、队列版本、编辑保护和无界面执行 | 定向执行 `agent-node-policy`、`agent-edit-guard`、`agent-save-receipt`、`agent-runtime-complete`、`agent-service` 五个真实测试文件，97/97 通过 |
| 初始化与 readiness / 取消 / 权威刷新 | 单独执行实际的 `agent-context-initialization.test.ts`，29/29 通过；合计 6 文件126/126，退出码均0 |
| 源码与此前完整验收是否漂移 | 对照原 checks 的43个源文件 SHA-256，全部相同；这是已归档文件的比对，不宣称检查了整个仓库的每个文件 |
| 构建与打包是否漂移 | 对照原 checks 的5个构建文件及最终 tgz SHA-256，全部相同；沿用此前完整 build、静态依赖审计和隔离安装证据，未重复完整构建 |
| 当前 Shell 是否可立即做实账测试 | 只读查看时窗口显示“正在启动智能体服务”；未对用户主工作区执行重启、登录或插件替换。随后用户明确暂缓此项 |
| 计划是否还能被误读为 iframe 命令路径 | 1.4 优先；任务 2 开始时必须迁移旧 frame 契约。正式桥直接调用 Client runtime，不能重新引入打开画布前提 |

完整检查仍引用 [1.4 checks](2026-10-13-task-1-4-checks.json)：Web167/167、插件59/59、Host/Client 类型与构建通过；Web 类型有原有9条诊断，未新增，不能记为类型全通过。本轮定向回归不是另一次完整检查。

## 交给任务 2 的已有入口

- 插件 Client 主页面已有 `window.__INSIGHT_CANVAS_RUNTIME_V1__.ready`；runtime 只在 Client 生命周期内持有业务服务。
- `ensureContext({canvasId, capability, signal?})` 准备真实上下文并返回 `contextId/readiness`，不打开标签。
- `execute({canvasId, operation, signal?})` 复用现有节点工厂、Store、队列和 API；返回 `read/saved/rejected/submission_unknown` 等事实。
- `getContextInfo`、`subscribeReadiness` 和 `reloadContext` 提供上下文定位、主动通知与明确的权威刷新；不要通过反复读取缓存恢复未知保存。
- Session/connection 归属、context 目标固定、requestId 去重、SSE/ack 路由仍属任务 2，尚未实现；不能将手动调用 runtime 解释为 Agent 对话已接通。

## 暂缓与下一步

| 项目 | 状态与后续完成条件 |
| --- | --- |
| 真实账号无界面读取/添加/保存 | 用户暂缓；具备登录环境后，在最小对话链路中新增测试节点，确认准确回执，再权威读取及打开原生 UI 核对落盘 |
| 完整 M1–M17 / 模型生成 / Electron 最小化等矩阵 | 仍未完成；按对应功能验收阶段执行，不作为当前仅创建画布和节点的全部前置 |
| 任务 2 | 可开始开发，先将旧计划迁移为 context 协议，再接本地 SSE 命令与 HTTP 回执；本轮不编码 |
| 任务 3 最小工具 | 任务 2 之后实现 `canvas_create`、`canvas_get`、`canvas_node_edit action:add`；尚未实现 |

原始证据：[定向97条日志](evidence/2026-10-13-before-task-2-focused-tests.log)、[初始化29条日志](evidence/2026-10-13-before-task-2-initialization-tests.log)、[本轮 checks](2026-10-13-before-task-2-checks.json)。历史 1.4 记录保持原始检查事实，不追溯改成生产验收通过。
