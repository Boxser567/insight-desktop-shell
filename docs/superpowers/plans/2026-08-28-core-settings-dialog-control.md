# Core 设置对话框控制能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Core 中提供产品无关、可测试的 `ctx.settingsDialog.open(sectionId?)`，并让 Desktop Runtime 携带外部 UI 插件编译所需的 Slots 类型契约，使正式插件无需 Core 源码即可打开现有设置中心。

**Architecture:** `ui-settings-general` 已拥有 `sidebar.settings`、设置弹窗和组件局部状态，因此由该包提供一个薄控制器，并在 `SettingsRoot` 挂载期间连接 `open` 动作。`ui-settings` 基础包、侧栏布局和设置数据服务保持不变。Desktop Runtime 的私有 deploy root 显式包含 `dsh-client-ui-slots`，把可消费的 UI 扩展类型纳入不可变制品，而不是让 Shell 回读 Core workspace。

**Tech Stack:** Cordis service registry、React 18、TypeScript strict、Vitest、Testing Library、Core 双语 README 与 Agent Note。

## Global Constraints

- Core 不得包含因赛AI品牌、账号类型、Electron IPC 或产品 API。
- Shell 插件的编译输入只能来自锁定 Runtime；不得通过路径别名、链接或复制读取 Core 源码。
- 不修改 `ui-sidebar` 布局，不新增 DOM 选择器、模拟点击或私有路由。
- 服务名称固定为 `settingsDialog`；公开接口固定为 `open(sectionId?: string): void`。
- `open()` 在设置 Shell 未挂载时抛出明确错误，不缓存跨挂载请求。
- 服务提供和组件动作连接都必须随 Cordis fiber/React 组件卸载而释放。
- 修改英文 README 时同步更新中文 README 和一致性记录。
- 非平凡 Core 变更在同一提交中包含双语 implemented Agent Note。
- 本地 Shell 单侧栏验收前不得创建 Runtime tag 或触发三平台构建。

---

### Task 1: 设置控制器与组件生命周期

**Files:**
- Create: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/src/client/settings-dialog.ts`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/src/client/shell-contract.ts`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/src/client/SettingsRoot.tsx`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/src/client/index.ts`
- Create: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/tests/settings-dialog.client.spec.ts`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/tests/settings-root.client.spec.tsx`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/tests/shell.client.spec.ts`

**Interfaces:**
- Produces: `ISettingsDialog { open(sectionId?: string): void }`。
- Produces: `SettingsDialogController.attach(actions): () => void`，仅供设置 Shell 连接组件动作。
- Produces: `ClientContext['settingsDialog']`，供 UI 插件声明注入。

- [ ] **Step 1: 写控制器失败测试**

```ts
import { describe, expect, it, vi } from 'vitest'
import { SettingsDialogController } from '../src/client/settings-dialog.ts'

