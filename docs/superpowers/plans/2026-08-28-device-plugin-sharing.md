# 设备级插件共享 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在一台设备上导入一次本地插件后，所有账号都能使用同一设备插件目录，同时保持启用状态、配置、密钥、缓存和业务数据按账号隔离。

**Architecture:** Shell 把用户选择的目录或 `.tgz` 固化到设备级插件目录并维护版本化 registry。账号工作区启动前把设备目录同步到当前账号 Profile；Profile 仍拥有配置与数据，设备 registry 只拥有插件代码来源和版本。

**Tech Stack:** Node.js `fs/promises`、JSON 原子写入、现有 `dsh plugin --profile web add/remove`、Vitest、Task 1 登录计划产生的账号范围与 Workspace Controller。

## Global Constraints

- 本计划在 `2026-08-28-desktop-auth-foundation.md` 完成并通过双账号验收后执行。
- 插件包属于设备；插件配置、密钥、启用状态、缓存、对话和产物属于账号。
- 设备插件目录不得保存账号令牌、Cookie 或业务资产。
- Better Sidebar 继续来自 bundled profile，不进入用户插件 registry。
- 导入目录时排除 `.git`、`node_modules`、`.DS_Store` 和 `__MACOSX`，保留插件自身的构建产物。
- registry 和包目录更新必须原子化；失败不得破坏已可启动的账号 Profile。
- 不实现插件市场、远端更新、自动升级或跨设备同步。

---

### Task 1: 设备插件目录与原子导入

**Files:**
- Create: `src/main/plugins/device-plugin-catalog.ts`
- Create: `src/main/plugins/device-plugin-paths.ts`
- Modify: `src/main/state/local-plugin-import.ts`
- Test: `test/device-plugin-catalog.test.ts`
- Modify: `test/local-plugin-import.test.ts`

**Interfaces:**
- Produces: `DevicePluginRecord { id; name; version; kind; relativePath; importedAt }`。
- Produces: `DevicePluginCatalog.import(source)`、`list()`、`remove(id)` 和 `resolvePackage(record)`。

- [ ] **Step 1: 写目录与归档导入失败测试**

```ts
it('copies one directory package into the device catalog without node_modules', async () => {
  const record = await catalog.import({ path: source, kind: 'directory' })
  expect(record).toMatchObject({ name: 'example-plugin', version: '1.2.3', kind: 'directory' })
  await expect(stat(join(catalog.resolvePackage(record), 'dist', 'index.js'))).resolves.toBeDefined()
  await expect(stat(join(catalog.resolvePackage(record), 'node_modules'))).rejects.toThrow()
})

it('leaves the previous registry intact when a copy fails', async () => {
  await expect(failingCatalog.import(source)).rejects.toThrow()
  await expect(catalog.list()).resolves.toEqual([existing])
})
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run: `npx vitest run test/device-plugin-catalog.test.ts test/local-plugin-import.test.ts`

Expected: FAIL，因为设备目录尚不存在。

- [ ] **Step 3: 扩展本地包验证结果**

`resolveLocalPluginImport` 必须读取 `package.json` 并返回标准化的 `name` 和 `version`；缺少名称或版本时拒绝导入。`.tgz` 使用现有 DSH/pnpm 可接受的归档路径，但 registry 中的 ID 不使用未经清理的包名作为目录路径。

```ts
export interface LocalPluginImport {
  path: string
  kind: 'directory' | 'archive'
  name: string
  version: string
}
```

- [ ] **Step 4: 实现设备目录和原子 registry**

设备根目录为 `<userData>/insight/plugins`，包含 `packages/`、`staging/` 和 `registry.json`。插件 ID 使用 `sha256(name + "\0" + version + "\0" + import nonce)` 的前 24 位。先复制到 `staging/<id>`，验证目标包含 package manifest，再 rename 到 `packages/<id>`；最后通过临时文件和 rename 更新 `registry.json`。同名同版本再次导入替换 registry 指向的新记录，不就地覆盖旧目录。

- [ ] **Step 5: 清理失败 staging 和失去引用的包**

启动时删除 `staging` 中未完成目录；只删除 registry 不再引用且不处于本次导入事务中的包。路径解析必须确认结果仍位于 `packages` 根目录下。

- [ ] **Step 6: 运行测试并提交**

Run: `npx vitest run test/device-plugin-catalog.test.ts test/local-plugin-import.test.ts`

Expected: PASS。

```bash
git add src/main/plugins/device-plugin-catalog.ts src/main/plugins/device-plugin-paths.ts src/main/state/local-plugin-import.ts test/device-plugin-catalog.test.ts test/local-plugin-import.test.ts
git commit -m "feat: add device plugin catalog"
```

### Task 2: 将设备插件同步到账号 Profile

**Files:**
- Create: `src/main/plugins/account-plugin-state.ts`
- Create: `src/main/plugins/sync-device-plugins.ts`
- Modify: `src/main/workspace/harness-workspace-controller.ts`
- Test: `test/account-plugin-state.test.ts`
- Test: `test/sync-device-plugins.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `DevicePluginCatalog`、登录计划的当前账号 `dshHome` 和现有 `addProfilePluginWithDsh/removeProfilePluginWithDsh`。
- Produces: `AccountPluginState { installed: Record<devicePluginId, version>; disabled: string[] }`。
- Produces: `syncDevicePlugins(options): Promise<SyncResult>`。

