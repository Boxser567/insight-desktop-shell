# 客户端联网搜索设计

## 目标

在当前 Electron Shell + 锁定 Core Runtime 架构中，为登录用户启用 DSH 原生联网搜索。搜索请求由 Core 的 `ctx.web` 发起，经第一方 Host 集成插件路由到企业 LLM Gateway，并使用 Shell 现有的短期用户 Token；renderer 不接触 Token，用户不需要配置搜索 API Key。

## 架构与数据流

```text
DSH agent / ctx.web.search
  -> @insight-ai/desktop-integration 注册的 DeepSeekSearchProvider
  -> 现有 model credential IPC 请求短期用户 Token
  -> desktopServiceEnvironment().modelBaseUrl + /messages
  -> 企业 Gateway（Authorization: Bearer 用户 Token）
  -> web_search_tool_result + citations
  -> DSH WebRuntime 标准化 sources
```

当前 Core Runtime 已经包含 `@deepseek-ai/dsh-web` 与 `@deepseek-ai/dsh-web-search-deepseek`，因此本次不升级 `core-runtime.lock.json`，也不把 Core 包重新声明为根项目 registry 依赖。第一方插件继续作为 Profile 的 installation-owned workspace 包提供。

## 组件变更

- `packages/insight-desktop-integration/src/web-search.ts`：封装企业搜索 Provider 的构造，使用共享服务环境、固定 `enterprise-search` 模型标识、4096 `maxTokens` 和每次请求最多 5 次原生搜索。
- `packages/insight-desktop-integration/src/index.ts`：将插件注入从 `llm` 扩展到 `web`，在同一个生命周期 effect 中复用凭证客户端，同时注册模型 Adapter 和搜索 Provider，并在卸载时释放两者。
- `packages/insight-desktop-integration/tsconfig.json`：补充 Runtime 的 `dsh-web` 类型增强和 `dsh-web-search-deepseek` 类型路径。
- `packages/insight-desktop-integration/cordis.patch.yml`：禁用 Core 自带的 `web-search-deepseek`，避免与企业 Provider 重复注册或发生 Provider 选择歧义。
- `scripts/prepare-bundled-profile.mjs`、`src/main/state/bundled-profile.ts`：将默认 Profile 版本从 5 升到 6，并把版本 5 纳入安装包更新迁移，使既有用户获得新的 patch 和集成包。

## 凭证与安全边界

搜索 Provider 只保留 `resolveApiKey` 回调，不缓存 Token。每次搜索通过现有 `createModelCredentialClient` 获取 Token；请求体和会话记录不写入凭证。Provider 的 `recordRequest` 仅记录无 Token 的请求元数据，若无当前会话则安全跳过。

Endpoint 直接使用当前统一配置中的 `modelBaseUrl`，该值已经包含企业服务路径和 `/v1`。Provider 只追加它规定的 `/messages`，不重复拼接 `/v1`，从而保留反向代理路径。

## 错误与兼容性

- 登录失败、凭证通道关闭和取消信号在发起网络请求前拒绝，并且不触发 `fetch`。
- 上游非 2xx 错误保留可行动错误信息。
- 没有 `web_search_tool_result` 的文本响应必须失败，不能把模型猜测当成搜索结果。
- Profile 版本迁移只更新 installation-owned 包和补丁，不删除用户插件、工作区或会话。

## 验证范围

定向测试覆盖 Provider 注册、Endpoint、Authorization、原生工具类型、Token 不进入记录、取消、登录失败、上游错误、无结构化结果和默认 Provider 禁用；随后执行桌面集成类型检查、定向 Vitest、完整 Vitest，以及 desktop integration 构建。

