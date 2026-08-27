# 因赛AI桌面登录基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Shell 内实现现有手机号账号 API 的验证码登录、密码登录、重启恢复、退出和账号隔离工作区，并确保未认证或断网时不启动 Harness。

**Architecture:** Shell Renderer 负责登录和用户界面；Electron Main 中的 `AuthSessionManager` 独占账号 API、Cookie、加密令牌和会话状态。认证成功后，Main 使用账号范围的 `dshHome` 启动 Core Runtime，并把 Harness 作为独立 `WebContentsView` 附着到 Shell。

**Tech Stack:** Electron 43、electron-vite 5、React 18、TypeScript 5.9、Vitest 4、Electron `session`/`safeStorage`/`WebContentsView`、锁定的 Insight Core Runtime。

## Global Constraints

- 不复制、引用、嵌入或构建 `/Users/boxser.shi/Documents/inside/insight-web-platform`；只使用已经确认的 API 行为。
- 首版只实现验证码登录、密码登录、会话恢复、用户摘要、设置和退出；不显示注册、忘记密码或邀请码。
- 未打包运行与 `dshDesktopChannel: development` 使用 `https://gapi-test.insight-aigc.com`；正式包使用 `https://gapi.insight-aigc.com`。
- Renderer、Harness、Core Runtime 和插件不得读取访问令牌、Cookie 或完整用户 ID。
- 密码、短信验证码、图形验证码、访问令牌和 Cookie 不得写入日志。
- 未认证、网络不可用或会话失效时不得启动或显示 Harness。
- 账号目录按环境和用户 ID 的哈希隔离；旧 `insight/harness` 不自动迁移。
- 首版沿用 Harness 当前深浅主题，不建立 Design Tokens，不修改 upstream DOM。
- 每个可运行切片先执行聚焦测试；完成后依次执行 `npm test`、`npm run typecheck`、`npm run build` 和本地人工验证。

---

### Task 1: 冻结认证契约、环境与 API 客户端

**Files:**
- Create: `src/shared/auth-contracts.ts`
- Create: `src/main/auth/auth-environment.ts`
- Create: `src/main/auth/auth-api-client.ts`
- Test: `test/auth-environment.test.ts`
- Test: `test/auth-api-client.test.ts`

**Interfaces:**
- Produces: `AuthEnvironment`, `SessionView`, `AccountSummary`, `SmsLoginInput`, `PasswordLoginInput`, `AuthCommandResult`。
- Produces: `resolveAuthEnvironment(input): AuthEnvironmentConfig`。
- Produces: `AuthApiClient` 的 `sendSmsCode`、`captcha`、`loginSms`、`loginPassword`、`refresh`、`currentUser` 和 `logout`。

- [ ] **Step 1: 写环境和 API 解析失败测试**

```ts
it('uses test for source and development builds and production otherwise', () => {
  expect(resolveAuthEnvironment({ packaged: false })).toMatchObject({ name: 'test' })
  expect(resolveAuthEnvironment({ packaged: true, channel: 'development' })).toMatchObject({ name: 'test' })
  expect(resolveAuthEnvironment({ packaged: true })).toMatchObject({ name: 'production' })
})

it('never returns an access token in the account projection', async () => {
  const client = new AuthApiClient(fakeFetch(response({
    code: 'SUCCESS',
    data: { id: 42, userName: 'Alice', avatarUrl: 'https://assets.example/a.png', phoneNo: '13800138000' }
  })), config, () => 'secret')
  await expect(client.currentUser()).resolves.toEqual({
    id: '42',
    summary: { displayName: 'Alice', avatarUrl: 'https://assets.example/a.png', maskedPhone: '138****8000' }
  })
})
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run: `npx vitest run test/auth-environment.test.ts test/auth-api-client.test.ts`

Expected: FAIL，因为认证模块尚不存在。

- [ ] **Step 3: 定义共享契约**

```ts
export type AuthEnvironment = 'test' | 'production'

export interface AccountSummary {
  displayName: string
  avatarUrl?: string
  maskedPhone: string
}

export type SessionView =
  | { kind: 'restoring' }
  | { kind: 'unauthenticated' }
  | { kind: 'authenticating'; method: 'sms' | 'password' }
  | { kind: 'authenticated'; account: AccountSummary }
  | { kind: 'offline' }
  | { kind: 'expired' }

export interface SmsLoginInput {
  phone: string
  code: string
}

