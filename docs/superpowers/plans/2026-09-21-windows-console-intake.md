# Windows Console Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入上游隐藏控制台和 Node 子进程默认隐藏机制，保持命令 API 兼容。

**Architecture:** 仅在 Windows Harness 入口加载两个 helper；原生库从实际 Core 入口解析，兼容 dev 与 resources/runtime。同步 ESM exports；不改变原生 Core 进程实现。

**Tech Stack:** Node 24、Electron 44、Koffi（现有 Runtime 依赖）、Vitest。

## Global Constraints

- 保留 Electron/Core、detached 隔离、显式 windowsHide:false、企业功能及发行身份。
- 不采用 dzm/ 或 duzhimeng 代码。参考 c7faa1e、fb168ef、4d34d8d。
- 不清理用户数据，不发布。Windows 视觉行为需实机验收。
- 执行技能未提供，按用户继续指令在本会话逐项执行与验证。

## Task 1: Helpers and entry

**Files:** 新建 build/windows-child-process-hide.mjs、build/windows-hidden-console.mjs、test/windows-console-intake.test.mjs；修改 build/harness-node-entry.mjs、package.json。

**Interfaces:** `enforceWindowsChildProcessHide(childProcess, syncBuiltinESMExports)`；`createHiddenConsole({ entryPath, load? })` 返回 boolean。

- [x] 添加回归并先确认缺失 helper 导致失败。覆盖 spawn/spawnSync/fork 可选 args、exec/execFile 回调与 options 重载、显式 false、不可变 options、Promise 输出与 child、错误 stdout/stderr、ESM 导出、依赖缺失/失败、真实布局解析及打包资源。

```js
const promise = promisify(childProcess.execFile)(process.execPath, ['-e', 'console.log("ok")'])
expect(promise.child).toBeDefined()
expect((await promise).stdout.trim()).toBe('ok')
```

- [x] 从实际 `entryPath` 使用 `createRequire(entryPath)('koffi')`；AllocConsole 成功后 ShowWindow(SW_HIDE)，失败返回 false 并由入口记录不可用，不阻断启动。
- [x] 包装 Node API：options 默认加 windowsHide:true；execFile 先规范化为 file/args/options/callback；为 exec/execFile 重新绑定 promisify.custom，保留 Promise.child 和 stdout/stderr。
- [x] 在加载 Core 前、且只在 win32 接入，package.json extraResources 明确打包两个 helper。
- [x] 运行聚焦、typecheck、全量及 build:prepared；全量 117 文件 / 800 项通过。记录 Mac 验证的边界后提交。

## Windows acceptance

普通/完全权限各连续执行 pwsh，观察任务栏、窗口焦点、取消与退出清理；干净 Profile 和旧 Profile 副本各验收。原生依赖缺失不可阻断 Harness 启动，但日志应显示不可用。上述行为未在 Windows 验证前不能宣布缺陷解决。
