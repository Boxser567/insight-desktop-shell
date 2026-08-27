# 登录与业务入口架构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 Core Runtime 所有权的前提下，为因赛AI建立服务端控制的登录、会话恢复、受保护业务入口和按账号范围隔离的 Harness 工作区。

**Architecture:** Shell Renderer 是唯一产品入口；Electron Main 协调凭证、会话状态、本地账号范围和 Runtime 生命周期。Harness 保持独立的本地运行时，并仅以受保护的 `WebContentsView` 工作区附着到 Shell。身份、能力与业务数据授权均由服务端控制面和业务服务判定。

**Tech Stack:** Electron 43、electron-vite、TypeScript、Vitest、锁定的 Insight Harness Core Runtime、待确认的企业身份/控制面服务。

## Global Constraints

- 不在 Shell、Harness Profile、插件配置或 Renderer localStorage 保存原始长期凭证或用户密码。
- Electron Main 是桌面端凭证保管与 Runtime 生命周期协调者；Renderer 只消费经筛选的会话状态与能力。
- Control Plane/业务服务是身份、租户、授权与业务数据范围的权威来源；本地角色、目录和隐藏入口均不是授权事实。
- Harness 继续只监听 `127.0.0.1`，并以锁定的 Core Runtime 制品运行。
- 未登录时不启动或显示 Harness 工作区；退出、失效、禁用和撤销时停止并卸载该工作区。
- 旧的设备级 `insight/harness` 不自动迁移进任何账号范围。
- 不实现密码注册、模拟正式 token、插件市场、管理员后台或未经确认的 Canvas 协议。
- 每个可运行切片须通过 `npm test`、`npm run typecheck`、`npm run build`；涉及 Runtime 或窗口行为的切片还须进行 macOS/Windows 包回归。

---

### Task 1: 冻结跨端身份与能力契约（决策门）

**Files:**
- Modify: `BoxserObsidian-Canvas/02_Contracts/客户端登录、会话与业务数据隔离前端接入需求.md`
- Create: `BoxserObsidian-Canvas/02_Contracts/2026-08-27-客户端登录与能力启动契约快照.md`
- Modify: `BoxserObsidian-Canvas/00_System/open-questions.md`

**Consumes:** 产品对 D17 的身份源、注册/邀请路径与账号生命周期决定；后端对错误语义、会话恢复和能力范围的协商输入。

**Produces:** 一份经 Product、Backend、Frontend 评审的版本化契约快照，明确前端可见状态、恢复动作、兼容规则和测试环境；不在快照中暴露生产密钥或凭证值。

- [ ] **Step 1: 确认身份与账号生命周期**

记录并签署以下事实：身份源；注册或受邀的服务端入口；首次登录、续期、退出、账号禁用、企业/角色变化、设备迁移及离线的用户语义。若企业账号不允许自助注册，登录页只显示由服务端提供的受邀/联系管理员入口。

- [ ] **Step 2: 确认前端可消费的结果分类**

为“恢复完成但未登录、登录完成、网络不可用、重新验证、会话失效、账号禁用、无权限、能力已变更”分别定义一个稳定结果类型、用户可见文案责任方和恢复动作；网络失败不得复用会话失效结果。

- [ ] **Step 3: 确认启动信息与撤销通知**

确定客户端在进入受保护区前获得的账号摘要、企业范围、可见能力、有效期/刷新语义以及服务端撤销或权限变化的通知方式。确认业务 API 对每个受保护请求独立鉴权。

- [ ] **Step 4: 归档并关闭决策门**

将原 `draft` 契约链接到已审阅快照，并把 D17 标记为已解决；若 D18、真实 Brief 或 Canvas 范围仍未确认，保留它们的 open 状态而不以此阻塞登录基础切片。

**Acceptance:** 三方能以同一份快照写出首次启动、登录、重启恢复、退出、失效、禁用和企业变化的端到端用例；不存在由前端自行猜测的 token 字段或授权规则。

### Task 2: 建立 Shell Renderer 与本地会话边界

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/session/session-state.ts`
- Create: `src/preload/session.ts`
- Create: `src/main/session/session-manager.ts`
- Create: `src/main/session/session-types.ts`
- Modify: `electron.vite.config.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`
- Create: `test/session-state.test.ts`
- Create: `test/session-manager.test.ts`

**Consumes:** Task 1 的已审阅状态与错误分类。

**Produces:** Main 中唯一的 `SessionManager`，以及仅暴露状态查询、登录发起、退出和订阅的 preload API；Renderer 中独立的启动状态与受保护路由。

- [ ] **Step 1: 为状态机写失败测试**

测试初始 `restoring` 不渲染受保护路由；`unauthenticated` 只渲染登录入口；`authenticated` 才允许业务首页；`expired`、`disabled` 与 `forbidden` 会清空受保护内存状态并进入各自恢复页。测试还须断言 Renderer 状态没有凭证字段。

- [ ] **Step 2: 运行状态机测试并确认失败**

Run: `npx vitest run test/session-state.test.ts test/session-manager.test.ts`
Expected: FAIL，因为 Shell Renderer 与 `SessionManager` 尚不存在。

- [ ] **Step 3: 实现最小会话接口**

```ts
export interface AccountSummary {
  displayName: string
}

