# Startup Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的启动页极简设计落地，不改变启动流程。

**Architecture:** App.tsx 内的 StartupPage 仅接收 detail，沿用 status-page 页面布局及品牌资源；独立 startup-content 样式隔离原有断网卡片与登录页。

**Tech Stack:** React、TypeScript、CSS、Vitest。

## Global Constraints

- 无新增依赖、动画或模拟进度。
- Logo 56px，副标题 14px，间距 24px，内容容器无背景、边框和阴影。
- 断网提示及登录页不变；用户负责本地视觉验收。
- 当前环境未提供上述执行子技能，按同一计划在当前任务内逐项执行。

### Task 1: 隔离启动页视觉并验证

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`
- Create: `test/startup-page.test.ts`

**Interfaces:** 消费现有 startup.detail；新增文件内组件 `StartupPage(props: { detail: string }): React.JSX.Element`，不改变 IPC。

- [x] 编写结构回归测试：两处启动分支使用 StartupPage；组件只有 logo 和状态副标题；断网分支保留 StatusPage、标题及 retry；独立 CSS 满足尺寸与无装饰约束。
- [x] 运行 `npm test -- test/startup-page.test.ts`，确认新组件及样式尚不存在导致失败。
- [x] 增加以下展示组件并替换 authenticated/not-ready 与 restoring 分支；StatusPage 本身不变。

```tsx
function StartupPage(props: { detail: string }): React.JSX.Element {
  return (
    <main className="status-page">
      <div className="startup-content">
        <div className="brand-mark" aria-hidden="true"><img src={brandMark} alt="" /></div>
        <p role="status">{props.detail}</p>
      </div>
    </main>
  )
}
```

- [x] 添加独立样式：

```css
.startup-content { display: grid; justify-items: center; gap: 24px; width: min(420px, 100%); text-align: center; }
.startup-content .brand-mark { width: 56px; height: 56px; border-radius: 16px; box-shadow: none; }
.startup-content p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
```

- [x] 运行 `npm test -- test/startup-page.test.ts test/renderer-development.test.ts test/startup-tracker.test.ts test/startup-ipc.test.ts`、`npm run typecheck`、`node_modules/.bin/electron-vite build` 和 `git diff --check`。
- [x] 记录自动检查结论，交付用户本地验收；不创建发布包或推送。

## 验证记录（2026-09-10）

- 新增 3 项结构回归测试先失败，实现后通过；合计 4 个测试文件、11 项测试全部通过。
- TypeScript 类型检查、Electron Vite 主进程/预加载/Renderer 构建、diff 空白检查通过。
- 自动检查不替代视觉验收；未启动真实客户端，深浅色模式、实际状态文案切换和断网重试观感待用户本地确认。
- 仅设计文档已作本地提交；实现、测试和本计划保留在工作区，未推送或创建发布包。
