# Desktop Model Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户通过当前 Shell 登录后，无需填写模型 API Key 即可使用自有 Gateway 会话。

**Architecture:** Shell 是唯一登录/刷新所有者。现有 desktop-integration 的 Host 注册 yinsai-gateway Provider，使用父子进程 IPC 按需获取当前账号 access token，原生 DeepSeekAdapter 处理对话和 SSE。只在当前 Harness 实例有效且账号匹配时返回凭证。

**Tech Stack:** Electron UtilityProcess、Node IPC、TypeScript、Cordis、DeepSeekAdapter、Vitest。

## Global Constraints

- 工作分支 codex/enterprise-gateway-analysis；不修改 STS 主工作树。
- 1.0 登录和模型均使用测试环境；模型固定为 deepseek-v4-flash-vision-exp。
- Gateway 为 https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1。
- 不复制 refresh token，不向 renderer、文件、环境变量或日志输出凭证。
- 不迁入画布、企业技能、记忆和管理界面；保留插件市场与 Agent 模式。
- 保持锁定 Runtime；恢复/退出/切换账号后旧请求不得返回新账号凭证。
- 执行辅助 skill 本机不可用；按用户已同意范围在当前任务内执行，不另行派生任务。

### Task 1: Shell 单一凭证所有者

**Files:** `src/main/auth/auth-session-manager.ts`、`auth-environment.ts`、`test/auth-session-manager.test.ts`、`test/auth-environment.test.ts`。

**Interfaces:** `getModelAccessToken(accountId: string): Promise<string>`；并发校验共享同一 Promise，API 校验过期后只刷新一次。网络错误保留登录；确认为 expired 则清会话。异步完成前检查会话 revision。

- [x] 编写测试：`await expect(manager.getModelAccessToken('42')).resolves.toBe('fresh-token')`；覆盖并发、离线、撤销、退出期间刷新、账号不匹配。
- [x] 运行 `npm test -- test/auth-session-manager.test.ts test/auth-environment.test.ts`，观察新增方法缺失导致失败。
- [x] 增加 Main 内 token 状态和会话 revision；在每轮模型请求前调用现有 currentUser/refresh，保留 Cookie 刷新契约；测试环境配置固定。
- [x] 同一命令验证通过。

### Task 2: 父子进程凭证通道

**Files:** 新建 `src/main/runtime/model-credential-bridge.ts`，修改 `harness-runtime.ts`、`disclaimed-utility-process.ts`、`src/main/index.ts`；新建 `test/model-credential-bridge.test.ts`。

**Interfaces:** Host 发送 `{type:'insight:model-token:request',id}`，Main 返回 `{type:'insight:model-token:response',id,token}` 或固定错误码。`bindModelCredentialBridge(child, resolveToken, isCurrent)` 监听消息并返回清理函数。

- [x] 编写测试：正常返回、非法消息不触发凭证获取、过期实例不返回 token、固定错误码不反射 Secret、IPC 关闭不抛未处理异常。
- [x] 运行 `npm test -- test/model-credential-bridge.test.ts`，先失败。
- [x] Node spawn 使用 IPC stdio，macOS UtilityProcess 转发 message/postMessage；Runtime 绑定具体 child 和 dshHome，退出时失效。
- [x] Main 用当前账号路径验证 dshHome，然后调用 Task 1 方法；运行通道和 Runtime 聚焦测试。

### Task 3: Host Provider 和产品入口

**Files:** `packages/insight-desktop-integration/src/index.ts`、新增 `model-credential-client.ts` 与 `model-gateway.ts`，修改 `cordis.patch.yml`、`tsconfig.json`、`scripts/build-desktop-integration.mjs`；新增相关测试。

**Interfaces:** `createModelCredentialClient(transport)` 提供 `getToken()` 和 `dispose()`；`apply(ctx)` 注册固定 Provider。原生 Adapter 的 `resolveApiKey` 使用 IPC 获取 token；无通道时明确报登录错误。

- [x] 编写凭证请求成功、超时、退出清理、错误脱敏测试；用真实锁定 Adapter + mock HTTP 响应验证固定路径/Bearer/SSE/工具参数。
- [x] 运行新测试，先失败。
- [x] 扩展现有第一方 Host，无新增业务包；构建时 external 保留 Core 依赖。Profile 配置默认 Provider/model 并关闭出厂直连和密钥设置页。
- [x] 运行 `npm run build:desktop-integration`，验证最终 Profile 能解析 Host 依赖；沿用现有安装方包刷新机制，未增加迁移逻辑。

### Task 4: 集成检查与交接

- [x] 运行 `npm run typecheck`、`npm test`、`npm run build:prepared`，检查正常与安全模式下的模型入口边界。正常 Profile 完整启动验证通过；安全模式仅作诊断恢复，不加载本插件。
- [x] 记录测试证据、环境变化和真实账号验收步骤到发布文档；代码提交留在本工作分支。
- [ ] 真实登录后首条回复、工具调用、取消、重启恢复、退出/切换账号和断网恢复；必须真实账号及授权会话可用后执行，不把自动化替身当线上通过。

## 本地完成记录

2026-09-09：89 文件 / 559 测试通过，类型检查、生产构建、Profile 刷新和打包 Runtime 冒烟通过；另覆盖真实 Node IPC 与 macOS Electron utilityProcess，HTTP 使用测试替身，无真实模型费用。完整证据及正式发布前未完成项见 [接入与验收](../../model-gateway-integration.md)。未合入 `main`，未推送或发布。