- [ ] **Step 1: 写多账号同步和禁用失败测试**

```ts
it('installs the same device package into two independent account profiles', async () => {
  await syncDevicePlugins(optionsFor(accountA))
  await syncDevicePlugins(optionsFor(accountB))
  expect(add).toHaveBeenNthCalledWith(1, expect.objectContaining({ dshHome: accountA }), packagePath)
  expect(add).toHaveBeenNthCalledWith(2, expect.objectContaining({ dshHome: accountB }), packagePath)
})

it('does not reinstall a plugin disabled for this account', async () => {
  state.disabled = [record.id]
  await syncDevicePlugins(options)
  expect(add).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run: `npx vitest run test/account-plugin-state.test.ts test/sync-device-plugins.test.ts`

Expected: FAIL，因为账号插件状态和尚未同步。

- [ ] **Step 3: 实现账号插件状态**

状态文件位于 `<account>/shell/device-plugins.json`，只保存设备插件 ID、已安装版本和当前账号禁用列表，不保存包绝对路径。读到损坏 JSON 时保留损坏副本并返回空状态；写入使用临时文件和 rename。

- [ ] **Step 4: 实现启动前同步**

读取 registry 和账号状态，对未禁用且版本未同步的记录依次调用 `addProfilePluginWithDsh`。单个插件失败时记录插件名称和安全错误摘要，停止本次启动并进入现有插件恢复流程；不得继续启动一个半同步 Profile。所有安装完成后才写入新账号状态。

- [ ] **Step 5: 接入 Workspace Controller**

账号 bundled profile 初始化和修复完成后、Runtime `start()` 前调用同步。Better Sidebar 不在 registry 中，因此仍由 bundled profile 初始化。相同账号的无变化启动不调用 DSH 安装命令。

- [ ] **Step 6: 运行测试并提交**

Run: `npx vitest run test/account-plugin-state.test.ts test/sync-device-plugins.test.ts test/profile-plugin-command.test.ts`

Expected: PASS。

```bash
git add src/main/plugins/account-plugin-state.ts src/main/plugins/sync-device-plugins.ts src/main/workspace/harness-workspace-controller.ts test/account-plugin-state.test.ts test/sync-device-plugins.test.ts
git commit -m "feat: sync device plugins into account profiles"
```

### Task 3: 导入、恢复与双账号验收

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/safe-mode.ts`
- Modify: `src/main/state/plugin-recovery.ts`
- Modify: `test/release.test.ts`
- Modify: `test/safe-mode.test.ts`
- Create: `docs/device-plugin-sharing.md`

**Interfaces:**
- Consumes: `DevicePluginCatalog`、账号插件状态和 Workspace Controller。
- Produces: 导入一次、当前账号立即安装、其他账号下次启动同步的完整用户路径。

- [ ] **Step 1: 更新导入契约测试**

release 测试断言导入流程先调用 `catalog.import(plugin)`，再由 Workspace Controller 同步当前账号；不得再把用户选择的临时路径直接保存到账号 Profile。安全模式测试断言“仅对当前账号禁用”和“从设备移除”是两个明确动作。

- [ ] **Step 2: 接入设备导入流程**

用户选择目录或 `.tgz` 后，先固化到设备 catalog，再停止当前 Runtime、同步当前账号并重启。导入失败保留上一个 registry 和可启动 Profile。导入成功后提示“已添加到此设备，并为当前账号启用”。

- [ ] **Step 3: 接入恢复动作**

安全模式的普通“禁用”只把插件 ID 写入当前账号 disabled 列表并从当前 Profile 移除；“从此设备移除”删除 registry 记录，并在各账号下次启动时移除由该设备记录管理的插件。不得删除用户手工写入 Profile 且不受 registry 管理的依赖。

- [ ] **Step 4: 运行自动检查**

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS；release 契约仍确认不存在插件市场，Better Sidebar 仍由 bundled profile 提供。

- [ ] **Step 5: 双账号人工验收**

账号 A 导入一个本地插件并验证可用；退出并登录账号 B，确认无需重新选择文件即可看到和启用该插件；在 B 中修改插件配置，重新登录 A 后确认 A 的配置未变化；在 A 中禁用插件不影响 B；从设备移除后两个账号在各自下次启动完成清理。

- [ ] **Step 6: 提交集成与文档**

```bash
git add src/main/index.ts src/main/safe-mode.ts src/main/state/plugin-recovery.ts test/release.test.ts test/safe-mode.test.ts docs/device-plugin-sharing.md
git commit -m "feat: share imported plugins across device accounts"
```

**Acceptance:** 一个插件只需在设备上导入一次；不同账号可以独立启用和配置；插件代码共享不会导致凭证、对话、配置或业务资产跨账号复用。