export interface CapabilityManifest {
  version: string
  enabled: readonly string[]
}

export type SessionView =
  | { kind: 'restoring' }
  | { kind: 'unauthenticated' }
  | { kind: 'authenticating' }
  | { kind: 'authenticated'; account: AccountSummary; capabilities: CapabilityManifest }
  | { kind: 'expired' }
  | { kind: 'disabled' }
  | { kind: 'forbidden' }
  | { kind: 'offline' }

export interface DesktopSessionApi {
  current(): Promise<SessionView>
  beginSignIn(): Promise<void>
  signOut(): Promise<void>
  subscribe(listener: (view: SessionView) => void): () => void
}
```

`AccountSummary` 与 `CapabilityManifest` 是 Renderer 所需的最小投影；Control Plane 响应到该投影的映射只在 Main 中完成。Main 负责安全存储、刷新和服务端调用；preload 不新增读取或写入 token 的方法。

- [ ] **Step 4: 用本地会话服务契约测试验证 Main 边界**

测试 `SessionManager` 只向 Renderer 返回 `SessionView`；验证退出、失效和禁用会先发布非认证状态，再解析受保护状态。对系统安全存储和 Control Plane 使用测试替身，禁止使用伪造的正式 token 格式。

- [ ] **Step 5: 验证 Shell 构建**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS；首次启动只显示恢复态，状态确定后才显示登录或 Shell 首页。

- [ ] **Step 6: Commit**

```bash
git add src/renderer src/main/session src/preload/session.ts src/preload/index.ts src/main/index.ts src/shared/contracts.ts electron.vite.config.ts test/session-state.test.ts test/session-manager.test.ts
git commit -m "feat: add shell session boundary"
```

### Task 3: 将 Harness 改为受保护的工作区 View

**Files:**
- Create: `src/main/workspace/harness-workspace-view.ts`
- Create: `src/main/workspace/harness-profile-path.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/security-policy.ts`
- Modify: `src/main/runtime/harness-runtime.ts`
- Create: `test/harness-workspace-view.test.ts`
- Create: `test/harness-profile-path.test.ts`
- Modify: `test/runtime.test.ts`

**Consumes:** Task 2 的认证状态和服务端确认的稳定账号范围。

**Produces:** 仅在 `authenticated` 状态下创建的 Harness `WebContentsView`，以及从可信账号范围派生的账号专属 `dshHome` 路径。

- [ ] **Step 1: 写失败测试**

覆盖四种行为：未认证不能创建 Runtime/View；已认证进入工作区时启动 Runtime 并附着 View；退出/失效/禁用时停止 Runtime、移除 View；不同账号范围映射到不同 `accounts/<opaque-account-scope>/harness` 目录，且不返回旧设备级路径。

- [ ] **Step 2: 运行工作区测试并确认失败**

Run: `npx vitest run test/harness-workspace-view.test.ts test/harness-profile-path.test.ts test/runtime.test.ts`
Expected: FAIL，因为现有主窗口仍直接导航到 Harness URL。

- [ ] **Step 3: 实现受保护的 View 容器**

`HarnessWorkspaceView` 仅接受已认证的 `AccountScope` 和已验证的能力；它负责启动/停止 Runtime、加载本地 Harness URL、调整 View 尺寸和销毁 WebContents。Shell 主窗口始终保留自身 Renderer，不能通过 `window.loadURL()` 离开 Shell。

- [ ] **Step 4: 实现账号范围 Profile 路径**

```ts
export type AccountScope = string & { readonly __accountScope: unique symbol }