export interface PasswordLoginInput {
  phone: string
  password: string
  uuid: string
  imageCode: string
}

export type AuthCommandResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-input' | 'rejected' | 'offline' | 'service-error'; message: string }
```

- [ ] **Step 4: 实现构建通道映射**

```ts
export function resolveAuthEnvironment(input: {
  packaged: boolean
  channel?: unknown
}): AuthEnvironmentConfig {
  const development = !input.packaged || input.channel === 'development'
  return development
    ? { name: 'test', baseUrl: 'https://gapi-test.insight-aigc.com', partition: 'persist:insight-auth-test' }
    : { name: 'production', baseUrl: 'https://gapi.insight-aigc.com', partition: 'persist:insight-auth-production' }
}
```

- [ ] **Step 5: 实现窄 API 客户端**

使用注入的 `fetch(input, init)`；所有请求设置 `credentials: 'include'`、JSON Content-Type、`accept-language`，登录相关请求增加 `extinfo: JSON.stringify({ client_type: 'PC' })`。已保存令牌仅由 `getAccessToken()` 注入 `token` 请求头。响应载荷兼容现有服务使用的 `data` 和 `body` 字段。只接受 `SUCCESS`、`200` 或 `0` 为成功；将 `USER_SESSION_EXPIRED`、`USER_NOT_LOGIN` 和 `-1` 分类为 `expired`，网络 `TypeError`/超时分类为 `offline`，其余响应保留安全的 `code` 和 `msg`。

- [ ] **Step 6: 验证 API 输入和脱敏规则**

```ts
expect(maskPhone('13800138000')).toBe('138****8000')
expect(buildPasswordPayload(input)).toEqual({
  type: 'PHONE_PASS',
  info: { phoneNo: input.phone, password: input.password, uuid: input.uuid, imgCode: input.imageCode }
})
expect(buildSmsPayload({ phone: '13800138000', code: '123456' })).toEqual({
  type: 'PHONE_NUM',
  info: { phoneNo: '13800138000', code: '123456' }
})
```

- [ ] **Step 7: 运行测试并提交**

Run: `npx vitest run test/auth-environment.test.ts test/auth-api-client.test.ts`

Expected: PASS。

```bash
git add src/shared/auth-contracts.ts src/main/auth/auth-environment.ts src/main/auth/auth-api-client.ts test/auth-environment.test.ts test/auth-api-client.test.ts
git commit -m "feat: add desktop auth API boundary"
```

### Task 2: 加密凭证与会话状态机

**Files:**
- Create: `src/main/auth/credential-store.ts`
- Create: `src/main/auth/auth-session-manager.ts`
- Test: `test/credential-store.test.ts`
- Test: `test/auth-session-manager.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `AuthApiClient`、`AuthEnvironmentConfig` 和共享契约。
- Produces: `CredentialStore.load/save/clear`。
- Produces: `AuthSessionManager.current/activeAccount/subscribe/restore/retry/sendSmsCode/loadCaptcha/loginSms/loginPassword/signOut`；`activeAccount()` 只供 Main 工作区协调器调用。
- Produces: Main 内部的 `AuthenticatedAccount { id: string; summary: AccountSummary }`，不得通过 IPC 返回 `id`。

- [ ] **Step 1: 写凭证持久化失败测试**

```ts
it('never writes a plaintext token', async () => {
  await store.save('access-secret')
  const raw = await readFile(path, 'utf8')
  expect(raw).not.toContain('access-secret')
  await expect(store.load()).resolves.toBe('access-secret')
})

it('refuses persistence when encryption is unavailable', async () => {
  await expect(unavailableStore.save('secret')).rejects.toThrow('secure storage')
})
```

- [ ] **Step 2: 写恢复、刷新与断网状态测试**

```ts
it('refreshes once before accepting an expired stored token', async () => {
  api.currentUser.mockRejectedValueOnce(expired()).mockResolvedValue(account)
  api.refresh.mockResolvedValue({ accessToken: 'new-token' })
  await manager.restore()
  expect(api.refresh).toHaveBeenCalledTimes(1)
  expect(manager.current()).toEqual({ kind: 'authenticated', account: account.summary })
})

it('keeps credentials and reports offline without starting a workspace', async () => {
  api.currentUser.mockRejectedValue(offline())
  await manager.restore()
  expect(store.clear).not.toHaveBeenCalled()
  expect(manager.current()).toEqual({ kind: 'offline' })
})
```

