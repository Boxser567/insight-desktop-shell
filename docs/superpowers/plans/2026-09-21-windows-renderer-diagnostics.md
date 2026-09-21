# Windows Renderer Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 区分完全权限切换后的 renderer 无响应、退出和普通焦点丢失，为上游同步提供证据。

**Architecture:** 保持现有恢复策略，在 renderer-recovery 的事件边界追加结构化诊断；由 main 注入 GPU 状态。不得记录 URL、输入文本、凭据或完整环境。

**Tech Stack:** Electron 44、TypeScript、Vitest。

## Global Constraints

- 不更改 Electron/Core、权限或恢复重试策略，不清理用户数据。
- 不引入 dzm/ 或 duzhimeng 来源。
- 本批仅完成诊断；隐藏控制台和 Node 子进程适配是下个独立批次。
- 当前没有可用的 superpowers 执行技能，按当前会话内测试先行流程执行，不声称调用了不存在的技能。

## Task 1: Renderer evidence

**Files:** `src/main/renderer-recovery.ts`, `src/main/index.ts`, `test/renderer-recovery.test.ts`。

**Interfaces:** 新增可选 `gpuStatus?: () => unknown` 依赖；保持 `installRendererRecovery` 返回值与恢复行为不变。

- [x] 添加行为测试：

```ts
const { emitter, options } = setup()
emitter.emit('unresponsive')
expect(options.note).toHaveBeenCalledWith(expect.stringContaining('renderer diagnostic'))
expect(emitter.reload).not.toHaveBeenCalled()
```

补测 responsive、killed 退出仍留证但不触发恢复、GPU 读取失败不阻断恢复、失活账号不记录。

- [x] 执行 `npm test -- test/renderer-recovery.test.ts`，确认新增断言失败。
- [x] 在事件回调中记录 `{ time, event, webContentsId, reason?, exitCode?, gpu? }` 的 JSON；GPU 回调失败记录固定 `unavailable`，不输出原始错误；不调用 getURL。
- [x] main 两个现有安装点传入 `gpuStatus: () => app.getGPUFeatureStatus()`。
- [x] 执行聚焦测试与 `npm run typecheck`；检查 diff 后独立提交。全量 116 文件 / 788 测试通过。

## 后续批次与外部证据

用户并行提供 RC16 harness.log 尾部、Windows Application Error/Hang/WER 事件、系统/DSH Desktop 对照版本。日志分享前脱敏。

下一批需单独列出子进程重载、promisify、显式 windowsHide:false、真实 resources/runtime 原生依赖解析的测试，再接入隐藏控制台。Windows taskbar/焦点必须实机验证，不能以 Mac 测试替代。
