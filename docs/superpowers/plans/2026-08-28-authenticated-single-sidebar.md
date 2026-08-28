# 登录后单侧栏集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录后由 Harness 原生侧栏独占导航，并通过客户端自带第一方插件提供因赛AI品牌、账号入口、统一设置和退出能力。

**Architecture:** Shell Renderer 只负责未登录界面；认证后 Electron Main 将 Harness `WebContentsView` 铺满窗口。`@insight-ai/desktop-integration` 作为 Shell 仓库内构建的本地 workspace bundle 写入默认 Profile，通过正式 Core UI slots 和窄 Harness preload 账号桥接完成产品集成。

**Tech Stack:** Electron 43、React 18、Core Client UI slots、esbuild、pnpm workspace Profile、Vitest、现有 Core Runtime 锁与构建 Runbook。

## Global Constraints

- 本计划遵守 [登录后单侧栏集成设计](../../plans/2026-08-28-authenticated-sidebar-integration-design.md)。
- 开始前先把当前认证验证码/Core 开发路径修复作为独立提交收尾，不得混入本功能提交。
- [Core 设置控制计划](2026-08-28-core-settings-dialog-control.md) Task 1–3 必须先完成；正式锁更新等待本计划本地 DEV 人工验收通过。
- 不修改 Harness 侧栏源码，不查询或点击 Harness DOM，不覆盖 upstream 私有 CSS。
- 第一方 bundle 不访问令牌、Cookie、真实账号 ID 或账号目录。
- 第一方 bundle 不走 GitHub、npm registry 或用户导入流程；构建输入完全位于 Shell 仓库。
- 用户插件包保持设备共享；用户插件配置、会话和资产保持账号隔离。
- Better Sidebar 版本、入口和恢复流程不因本功能改变。
- Core Runtime 锁更新与 Shell upstream 合并不得出现在同一提交或验证批次。
- 只有本地 DEV 和目录应用人工通过后才允许触发安装包 CI。

---

### Task 1: 第一方 bundle 构建骨架

**Files:**
- Create: `packages/insight-desktop-integration/package.json`
- Create: `packages/insight-desktop-integration/cordis.patch.yml`
- Create: `packages/insight-desktop-integration/tsconfig.json`
- Create: `packages/insight-desktop-integration/src/index.ts`
- Create: `packages/insight-desktop-integration/src/client/index.tsx`
- Create: `packages/insight-desktop-integration/src/client/global.d.ts`
- Create: `scripts/build-desktop-integration.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/desktop-integration-package.test.ts`

**Interfaces:**
- Produces: `@insight-ai/desktop-integration@0.1.0`，含 `lib/index.js`、`lib/client.js` 和 bundle patch。
- Consumes: 锁定 Runtime 中的 Core client 类型；构建产物不打入 Shell Renderer。

- [ ] **Step 1: 写包契约失败测试**

```ts
it('defines an installation-owned client bundle without registry metadata', async () => {
  const manifest = JSON.parse(await readFile('packages/insight-desktop-integration/package.json', 'utf8'))
  expect(manifest.name).toBe('@insight-ai/desktop-integration')
  expect(manifest.version).toBe('0.1.0')
  expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  expect(manifest.dsh.client.inject).toEqual(expect.arrayContaining([
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-settings-general'
  ]))
  expect(manifest.publishConfig).toBeUndefined()
})
```

同时断言 patch 禁用 `ui-brand-official` 并只插入一个 `insight-desktop-integration` loader row。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run test/desktop-integration-package.test.ts`

Expected: FAIL，因为 package 尚不存在。

- [ ] **Step 3: 创建 bundle manifest 与 patch**

`package.json` 使用以下稳定字段：

```json
{
  "name": "@insight-ai/desktop-integration",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-settings-general"
      ],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-client-locale": "*",
    "@deepseek-ai/dsh-client-runtime": "*",
    "@deepseek-ai/dsh-client-ui-settings": "*",
    "@deepseek-ai/dsh-client-ui-settings-general": "*",
    "@deepseek-ai/dsh-client-ui-sidebar": "*",
    "@deepseek-ai/dsh-client-ui-slots": "*",
    "react": "^18.2.0"
  }
}
```

`cordis.patch.yml`：

```yaml
- id: ui-brand-official
  disabled: true