- [ ] **Step 3: 运行聚焦测试并确认失败**

Run: `npx vitest run test/credential-store.test.ts test/auth-session-manager.test.ts`

Expected: FAIL，因为存储与状态机尚不存在。

- [ ] **Step 4: 实现可测试的安全存储适配器**

```ts
export interface CredentialCipher {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export class CredentialStore {
  constructor(private readonly filePath: string, private readonly cipher: CredentialCipher) {}
  load(): Promise<string | undefined>
  save(token: string): Promise<void>
  clear(): Promise<void>
}
```

写入使用同目录临时文件后 rename；文件仅保存 Base64 密文和格式版本。JSON 损坏或解密失败时清除损坏文件并返回 `undefined`，不得回退为明文。

- [ ] **Step 5: 实现单写入者状态机**

`restore()` 先发布 `restoring`。无令牌时发布 `unauthenticated`；有令牌时调用 `currentUser()`；只有明确过期才调用一次 `refresh()` 并重试用户信息。所有并发 `restore/retry` 复用同一个 Promise。登录成功后保存令牌、读取用户信息并先写入 Main 内部 `AuthenticatedAccount`，再发布不含 ID 的认证状态。`activeAccount()` 返回该 Main 内部值；`signOut()` 尽力调用远端退出，但无论结果都清凭证、清内部账号并发布 `unauthenticated`。

- [ ] **Step 6: 验证状态通知顺序与凭证投影**

```ts
expect(events).toEqual([
  { kind: 'restoring' },
  { kind: 'authenticating', method: 'sms' },
  { kind: 'authenticated', account: account.summary }
])
expect(JSON.stringify(manager.current())).not.toContain('token')
expect(JSON.stringify(manager.current())).not.toContain(account.id)
```

- [ ] **Step 7: 运行测试并提交**

Run: `npx vitest run test/credential-store.test.ts test/auth-session-manager.test.ts`

Expected: PASS。

```bash
git add src/main/auth/credential-store.ts src/main/auth/auth-session-manager.ts test/credential-store.test.ts test/auth-session-manager.test.ts
git commit -m "feat: persist and restore desktop sessions"
```

### Task 3: 账号范围与 Runtime 门禁

**Files:**
- Create: `src/main/state/account-scope.ts`
- Create: `src/main/workspace/workspace-lifecycle.ts`
- Test: `test/account-scope.test.ts`
- Test: `test/workspace-lifecycle.test.ts`

**Interfaces:**
- Consumes: `AuthEnvironment` 与 Main 内部 `AuthenticatedAccount.id`。
- Produces: `accountScopeKey(environment, userId)` 和 `accountPaths(insightRoot, scope)`。
- Produces: `WorkspaceLifecycle.apply(session, account?)`，认证时启动当前账号工作区，其他状态停止工作区。

- [ ] **Step 1: 写账号路径和门禁失败测试**

```ts
it('derives stable, environment-specific paths without exposing the user id', () => {
  const testKey = accountScopeKey('test', '12345')
  const productionKey = accountScopeKey('production', '12345')
  expect(testKey).not.toBe(productionKey)
  expect(testKey).not.toContain('12345')
  expect(accountPaths('/data/insight', testKey).harness).toBe(`/data/insight/accounts/${testKey}/harness`)
})

it('never starts a workspace for restoring, offline or expired states', async () => {
  for (const state of [{ kind: 'restoring' }, { kind: 'offline' }, { kind: 'expired' }] as const) {
    await lifecycle.apply(state)
  }
  expect(driver.start).not.toHaveBeenCalled()
  expect(driver.stop).toHaveBeenCalledTimes(3)
})
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run: `npx vitest run test/account-scope.test.ts test/workspace-lifecycle.test.ts`

Expected: FAIL，因为账号范围与门禁尚不存在。

- [ ] **Step 3: 实现账号范围**

```ts
export function accountScopeKey(environment: AuthEnvironment, userId: string): string {
  return createHash('sha256').update(`insight-account-v1\0${environment}\0${userId}`).digest('hex').slice(0, 32)
}
```

`accountPaths` 返回 `root`、`shell`、`harness` 和 `cache`。不得读取或迁移旧 `insight/harness`。创建目录前验证 scope 只包含 32 个小写十六进制字符。

- [ ] **Step 4: 实现幂等工作区门禁**

```ts
export interface WorkspaceDriver {
  start(account: { scope: string; dshHome: string }): Promise<void>
  stop(): Promise<void>
}
```

相同账号重复发布 `authenticated` 不重启；账号变化时先 `stop()` 再启动新目录；任何非认证状态都先停止。并发状态变化串行执行，旧启动完成后若状态已变化则立即停止，不能重新显示旧账号 View。

- [ ] **Step 5: 运行测试并提交**

Run: `npx vitest run test/account-scope.test.ts test/workspace-lifecycle.test.ts`

Expected: PASS。

```bash
git add src/main/state/account-scope.ts src/main/workspace/workspace-lifecycle.ts test/account-scope.test.ts test/workspace-lifecycle.test.ts
git commit -m "feat: gate workspaces by account session"
```

### Task 4: Shell Renderer、登录表单与用户入口

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/auth-form-model.ts`
- Create: `src/renderer/src/styles.css`
- Create: `src/preload/shell.ts`
- Create: `tsconfig.web.json`
- Modify: `electron.vite.config.ts`
- Modify: `tsconfig.node.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/auth-form-model.test.ts`
- Test: `test/shell-preload-contract.test.ts`