describe('SettingsDialogController', () => {
  it('forwards open requests only while one settings shell is attached', () => {
    const controller = new SettingsDialogController()
    const open = vi.fn()
    expect(() => controller.open('client')).toThrow('not mounted')
    const detach = controller.attach({ open })
    controller.open('client')
    expect(open).toHaveBeenCalledWith('client')
    detach()
    expect(() => controller.open()).toThrow('not mounted')
  })

  it('rejects a second live settings shell owner', () => {
    const controller = new SettingsDialogController()
    const detach = controller.attach({ open: vi.fn() })
    expect(() => controller.attach({ open: vi.fn() })).toThrow('already mounted')
    detach()
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run packages/client/ui-settings-general/tests/settings-dialog.client.spec.ts`

Expected: FAIL，提示 `settings-dialog.ts` 不存在。

- [ ] **Step 3: 实现最小控制器**

```ts
/** Public settings-dialog actions available to client plugins. */
export interface ISettingsDialog {
  /** Open the settings shell, optionally selecting a registered section. */
  open(sectionId?: string): void
}

/** Component-owned actions connected only while SettingsRoot is mounted. */
export interface SettingsDialogActions {
  open(sectionId?: string): void
}

/** Connect the public service to the one mounted settings shell. */
export class SettingsDialogController implements ISettingsDialog {
  private actions?: SettingsDialogActions

  attach(actions: SettingsDialogActions): () => void {
    if (this.actions !== undefined) throw new Error('The settings dialog is already mounted.')
    this.actions = actions
    return () => {
      if (this.actions === actions) this.actions = undefined
    }
  }

  open(sectionId?: string): void {
    if (this.actions === undefined) throw new Error('The settings dialog is not mounted.')
    this.actions.open(sectionId)
  }
}
```

- [ ] **Step 4: 把控制器接入 `SettingsRoot`**

在 `SettingsRootInjected` 增加 `settingsDialog: Pick<SettingsDialogController, 'attach'>`。把 `openSection` 改为接受可选 ID，并在组件中连接和释放动作：

```tsx
const openSection = useCallback((id?: string) => {
  setActiveId(id)
  setOpen(true)
}, [])

useEffect(
  () => props.settingsDialog.attach({ open: openSection }),
  [openSection, props.settingsDialog],
)
```

保留现有触发按钮、Escape、遮罩关闭和 onboarding 行为。`open()` 不带 ID 时由现有 `rows[0]` 回退选中第一项。

- [ ] **Step 5: 在 Cordis Context 提供服务**

`client/index.ts` 导出公开类型并声明 Context merge：

```ts
export { SettingsDialogController } from './settings-dialog.ts'
export type { ISettingsDialog } from './settings-dialog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Product-independent control of the mounted settings shell. */
    settingsDialog: import('./settings-dialog.ts').ISettingsDialog
  }
}
```

`apply()` 创建一个 `SettingsDialogController`，通过 `ctx.reflect.provide('settingsDialog', settingsDialog)` 提供服务，并把同一实例放进 `shellInjected()`。effect disposer 必须释放 service；设置 entry 的既有 disposer 继续管理组件注册。

- [ ] **Step 6: 增加外部打开与卸载测试**

在 `settings-root.client.spec.tsx` 的 `mount()` fake 中记录 `attach` 传入的动作，断言：

```ts
act(() => attached.open('models'))
expect(screen.getByRole('dialog', { name: 'Settings Title' })).toBeTruthy()
expect(renderSlot).toHaveBeenCalledWith(
  'settings.section',
  expect.any(Object),
  { only: 'models' },
)
```

卸载组件后调用旧 disposer，再调用 `controller.open()` 必须抛出 `not mounted`。在 `shell.client.spec.ts` 断言 `ctx.get('settingsDialog')` 存在、HMR dispose 后消失、重新挂载后是新实例。

- [ ] **Step 7: 运行聚焦测试**

Run: `pnpm exec vitest run packages/client/ui-settings-general/tests/settings-dialog.client.spec.ts packages/client/ui-settings-general/tests/settings-root.client.spec.tsx packages/client/ui-settings-general/tests/shell.client.spec.ts`

Expected: PASS；原有触发、关闭、section 与 onboarding 测试不回归。

### Task 2: Runtime UI 扩展类型闭包

**Files:**
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/runtime/desktop/package.json`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/pnpm-lock.yaml`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/scripts/desktop-runtime-artifact.ts`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/scripts/desktop-runtime-artifact.spec.ts`
- Create: `/Users/boxser.shi/Documents/harness/insight-harness-core/.agents/notes/implemented/architecture/2026-08-28-desktop-runtime-client-extension-contracts.md`
- Create: `/Users/boxser.shi/Documents/harness/insight-harness-core/.agents/notes/implemented/architecture/2026-08-28-desktop-runtime-client-extension-contracts.zh.md`
- Create: `/Users/boxser.shi/Documents/harness/insight-harness-core/.agents/notes/implemented/architecture/2026-08-28-desktop-runtime-client-extension-contracts.i18n.yaml`

**Interfaces:**
- Produces: Desktop Runtime 顶层 `node_modules/@deepseek-ai/dsh-client-ui-slots`，供仓外第一方 UI 插件做类型检查。
- Preserves: Runtime 运行入口、metadata schema 和现有依赖闭包。

- [ ] **Step 1: 写制品布局失败测试**

给 `assertDesktopRuntimeLayout()` 的临时目录 fixture 建立 Node、pnpm 和 DSH 入口，但不建立 UI Slots manifest，断言它抛出包含 `dsh-client-ui-slots/package.json` 的错误；补齐该 manifest 后必须通过。该测试证明的是发布制品，不以 Core workspace 中存在源码代替。

- [ ] **Step 2: 把 UI Slots 加入私有 deploy root**

在 `runtime/desktop/package.json` 的 dependencies 增加：

```json
"@deepseek-ai/dsh-client-ui-slots": "workspace:^"
```

运行 `pnpm install --lockfile-only` 更新 `pnpm-lock.yaml` 的 `runtime/desktop` importer。不要把其他 client package 或 Shell 产品代码加入 deploy root。

- [ ] **Step 3: 扩展布局断言并记录制品职责**

`assertDesktopRuntimeLayout()` 除现有三个可执行入口外，再检查 `node_modules/@deepseek-ai/dsh-client-ui-slots/package.json` 与 `lib/types/index.d.ts`。

新增双语 implemented Agent Note，记录 Desktop Runtime 为 Shell 仓内第一方 client bundle 提供编译类型闭包；它不承诺暴露 Core 源码，也不把所有 client package 自动提升为顶层依赖。拒绝的方案包括 Shell 指向 Core checkout、把 Slots 类型复制进 Shell、以及依赖 npm registry。随后运行：

```bash
pnpm run verify-translation-pairing --write .agents/notes/implemented/architecture/2026-08-28-desktop-runtime-client-extension-contracts.md
```

- [ ] **Step 4: 运行聚焦测试**

Run: `pnpm exec vitest run scripts/desktop-runtime-artifact.spec.ts scripts/verify-runtime-closure.spec.ts`

Expected: PASS；缺失 UI Slots manifest 或 types 时均明确失败。

- [ ] **Step 5: 提交 Runtime 闭包变更**

```bash
git add runtime/desktop/package.json pnpm-lock.yaml scripts/desktop-runtime-artifact.ts scripts/desktop-runtime-artifact.spec.ts .agents/notes/implemented/architecture/2026-08-28-desktop-runtime-client-extension-contracts.md .agents/notes/implemented/architecture/2026-08-28-desktop-runtime-client-extension-contracts.zh.md .agents/notes/implemented/architecture/2026-08-28-desktop-runtime-client-extension-contracts.i18n.yaml
git commit -m "build(runtime): include client slot contracts"
```

### Task 3: Core 契约文档、Agent Note 与本地制品

**Files:**
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/README.md`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/README.zh.md`
- Modify: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/README.i18n.yaml`
- Create: `/Users/boxser.shi/Documents/harness/insight-harness-core/.agents/notes/implemented/architecture/2026-08-28-settings-dialog-controller.md`
- Create: `/Users/boxser.shi/Documents/harness/insight-harness-core/.agents/notes/implemented/architecture/2026-08-28-settings-dialog-controller.zh.md`
- Create: `/Users/boxser.shi/Documents/harness/insight-harness-core/.agents/notes/implemented/architecture/2026-08-28-settings-dialog-controller.i18n.yaml`

**Interfaces:**
- Consumes: Task 1 的 `ctx.settingsDialog`。
- Produces: Core 当前行为的双语权威说明，以及供 Shell 本地覆盖验证的 `ui-settings-general/lib`。

- [ ] **Step 1: 更新包 README**

英文和中文 README 必须说明：`ui-settings-general` 提供 `ctx.settingsDialog`；`open(sectionId?)` 打开同一设置 Shell；未知或缺失 section 由现有首项回退处理；Shell 未挂载时调用失败；该服务不管理设置数据。不要加入因赛AI或 Electron 内容。

- [ ] **Step 2: 写 implemented Agent Note**

两种语言使用相同结构：

```markdown
# Agent Note: Settings dialog controller

Status: implemented

## Problem
## Decision
## Lifecycle
## Alternatives considered
## Consequences
```

`Alternatives considered` 记录并拒绝 DOM 模拟点击、把弹窗状态移到 `ui-settings` 基础包、让每个插件创建独立设置弹窗。`Consequences` 记录 `open()` 只在设置 Shell 挂载时有效，以及服务只控制呈现而不读写设置。

- [ ] **Step 3: 重录双语一致性记录**

Run:

```bash
pnpm run verify-translation-pairing --write packages/client/ui-settings-general/README.md
pnpm run verify-translation-pairing --write .agents/notes/implemented/architecture/2026-08-28-settings-dialog-controller.md
```

Expected: 两个 `.i18n.yaml` 记录当前英文与中文 blob hash。

- [ ] **Step 4: 运行 Core 检查**

Run:

```bash
pnpm exec vitest run packages/client/ui-settings-general/tests/settings-dialog.client.spec.ts packages/client/ui-settings-general/tests/settings-root.client.spec.tsx packages/client/ui-settings-general/tests/shell.client.spec.ts
pnpm run typecheck
pnpm run lint
pnpm run doc-sync
pnpm run build
git diff --check
```

Expected: 全部 PASS；`packages/client/ui-settings-general/lib/client.js` 和 `lib/types/client/index.d.ts` 包含设置控制能力。

- [ ] **Step 5: 提交 Core 变更**

```bash
git add packages/client/ui-settings-general/src/client/settings-dialog.ts packages/client/ui-settings-general/src/client/shell-contract.ts packages/client/ui-settings-general/src/client/SettingsRoot.tsx packages/client/ui-settings-general/src/client/index.ts packages/client/ui-settings-general/tests/settings-dialog.client.spec.ts packages/client/ui-settings-general/tests/settings-root.client.spec.tsx packages/client/ui-settings-general/tests/shell.client.spec.ts packages/client/ui-settings-general/README.md packages/client/ui-settings-general/README.zh.md packages/client/ui-settings-general/README.i18n.yaml .agents/notes/implemented/architecture/2026-08-28-settings-dialog-controller.md .agents/notes/implemented/architecture/2026-08-28-settings-dialog-controller.zh.md .agents/notes/implemented/architecture/2026-08-28-settings-dialog-controller.i18n.yaml
git commit -m "feat(client): expose settings dialog control"
```

### Task 4: 本地跨仓验证后发布 Runtime

**Files:**
- Read-only input: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/lib`
- Read-only input: `/Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-slots/lib`
- Disposable local target: `/Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib`
- Disposable local target: `/Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-slots`
- Later update in Shell plan: `/Users/boxser.shi/Documents/harness/insight-desktop-shell/core-runtime.lock.json`

**Interfaces:**
- Produces before release: 一个只覆盖 `ui-settings-general/lib` 的本地 Runtime 验证层。
- Produces after人工验收: `insight-runtime-v0.1.1-rc.10` 三平台不可变制品。

- [ ] **Step 1: 等待 Shell 本地 Runtime 准备完成**

先在 Shell 执行 `npm run prepare:core-runtime`。随后覆盖设置包构建输出，并把缺席于 rc.9 的 UI Slots 发布目录复制进一次性 Runtime：

```bash
cp -R /Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-settings-general/lib/. /Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/
cp -R /Users/boxser.shi/Documents/harness/insight-harness-core/packages/client/ui-slots /Users/boxser.shi/Documents/harness/insight-desktop-shell/build/core-runtime/node_modules/@deepseek-ai/dsh-client-ui-slots
```

Expected: `build/core-runtime/runtime.json` 仍记录 rc.9；本地目录是一次性验证副本，不能据此更新 `core-runtime.lock.json` 或制作正式安装包。

- [ ] **Step 2: 完成 Shell 本地 DEV 人工门禁**

执行关联计划 [登录后单侧栏集成](2026-08-28-authenticated-single-sidebar.md) 的 Task 1–7。必须人工确认登录、单侧栏、两个设置入口、退出、重启恢复和 Better Sidebar；任一失败都回到本地修复，不创建 tag。

- [ ] **Step 3: 执行 Core pre-push 门禁**

按仓库 `dsh-pre-push-checks` skill 读取当前 diff 并执行它选择的最小必要检查；确认工作树只含已计划内容、分支已同步、`git diff --check` 通过。不要因为准备 push 而重复已经通过且未受后续修改影响的检查。

- [ ] **Step 4: 推送已验证的 Core commit 并创建 tag**

人工门禁通过后执行：

```bash
git push origin main
git tag insight-runtime-v0.1.1-rc.10
git push origin insight-runtime-v0.1.1-rc.10
gh workflow run runtime-release.yml --ref insight-runtime-v0.1.1-rc.10 -f tag=insight-runtime-v0.1.1-rc.10 -f prerelease=true
```

- [ ] **Step 5: 验证 Release 完整性**

Run: `gh release view insight-runtime-v0.1.1-rc.10 --json tagName,isPrerelease,assets`

Expected: tag 正确、`isPrerelease=true`，并存在 `darwin-arm64`、`darwin-x64`、`win32-x64` 各自的 `.tar.gz`、`.tar.gz.json`、`.tar.gz.sha256`，共 9 个资产。失败时只处理失败平台，不进入 Shell 锁更新。

**Acceptance:** Core 提供产品无关的设置弹窗控制服务，现有设置 UI 行为不变；Desktop Runtime 自包含仓外 UI 插件所需的 Slots 类型；服务与制品通过生命周期、HMR、类型、文档和构建检查，并且 Runtime 只在本地 Shell 人工验收后发布。