export function harnessProfilePath(insightRoot: string, accountScope: AccountScope): string
```

`AccountScope` 只由 Main 的已验证会话创建，且值不得为空、含路径分隔符或来自 Renderer 输入。`harnessProfilePath` 返回 `<insightRoot>/accounts/<opaque-account-scope>/harness`；不要自动复制旧 `insight/harness`。

- [ ] **Step 5: 回归窗口与 Runtime 行为**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS；Harness 仍仅监听回环地址，启动失败恢复仍可用，未登录页面从不加载 Harness。

- [ ] **Step 6: Commit**

```bash
git add src/main/workspace src/main/index.ts src/main/security-policy.ts src/main/runtime/harness-runtime.ts test/harness-workspace-view.test.ts test/harness-profile-path.test.ts test/runtime.test.ts
git commit -m "feat: gate harness workspace by session"
```

### Task 4: 接入服务端能力并收敛员工可见入口

**Files:**
- Create: `src/main/capabilities/capability-client.ts`
- Create: `src/main/capabilities/capability-store.ts`
- Create: `src/renderer/src/navigation/capability-navigation.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/context-menu-template.ts`
- Modify: `src/renderer/src/App.tsx`
- Create: `test/capability-store.test.ts`
- Create: `test/capability-navigation.test.ts`

**Consumes:** Task 1 的能力清单、刷新与撤销契约，以及 D18 已确认的员工可见能力范围。

**Produces:** 服务端能力驱动的导航和原生菜单策略；能力变更后立即使本地受保护入口失效。

- [ ] **Step 1: 写失败测试**

测试空能力清单不展示业务/工作区入口；允许的能力只展示对应导航；能力刷新移除工作区时 View 被卸载；本地安装的插件、Settings 或缓存角色不会使一个被禁止的入口重新出现。

- [ ] **Step 2: 运行能力测试并确认失败**

Run: `npx vitest run test/capability-store.test.ts test/capability-navigation.test.ts`
Expected: FAIL，因为当前菜单与 Harness Profile 没有服务端能力边界。

- [ ] **Step 3: 实现最小能力投影**

`CapabilityStore` 只保存来自已认证会话的、带版本的能力投影。Renderer 依据该投影渲染；Main 依据该投影允许工作区生命周期动作。业务服务仍逐请求进行服务端授权，能力投影不缓存授权结论。

- [ ] **Step 4: 验证能力撤销**

在测试替身中推送“工作区能力撤销”，断言导航消失、Harness View 被移除、Shell 转至安全首页；推送网络失败时保留当前安全状态并显示可重试提示，而不是错误地登出。

- [ ] **Step 5: 验证与提交**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS。

```bash
git add src/main/capabilities src/renderer/src/navigation src/main/index.ts src/main/context-menu-template.ts src/renderer/src/App.tsx test/capability-store.test.ts test/capability-navigation.test.ts
git commit -m "feat: drive shell navigation from capabilities"
```

### Task 5: 实现 Campaign Pack 业务默认入口

**Files:**
- Create: `src/renderer/src/business/campaign-pack/`
- Create: `src/main/business/campaign-pack-client.ts`
- Modify: `src/renderer/src/App.tsx`
- Create: `test/campaign-pack-entry.test.ts`
- Create: `test/campaign-pack-client.test.ts`

**Consumes:** D18 确认的默认能力、产品提供的真实 Brief/输入/产物/失败例，以及后端已版本化的业务契约。

**Produces:** 一个可从已登录首页完成、可恢复失败且受服务端授权的电商任务切片。

- [ ] **Step 1: 将真实 Brief 转为验收示例**

用产品提供的输入、约束、预期产物和失败例写出可重复的前端测试 fixture；fixture 不包含真实用户、企业或生产凭证。若产品尚未提供这些材料，本任务不得开始。

- [ ] **Step 2: 写失败测试**

测试已登录且具备该能力的用户能完成输入、提交、进度与结果呈现；无该能力、会话失效、服务端拒绝和可恢复网络失败分别走 Task 1 中确认的恢复路径。

- [ ] **Step 3: 运行聚焦测试并确认失败**

Run: `npx vitest run test/campaign-pack-entry.test.ts test/campaign-pack-client.test.ts`
Expected: FAIL，因为业务入口与服务端客户端尚不存在。

- [ ] **Step 4: 实现最小垂直切片**

业务客户端通过 Main 的已认证服务边界调用后端；Renderer 不自行持有授权凭证。只实现真实 Brief 所需的输入、状态和产物展示，不预建其他行业页面、管理员页面或未确认的 Canvas 协议。

- [ ] **Step 5: 验证与发布回归**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS。

在 macOS 与 Windows 的匹配 runner 上运行对应安装包构建，并按“首次启动、登录、重启恢复、退出、失效、禁用、业务任务、Runtime 恢复”手工验收。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/business/campaign-pack src/main/business/campaign-pack-client.ts src/renderer/src/App.tsx test/campaign-pack-entry.test.ts test/campaign-pack-client.test.ts
git commit -m "feat: add campaign pack business entry"
```

## Plan Self-Review

- 覆盖范围：Shell 保留主入口、登录/注册由服务端托管、凭证不泄露给 Renderer/Core、按账号范围隔离、Harness 受保护挂载、能力收敛与首条业务垂直切片均有独立工作包。
- 依赖约束：Task 2-4 依赖 Task 1；Task 5 额外依赖 D18、真实 Brief 和版本化业务契约。未确认的输入不会被伪造为实现细节。
- 不在范围：自建身份供应商、存储密码、插件市场、管理员后台、全量 Canvas 重写、Core 源码复制或 Runtime 自动更新。