**Interfaces:**
- Consumes: `SessionView` 和认证输入类型。
- Produces: `window.insightAuth.current/subscribe/retry/sendSmsCode/loadCaptcha/loginSms/loginPassword/signOut`。
- Produces: `window.insightWorkspace.setBounds(rect)` 和 `openAccountConfig()`；Renderer 不接收配置文件路径。

- [ ] **Step 1: 安装缺失的 React 类型并增加 Renderer 类型检查**

Run: `npm install --save-dev @types/react@18 @types/react-dom@18`

在 `tsconfig.web.json` 中启用 `jsx: react-jsx`、`lib: ["ES2022", "DOM", "DOM.Iterable"]`，包含 `src/renderer/**/*.ts`、`src/renderer/**/*.tsx` 和 `src/shared/**/*.ts`。把 `typecheck` 改为依次执行 node 与 web 两个 tsconfig。

- [ ] **Step 2: 写纯表单模型和 preload 表面失败测试**

```ts
expect(validatePhone('13800138000')).toBe(true)
expect(validatePhone('23800138000')).toBe(false)
expect(canSubmitSms({ phone: '13800138000', code: '123456', agreed: true })).toBe(true)
expect(canSubmitPassword({ phone: '13800138000', password: 'secret123', imageCode: 'abcd', uuid: 'u', agreed: true })).toBe(true)
```

preload 契约测试读取构建入口，断言 Shell preload 暴露认证方法但不包含 `token`、`cookie`、`credential` 或读取用户 ID 的方法。

- [ ] **Step 3: 运行聚焦测试并确认失败**

Run: `npx vitest run test/auth-form-model.test.ts test/shell-preload-contract.test.ts`

Expected: FAIL，因为 Renderer 和 Shell preload 尚不存在。

- [ ] **Step 4: 配置 electron-vite Renderer 与双 preload**

`electron.vite.config.ts` 增加 Renderer 输入 `src/renderer/index.html`；preload 输入包含 `shell`、`harness` 和现有 `windows-menu`。当前 `src/preload/index.ts` 的 Harness 页面逻辑在 Task 5 移动到 `src/preload/harness.ts`，Shell preload 只封装白名单 IPC。

- [ ] **Step 5: 实现全屏状态与登录表单**

`App` 首次调用 `current()` 并订阅状态。`restoring` 显示启动反馈；`offline` 显示网络提示和重试；`expired/unauthenticated` 显示登录；`authenticated` 显示工作区占位区域和左下角用户入口。验证码标签包含手机号、验证码、协议勾选与倒计时；密码标签包含手机号、密码、图形验证码、刷新按钮和协议勾选。注册、忘记密码和邀请码不得出现在 DOM。

- [ ] **Step 6: 沿用当前 Harness 主题实现最小 CSS**

使用 `prefers-color-scheme` 和 `color-scheme: light dark`，只定义当前页面需要的背景、表面、文字、边框和强调色。CSS 保留在 `src/renderer/src/styles.css`，不向 Harness View 注入样式。登录表单必须可用键盘提交，输入错误通过 `aria-live` 文本反馈。

- [ ] **Step 7: 实现用户菜单与工作区矩形上报**