- insert:
    - id: insight-desktop-integration
      name: '@insight-ai/desktop-integration'
```

Host `src/index.ts` 是无状态 Cordis plugin，导出 `name`、空 `Config` 和 `apply()`；所有产品 UI 位于 client entry。

Task 1 的 `src/client/index.tsx` 先提供同样无状态的 `inject = []` 与空 `apply()`，保证 bundle 骨架可独立构建；Task 3 在该文件中接入真实 slots。

- [ ] **Step 4: 增加可重复构建脚本**

根 `devDependencies` 精确增加 `esbuild: 0.25.12`。`scripts/build-desktop-integration.mjs` 删除 package 的 `lib/` 后，用 esbuild 分别构建 `src/index.ts` 与 `src/client/index.tsx`，配置 `bundle: true`、`format: 'esm'`、`target: 'es2022'`，并 externalize `react`、`react/jsx-runtime` 和所有 `@deepseek-ai/*` 导入。`.png` loader 使用 `dataurl`，从现有 `build/app-icon.png` 内联品牌图标。

增加脚本，并把根构建拆成“准备 Runtime”与“消费已准备 Runtime”两个明确入口：

```json
{
  "typecheck:desktop-integration": "tsc --noEmit -p packages/insight-desktop-integration/tsconfig.json",
  "build:desktop-integration": "npm run typecheck:desktop-integration && node scripts/build-desktop-integration.mjs",
  "build:prepared": "npm run prepare:runtime-manifest && npm run build:desktop-integration && electron-vite build",
  "build": "npm run prepare:core-runtime && npm run build:prepared"
}
```

插件 `tsconfig.json` 不使用宽泛的 `@deepseek-ai/*` 替换；它为实际消费的入口声明精确 `paths`，使 package exports 子路径不会被错误映射：

```json
{
  "compilerOptions": {
    "baseUrl": "../..",
    "paths": {
      "@deepseek-ai/cordis": ["build/core-runtime/node_modules/@deepseek-ai/cordis/lib/types/index.d.ts"],
      "@deepseek-ai/dsh-client-runtime/client": ["build/core-runtime/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/index.d.ts"],
      "@deepseek-ai/dsh-client-locale/client": ["build/core-runtime/node_modules/@deepseek-ai/dsh-client-locale/lib/types/client/index.d.ts"],
      "@deepseek-ai/dsh-client-ui-slots": ["build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts"],
      "@deepseek-ai/dsh-client-ui-sidebar/client": ["build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/types/client/index.d.ts"],
      "@deepseek-ai/dsh-client-ui-settings/client": ["build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/types/client/index.d.ts"],
      "@deepseek-ai/dsh-client-ui-settings-general/client": ["build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/types/client/index.d.ts"]
    }
  }
}
```

所有映射都指向 `build/core-runtime`，不得指向 `/Users/.../insight-harness-core/packages`。根 `dev` 在 `prepare:core-runtime` 后、`prepare:bundled-profile` 前调用 `build:desktop-integration`；正常 package scripts 继续调用 `build`。`build:prepared` 只供明确准备过本地覆盖层的开发门禁使用。

- [ ] **Step 5: 运行包测试和构建**

Run:

```bash
npm run prepare:core-runtime
cp -R /Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/lib/. /Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/
cp -R /Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-slots /Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-slots
npx vitest run test/desktop-integration-package.test.ts
npm run build:desktop-integration
```

Expected: PASS；`lib/client.js` 不包含 React 副本，package 中没有远端 URL 或 registry 安装命令。

- [ ] **Step 6: 提交构建骨架**

```bash
git add packages/insight-desktop-integration scripts/build-desktop-integration.mjs package.json package-lock.json test/desktop-integration-package.test.ts
git commit -m "build: add desktop integration bundle"
```

### Task 2: Harness 账号桥接与原生退出

**Files:**
- Create: `src/shared/harness-account-api.ts`
- Create: `src/main/workspace/harness-account-ipc.ts`
- Modify: `src/preload/harness.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/desktop-menu.ts`
- Modify: `src/preload/windows-menu.ts`
- Create: `test/harness-account-ipc.test.ts`
- Modify: `test/shell-preload-contract.test.ts`
- Modify: `test/windows-titlebar.test.ts`

**Interfaces:**
- Produces: `window.insightDesktopAccount: HarnessAccountApi`，仅存在于 Harness preload。
- Produces: `DesktopClientInfo { version; environment; platform }`。
- Consumes: `AuthSessionManager.current()/subscribe()/signOut()` 和 `HarnessWorkspaceView.isTrustedSender()`。

- [ ] **Step 1: 写受信任发送者和数据最小化失败测试**

```ts
it('serves account summary only to the active Harness main frame', async () => {
  expect(await handlers.current(trustedEvent)).toEqual({
    displayName: 'Alice',
    avatarUrl: 'https://example.test/a.png',
    maskedPhone: '138****8000'
  })
  await expect(handlers.current(untrustedEvent)).rejects.toThrow('Harness view')
  expect(JSON.stringify(await handlers.current(trustedEvent))).not.toMatch(/token|cookie|accountId|dshHome/i)
})
```

再断言退出调用 `manager.signOut()`，client info 只含版本、环境、平台，订阅只向活动 Harness webContents 发送 `insight-account:changed`。

- [ ] **Step 2: 定义桥接接口**

```ts
export interface DesktopClientInfo {
  version: string
  environment: AuthEnvironment
  platform: 'darwin' | 'win32' | 'linux'
}

export interface HarnessAccountApi {
  current(): Promise<AccountSummary | undefined>
  subscribe(listener: (account: AccountSummary | undefined) => void): () => void
  signOut(): Promise<void>
  info(): Promise<DesktopClientInfo>
}
```

接口复用 `AccountSummary`，不得增加稳定用户 ID。

- [ ] **Step 3: 实现独立 IPC 注册器与 preload**

`registerHarnessAccountIpc()` 注册 `insight-account:current`、`insight-account:sign-out` 和 `insight-account:info`。每个 invoke 先调用注入的 `assertTrusted(event)`；`current` 只在 authenticated 时返回摘要。manager 订阅器把安全摘要或 `undefined` 发送到当前 Harness View；disposer 移除 handlers 和订阅。

Harness preload 暴露冻结 API：

```ts
const account: HarnessAccountApi = Object.freeze({
  current: () => ipcRenderer.invoke('insight-account:current'),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: AccountSummary | undefined) => listener(value)
    ipcRenderer.on('insight-account:changed', handler)
    return () => ipcRenderer.removeListener('insight-account:changed', handler)
  },
  signOut: () => ipcRenderer.invoke('insight-account:sign-out'),
  info: () => ipcRenderer.invoke('insight-account:info')
})
contextBridge.exposeInMainWorld('insightDesktopAccount', account)
```

- [ ] **Step 4: 增加原生逃生入口**

macOS/Harness application menu 在认证后显示“退出当前账号”；Windows `desktopMenuCommands` 增加固定命令 `sign-out`，自绘菜单显示相同入口。执行路径只调用 `authManager.signOut()`，不得从菜单读取 Renderer 状态。

- [ ] **Step 5: 运行测试并提交**

Run: `npx vitest run test/harness-account-ipc.test.ts test/shell-preload-contract.test.ts test/windows-titlebar.test.ts test/auth-ipc.test.ts`

Expected: PASS。

```bash
git add src/shared/harness-account-api.ts src/main/workspace/harness-account-ipc.ts src/preload/harness.ts src/main/index.ts src/shared/desktop-menu.ts src/preload/windows-menu.ts test/harness-account-ipc.test.ts test/shell-preload-contract.test.ts test/windows-titlebar.test.ts
git commit -m "feat: expose trusted Harness account bridge"
```

### Task 3: 品牌、账号入口、统一设置与拖拽区

**Files:**
- Modify: `packages/insight-desktop-integration/src/client/index.tsx`
- Create: `packages/insight-desktop-integration/src/client/components.tsx`
- Create: `packages/insight-desktop-integration/src/client/styles.tsx`
- Create: `packages/insight-desktop-integration/src/client/locales.ts`
- Create: `packages/insight-desktop-integration/src/client/account-menu-model.ts`
- Create: `test/desktop-integration-client.test.ts`

**Interfaces:**
- Consumes: `window.insightDesktopAccount`、`ctx.settingsDialog.open('client')` 和正式 UI slots。
- Produces: brand mark/name、footer account action、`client` settings section、macOS drag overlay。

- [ ] **Step 1: 写菜单动作和 slot 契约失败测试**

```ts
it('opens the client section and signs out through injected capabilities', async () => {
  const settingsDialog = { open: vi.fn() }
  const account = { signOut: vi.fn().mockResolvedValue(undefined) }
  const actions = accountMenuActions(settingsDialog, account)
  actions.openSettings()
  await actions.signOut()
  expect(settingsDialog.open).toHaveBeenCalledWith('client')
  expect(account.signOut).toHaveBeenCalledOnce()
})
```

读取 `client/index.tsx` 并断言只注册 `sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.footer.action`、`settings.section`、`shell.overlay`；不得出现 `querySelector`、`.click()`、`fetch(`、token 或 Cookie。

- [ ] **Step 2: 实现组件**

`BrandMark` 使用构建时内联的 `build/app-icon.png` 并遵守 owner `size`；`BrandName` 渲染“因赛AI”。账号 footer 首次调用 `current()` 再订阅更新，宽栏显示头像、昵称和脱敏手机号，折叠态只显示头像；菜单仅含“设置”和“退出”，重复退出时禁用。无摘要时显示不可用态，不读取缓存账号。

以 `id: 'client'`、`order: 90` 注册 `settings.section`，通过 `info()` 显示版本、测试/生产环境和平台，不显示账号资料编辑。账号设置调用 `ctx.settingsDialog.open('client')`。

- [ ] **Step 3: 实现 macOS 拖拽与受限样式**

`shell.overlay` 读取 platform，仅在 `darwin` 渲染 `left: 76px; right: 24px; top: 0; height: 28px; pointer-events: none; -webkit-app-region: drag`。CSS 只作用于 `data-insight-desktop-*` 属性，不覆盖 Harness 类名、ID 或 DOM 层级。Windows 不渲染该层。

- [ ] **Step 4: 注册 slots 与本地化**

client plugin 声明 `inject = ['slots', 'locale', 'settingsDialog']`，注册 `insightDesktop` 中英文词典。所有注册通过 `ctx.effect()` 和 `ctx.slots.inject()` 返回 disposer；品牌 mark/name 使用嵌套 inject，避免只替换一半。

- [ ] **Step 5: 运行测试和构建并提交**

Run: `npx vitest run test/desktop-integration-client.test.ts test/desktop-integration-package.test.ts && npm run build:desktop-integration`

Expected: PASS；`lib/client.js` 不包含 DOM 选择器、远端认证请求或 React runtime 副本。

```bash
git add packages/insight-desktop-integration/src/client test/desktop-integration-client.test.ts
git commit -m "feat: add Insight Harness navigation integration"
```

### Task 4: 默认 Profile 内置、升级迁移与恢复保护

**Files:**
- Modify: `scripts/prepare-bundled-profile.mjs`
- Modify: `src/main/state/bundled-profile.ts`
- Modify: `src/main/state/plugin-recovery.ts`
- Modify: `src/main/runtime/harness-runtime.ts`
- Modify: `test/bundled-profile.test.ts`
- Modify: `test/plugin-recovery.test.ts`
- Modify: `test/runtime.test.ts`
- Modify: `test/safe-mode.test.ts`

**Interfaces:**
- Produces: 默认 Profile version `3`，包含本地 workspace bundle 和 Better Sidebar 0.16.1。
- Produces: 既有账号 Profile 的加法迁移和 installation-owned bundle 保护。

- [ ] **Step 1: 写 Profile 和保护失败测试**

```ts
expect(template.dependencies).toMatchObject({
  'dsh-better-sidebar': '0.16.1',
  '@insight-ai/desktop-integration': 'workspace:*'
})
expect(template.dsh.profile.bundles).toEqual([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-better-sidebar',
  '@insight-ai/desktop-integration'
])
expect(template.insightDesktop.defaultProfileVersion).toBe(3)
```

既有 version 2 Profile 带用户插件时，迁移后用户依赖、bundle 和 `cordis.patch.yml` 原样保留，只追加第一方 bundle并清除安装完成 marker。恢复列表、错误归因和卸载 API 不得把它当作可卸载第三方插件。

- [ ] **Step 2: 在临时 Profile 中物化本地 workspace package**

准备脚本在安装 Better Sidebar 后，把已构建 package 复制到临时 Profile 的 `packages/insight-desktop-integration`，根依赖设为 `workspace:*`，bundle 追加到末尾，`pnpm-workspace.yaml` 包含 `.` 与 `packages/*`，再用 Runtime 内置 pnpm 执行 `install --no-frozen-lockfile`。生成的 node_modules 链接必须相对指向 Profile 内 `packages/`。

- [ ] **Step 3: 实现 version 2 到 version 3 加法迁移**

新账号继续原子复制完整 template。现有 version 2 Profile 只复制第一方 package source、追加 dependency/bundle、更新 workspace 文件和版本、清除 install marker，让既有 `repairProfilePackages()` 重建 lock 和链接；不得覆盖用户配置、Better Sidebar 状态或整个 `node_modules`。

- [ ] **Step 4: 保护 installation-owned bundle**

`@insight-ai/desktop-integration` 不列入 Safe Mode 卸载清单、不作为可卸载故障插件、不被无目标 profile reset 删除。Safe Mode 自身仍只启动 Core bundles；第一方 UI 缺失时使用 Task 2 原生退出。

- [ ] **Step 5: 运行测试、生成 Profile 并提交**

Run: `npx vitest run test/bundled-profile.test.ts test/plugin-recovery.test.ts test/runtime.test.ts test/safe-mode.test.ts && npm run build:desktop-integration && npm run prepare:bundled-profile`

Expected: PASS；生成 Profile 同时包含两个 bundle；无 `/tmp` 绝对依赖、`.DS_Store` 或指向 Shell 源目录的绝对 symlink。

```bash
git add scripts/prepare-bundled-profile.mjs src/main/state/bundled-profile.ts src/main/state/plugin-recovery.ts src/main/runtime/harness-runtime.ts test/bundled-profile.test.ts test/plugin-recovery.test.ts test/runtime.test.ts test/safe-mode.test.ts
git commit -m "feat: bundle protected desktop integration"
```

### Task 5: Harness View 全窗口化并删除重复 Shell UI

**Files:**
- Delete: `src/renderer/src/AuthenticatedShell.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/preload/shell.ts`
- Modify: `src/shared/shell-api.ts`
- Modify: `src/main/workspace/harness-workspace-view.ts`
- Modify: `src/main/workspace/harness-workspace-controller.ts`
- Modify: `src/main/index.ts`
- Modify: `test/harness-workspace-view.test.ts`
- Modify: `test/harness-workspace-controller.test.ts`
- Modify: `test/shell-preload-contract.test.ts`

**Interfaces:**
- Produces: Harness View 使用 `{ x: 0, y: 0, width: content.width, height: content.height }`。
- Removes: Shell `workspace:set-bounds`、`insightWorkspace`、190px rail 和独立 settings modal。

- [ ] **Step 1: 写全窗口与已删除接口失败测试**

```ts
it('fills and follows the host content area', async () => {
  await workspace.open('http://127.0.0.1:43127')
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1000, height: 700 })
  hostBounds = { x: 20, y: 30, width: 1280, height: 820 }
  notifyResize()
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1280, height: 820 })
})
```

读取 Shell preload 和 Renderer，断言不存在 `workspace:set-bounds`、`insightWorkspace`、`shell-rail`、`account-menu` 或第二个设置弹窗。

- [ ] **Step 2: 让 View 跟随窗口内容区**

`HarnessViewHost` 增加 `watchContentBounds(listener): () => void`。View 创建时订阅 BrowserWindow `resize`、`enter-full-screen`、`leave-full-screen`，每次只用 content width/height 设置相对边界；`close()` 先释放 watcher，再隐藏、移除和关闭 webContents。删除 renderer requested bounds、边界 IPC 和 controller `setBounds()`。

- [ ] **Step 3: 删除登录后 Shell 侧栏和设置**

`App.tsx` 在 authenticated 状态只渲染无交互、无可见宽度的 `.authenticated-host` 背景；Shell 继续接收 auth 状态以便 View 撤下后显示登录页。删除 `AuthenticatedShell.tsx` 及对应 CSS。客户端信息转移到 Harness bridge；统一 Settings 不提供账号配置编辑。

- [ ] **Step 4: 运行布局测试并提交**

Run: `npx vitest run test/harness-workspace-view.test.ts test/harness-workspace-controller.test.ts test/shell-preload-contract.test.ts test/workspace-lifecycle.test.ts`

Expected: PASS；关闭顺序仍是 hide → remove → close → runtime stop。

```bash
git add src/renderer/src/App.tsx src/renderer/src/styles.css src/renderer/src/global.d.ts src/preload/shell.ts src/shared/shell-api.ts src/main/workspace/harness-workspace-view.ts src/main/workspace/harness-workspace-controller.ts src/main/index.ts test/harness-workspace-view.test.ts test/harness-workspace-controller.test.ts test/shell-preload-contract.test.ts
git rm src/renderer/src/AuthenticatedShell.tsx
git commit -m "feat: make Harness the authenticated window surface"
```

### Task 6: 集成契约与文档门禁

**Files:**
- Create: `test/authenticated-sidebar-contract.test.ts`
- Modify: `docs/client-build-runbook.md`
- Modify: `docs/plans/2026-08-28-authenticated-sidebar-integration-design.md` only when implemented names or lifecycle differ

**Interfaces:**
- Produces: Runtime 升级前可执行的产品集成契约。

- [ ] **Step 1: 添加构建前契约测试**

测试读取锁定 Runtime 的 exports/types 和生成 Profile，断言六个扩展槽、`settingsDialog.open(sectionId)`、第一方 workspace bundle、被禁用的 `ui-brand-official`、Better Sidebar 0.16.1、第一方 bundle 恢复保护以及登录后 Shell rail 的缺失。

- [ ] **Step 2: 更新 Runbook 当前门禁**

阶段 2 增加该契约测试；阶段 7/8 人工清单加入折叠/展开单侧栏、两个设置入口、账号菜单、原生退出、macOS 拖拽。只记录当前流程，不复制设计全文。

- [ ] **Step 3: 运行完整静态检查并提交**

Run: `npx vitest run test/authenticated-sidebar-contract.test.ts && npm run typecheck && npm test && npm run build:prepared && git diff --check`

Expected: `npm test` 全绿，消费本地覆盖 Runtime 的普通应用 build 成功，不构建安装包；不得在 rc.10 锁定前运行会重新下载 rc.9 的 `npm run build`。

```bash
git add test/authenticated-sidebar-contract.test.ts docs/client-build-runbook.md docs/plans/2026-08-28-authenticated-sidebar-integration-design.md
git commit -m "test: gate authenticated sidebar integration"
```

### Task 7: 本地 Core 覆盖与 DEV 人工门禁

**Files:**
- Disposable: `build/core-runtime`
- Generated: `build/bundled-profile`
- No Runtime lock change in this task

**Interfaces:**
- Consumes: Core 计划 Task 2–3 的 UI Slots 制品与 `ui-settings-general/lib`，以及本计划 Task 1–6。
- Produces: 发布 Core rc.10 前的端到端人工证据。

- [ ] **Step 1: 准备本地验证 Runtime**

Run:

```bash
npm run prepare:core-runtime
cp -R /Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/lib/. /Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/
cp -R /Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-slots /Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-slots
npm run prepare:runtime-manifest
npm run build:desktop-integration
npm run prepare:bundled-profile
```

Expected: 只覆盖 disposable Runtime 中的设置包并补入 UI Slots 发布目录；`core-runtime.lock.json` 仍是 rc.9，任何源文件 import 都不指向 Core checkout。

- [ ] **Step 2: 启动已准备 DEV**

Run: `npm exec electron-vite -- dev`

Expected: 启动“因赛AI Dev”。不要运行 `npm run dev`，它会重新准备锁定 Runtime 并覆盖本地 Core 层。

- [ ] **Step 3: 人工验证**

依次确认：未登录全屏；两种登录；登录后只有 Harness 一条侧栏；因赛AI品牌；折叠/展开；macOS 拖拽；账号摘要；两个设置入口打开同一弹窗；客户端区信息；退出立即撤下旧 View；重启恢复；原生菜单退出；Safe Mode 不提供第一方 bundle 卸载。

再新建会话生成 `.md` 与 `.html`，确认都在 Better Sidebar 打开；插件列表、目录选择、插件恢复和用户插件不回归。

- [ ] **Step 4: 人工门禁决定**

全部通过后记录 Shell commit、Core commit、`因赛AI Dev.app` 绝对路径和用户数据目录，再返回 Core 计划 Task 3 发布 rc.10。任一失败都留在本地修复，不推 tag、不触发 GitHub installer。

### Task 8: 锁定 rc.10、目录应用与 DMG

**Files:**
- Modify: `core-runtime.lock.json`
- Generated only: `build/core-runtime`, `build/bundled-profile`, `dist-dev`
- Modify: `docs/client-build-runbook.md` only when a new failure changes future procedure

**Interfaces:**
- Consumes: 已验证完整的 `insight-runtime-v0.1.1-rc.10` 九项资产。
- Produces: 不依赖本地覆盖层的可复现 Shell 构建。

- [ ] **Step 1: 更新并验证三平台锁**

从 rc.10 各平台 metadata 与 SHA-256 填入 URL、Core commit、Node 和 pnpm；三个 target 的 Core commit 必须一致。运行 `npx vitest run test/prepare-core-runtime.test.mjs test/runtime-manifest.test.ts test/authenticated-sidebar-contract.test.ts`。

- [ ] **Step 2: 重新准备正式 Runtime 并完整检查**

Run:

```bash
npm run prepare:core-runtime
npm run prepare:runtime-manifest
npm run build:desktop-integration
npm run prepare:bundled-profile
npm test
npm run typecheck
npm run build
```

Expected: 所有内容来自 rc.10 锁和 Shell 源码，不再复制 Core `lib`。

- [ ] **Step 3: 提交 Runtime 锁**

```bash
git add core-runtime.lock.json
git commit -m "build: lock Core Runtime rc.10"
```

- [ ] **Step 4: 构建目录应用与 DMG**

先运行 `npm run package:dev:dir` 并重复单侧栏、账号设置、退出和 Better Sidebar 检查。目录应用通过后运行 `npm run package:dev:mac:arm64`；按 Runbook 处理未签名开发包隔离属性，覆盖安装后重复登录恢复、统一设置、退出和 Markdown/HTML Sidebar 验收。

- [ ] **Step 5: 决定是否触发 GitHub installers**

只有本地 DMG 通过才运行目标平台的 `Release desktop installers` workflow。GitHub 成功只证明产物生成；下载后的安装包仍需人工重复验收。

**Acceptance:** 未登录界面和登录后 Harness 所有权清晰；登录后只有一个侧栏；第一方集成随 Shell 构建、不可被用户卸载且不依赖 registry；统一设置、退出、安全模式和 Better Sidebar 均有自动与人工证据；Core rc.10 在本地端到端通过后才被锁定和打包。