认证状态显示头像、昵称，缺失头像使用内置 SVG，缺失昵称使用脱敏手机号。菜单只有“设置”和“退出”；设置打开 Shell 内最小面板，显示脱敏账号、应用版本和测试/生产环境，并提供“打开当前账号配置文件”按钮，由 Main 在文件管理器中定位账号 `settings.yaml`；退出调用 `signOut()`。使用 `ResizeObserver` 上报工作区占位元素的整数矩形，卸载或非认证状态上报 `null`。

- [ ] **Step 8: 验证并提交**

Run: `npx vitest run test/auth-form-model.test.ts test/shell-preload-contract.test.ts && npm run typecheck`

Expected: PASS。

```bash
git add package.json package-lock.json tsconfig.node.json tsconfig.web.json electron.vite.config.ts src/renderer src/preload/shell.ts test/auth-form-model.test.ts test/shell-preload-contract.test.ts
git commit -m "feat: add desktop login renderer"
```

### Task 5: Main IPC、持久 Cookie 与认证工作区 View

**Files:**
- Create: `src/main/auth/electron-auth.ts`
- Create: `src/main/auth/auth-ipc.ts`
- Create: `src/main/workspace/harness-workspace-view.ts`
- Create: `src/main/workspace/harness-workspace-controller.ts`
- Create: `src/preload/harness.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/security.ts`
- Modify: `src/main/security-policy.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/contracts.ts`
- Test: `test/auth-ipc.test.ts`
- Test: `test/harness-workspace-view.test.ts`
- Modify: `test/runtime.test.ts`
- Modify: `test/release.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 的 API、状态机、账号路径、工作区门禁和 Renderer IPC。
- Produces: 使用 `session.fromPartition(environment.partition)` 的 Electron 认证依赖。
- Produces: `HarnessWorkspaceController.start/stop/setBounds`。

- [ ] **Step 1: 写 IPC 来源、工作区 View 与 Runtime 门禁失败测试**

```ts
it('rejects auth commands outside the shell main frame', () => {
  expect(() => assertTrustedShellEvent(untrustedEvent)).toThrow('Shell main frame')
})

it('destroys the Harness view before stopping the runtime', async () => {
  await controller.stop()
  expect(order).toEqual(['hide-view', 'destroy-view', 'stop-runtime'])
})
```

更新 release 契约，断言 BrowserWindow 使用 `shell.cjs`，Harness View 使用 `harness.cjs`，并断言 `bootstrap()` 不再无条件调用 `launchHarness()`。

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run: `npx vitest run test/auth-ipc.test.ts test/harness-workspace-view.test.ts test/runtime.test.ts test/release.test.ts`

Expected: FAIL，因为 Main 尚未接入新的窗口结构。

- [ ] **Step 3: 建立 Electron 认证依赖**

从构建通道解析环境，使用 `session.fromPartition(config.partition)` 的 `fetch` 创建 `AuthApiClient`；使用 Electron `safeStorage` 创建 `CredentialCipher`；凭证文件放在 `insight/auth/<environment>.json`。认证 Session 只访问测试或生产 API，不与 Harness View 的 Session 共用 Cookie。

- [ ] **Step 4: 注册窄 IPC**

只接受 Shell 主窗口 main frame。验证手机号格式、验证码长度、密码非空、UUID 和图形验证码非空；拒绝额外字段。`auth:subscribe` 通过 `webContents.send('auth:changed', view)` 发布只读状态。窗口销毁时移除订阅。IPC 错误返回 `AuthCommandResult`，不把原始异常或响应体跨进程发送。`workspace:open-account-config` 只对认证状态生效，由 Main 使用当前账号范围解析路径并调用 `shell.showItemInFolder`，不向 Renderer 返回绝对路径。

- [ ] **Step 5: 拆分 Harness preload 并泛化安全装配**

把当前 `src/preload/index.ts` 的目录选择、插件恢复、安全模式和 Windows 页面适配移动到 `src/preload/harness.ts`。`src/preload/index.ts` 保留为兼容转发或删除其构建入口。将 `secureWindow` 的公共逻辑提取为接受 `WebContents` 的函数：Shell 只信任 electron-vite 的本地 Renderer URL；Harness 只信任回环 URL；外部 HTTPS 使用系统浏览器；两者都禁止 webview。

- [ ] **Step 6: 实现 Harness View**

`HarnessWorkspaceView` 使用 `WebContentsView`、`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true` 和 `harness.cjs`。`setBounds` 拒绝 NaN、Infinity、负宽高和超出窗口的值，并使用主窗口内容区裁剪。Harness ready 后只加载当前 Runtime 返回的回环 URL。

- [ ] **Step 7: 实现账号 Runtime Controller**

把 `launchHarness` 中与 `dshHome` 有关的初始化、store pin、修复、一致性检查和 Runtime 创建移动到 `HarnessWorkspaceController.start({ scope, dshHome })`。相同 scope 幂等；不同 scope 先完整停止。插件恢复、安全模式、导入和目录选择都通过 controller 取得当前账号 `dshHome`，禁止再使用固定 `insight/harness`。

- [ ] **Step 8: 改造 bootstrap**

`bootstrap()` 先创建 Shell 窗口、AuthSessionManager、IPC 和 WorkspaceLifecycle，再加载 Renderer 并调用 `restore()`。删除启动末尾的无条件 `launchHarness()`；只有 WorkspaceLifecycle 收到带 Main 内部账号 ID 的认证结果后才启动。`activate` 只恢复或显示 Shell 窗口，不绕过会话门禁启动 Runtime。

- [ ] **Step 9: 验证并提交**

Run: `npx vitest run test/auth-ipc.test.ts test/harness-workspace-view.test.ts test/runtime.test.ts test/release.test.ts && npm run typecheck`

Expected: PASS。

```bash
git add src/main/auth src/main/workspace src/main/security.ts src/main/security-policy.ts src/main/index.ts src/preload src/shared/contracts.ts test/auth-ipc.test.ts test/harness-workspace-view.test.ts test/runtime.test.ts test/release.test.ts
git commit -m "feat: gate Harness behind desktop authentication"
```

### Task 6: 端到端本地验收与发布回归

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/client-build-runbook.md`
- Create: `docs/auth-validation.md`
- Test: `test/readme-parity.test.ts`
- Test: `test/release.test.ts`

**Interfaces:**
- Consumes: 完整登录、恢复、账号工作区和 Renderer。
- Produces: 可重复的本地登录验收记录与打包准入条件。

- [ ] **Step 1: 更新当前架构与运行说明**

记录 Shell Renderer、Main 会话边界、测试/生产 API、账号目录和“未认证不启动 Runtime”。README 只写当前有效命令；详细手工步骤放入 `docs/auth-validation.md`。

- [ ] **Step 2: 运行完整自动检查**

Run: `npm test`

Expected: 所有测试通过。

Run: `npm run typecheck`

Expected: Main、preload、shared 和 Renderer 均无类型错误。

Run: `npm run build`

Expected: 生成 main、shell preload、Harness preload 和 Renderer 构建产物；Core Runtime manifest 与 bundled profile 准备成功。

- [ ] **Step 3: 开发模式人工验收第一检查点**

Run: `npm run dev`

验收：首次启动只显示全屏登录；验证码发送、密码图形验证码和两种登录成功；登录后出现用户入口并加载 Harness；Markdown/HTML 仍由 Better Sidebar 打开；退出后 Harness 立即消失且 Runtime 停止。此检查点未通过时不创建目录包。

- [ ] **Step 4: 重启、断网和双账号人工验收第二检查点**

验收：重启自动恢复；启动断网进入可重试状态且不清凭证；恢复网络后重试成功；账号 A 与账号 B 使用不同 Harness 目录，对话和产物互不可见；重新登录账号 A 能恢复 A 的数据。此检查点未通过时不构建 DMG。

- [ ] **Step 5: 本地目录包与 DMG 验收**

Run: `npm run package:dev:dir`

Expected: 目录包启动、登录、恢复、退出、Better Sidebar 和主题切换通过。

Run: `npm run package:dev:mac:arm64`

Expected: DMG 构建成功；按现有未签名包 Runbook 去除 quarantine 后重复关键路径。Windows GitHub Actions 只在本地两级检查点通过后触发。

- [ ] **Step 6: 提交文档与验收门禁**

```bash
git add README.md docs/architecture.md docs/client-build-runbook.md docs/auth-validation.md test/readme-parity.test.ts test/release.test.ts
git commit -m "docs: add desktop auth validation gate"
```

**Acceptance:** 本计划完成后，客户端能够使用测试环境真实账号登录、重启恢复、退出并按账号隔离 Harness；未登录和断网无法进入 Harness；现有 Core Runtime、Better Sidebar、插件恢复和本地打包能力不回归。
