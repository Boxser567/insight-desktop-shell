# 企业会话免 API Key 接入分析

## 范围与结论

日期：2026-09-09。以下保存首次分析时的结论，排除全部画布能力；分析阶段不合并业务代码、不触发模型调用。用户随后批准实施，后续进展见文末，不将分析阶段的状态误作当前实现状态。

- 分析工作树：`/Users/boxser.shi/Documents/harness/insight-desktop-shell-gateway-analysis`。
- 分支：`codex/enterprise-gateway-analysis`，起点 `77571d4`。
- 同事仓库：`/Users/boxser.shi/Documents/harness/service/insight-desktop-shell`，本地 HEAD `5e3f4cd24f90d9d0161067b2593617d73255c4a6`（2026-09-03）。本轮未 fetch，结论限于该本地快照。
- 对照资料：桌面文件 `Shell 模型调用与 GitHub STS 上传.md`，文内更新日期 2026-09-09。
- 当前主工作树正在修改版本号和发布策略；本分析从已提交基线创建，未携入这些并行变更。

结论：同事通过第一方 Host 插件注册 `yinsai-gateway` Provider，把登录 access token 注入 DSH 原生 `DeepSeekAdapter.resolveApiKey()`，由自有 Gateway 负责后续模型服务。用户登录即可获得会话所需身份，无需自行填写模型 API Key。应提取这个接入方式，并复用当前客户端的用户中心登录、安全存储和账号生命周期。

本地旧实现与 9 月 9 日手册存在实质差异：旧代码依赖 Enterprise API 的 access/refresh 会话；新手册要求模型接口接收用户中心 Access Token。后续应以当前服务契约为对接目标，不将旧认证实现整体合入。手册描述不等于已验证线上行为，本轮没有带用户凭证实测 Gateway。

## Git log 功能归属

| 提交 | 时间（北京时间） | 功能及处理建议 |
| --- | --- | --- |
| `76b6cd2` | 09-02 20:52 | Initial import；是导入基线，不应视作本轮新增功能整批合并。 |
| `dd18562` | 09-03 11:01 | enterprise plugins/skills：包含 Provider、企业认证、Profile 打包，以及附件、生成、技能、记忆、用量等；只提取模型接入必需部分。 |
| `004d159` | 09-03 11:52 | 修复内置企业插件依赖可解析性；迁移插件时必须带入这项经验，确保包、依赖和 bundle 都进入最终 Profile。 |
| `0b6ad48` | 09-03 13:06 | 桌面只保留 Shell 登录入口，插件登录 UI 用于独立 Web；退出复用 `insightDesktopAccount.signOut()`。 |
| `cc77618` | 09-03 14:40 | 独立 Web 开发模式，适合后续联调；不是桌面免 API Key 的必要条件。 |
| `5e3f4cd` | 09-03 16:58 | 画布 toolbar 修复；按本轮范围排除。 |

`dd18562` 混合多个领域且修改 70 个文件，不适合整提交 cherry-pick。当前客户端已有后续安全存储、插件管理和发布能力，应在现有基线上做小范围接入。

## 同事实现的请求链

```text
Shell 手机号登录
  → Enterprise API /api/auth/phone-login（旧代码）
  → accessToken + refreshToken + expiresIn + user + config
  → Shell safeStorage 加密保存完整会话
  → Main 写 0600 enterprise-session.json，路径传给 Harness
  → Host EnterpriseAuthService 启动读取会话
  → yinsai-gateway Provider 的 resolveApiKey 获取有效 accessToken
  → DeepSeekAdapter 发 Authorization: Bearer <accessToken>
  → 自有 Gateway /v1/chat/completions
  → DSH 原有 SSE、上下文、工具调用与会话界面
```

### 为什么不会再要求用户输入模型 Key

1. `packages/insight-dsh-compat/src/host.ts:15–43` 注册自定义适配器，`resolveApiKey` 直接调用 `resolveAccessToken`。虽然回调名含 ApiKey，实际传入的是用户会话令牌。
2. `packages/insight-enterprise-plugin/src/index.ts:42–48` 将这个回调接到 `auth.requireAccessToken()`。
3. `packages/insight-enterprise-bundle/cordis.patch.yml:3–25` 把默认模型指向 `yinsai-gateway/deepseek-v4-flash-vision-exp`，禁用原生直连 Provider 和模型密钥设置页。隐藏设置页仅影响产品入口，真正使请求可用的是前两项。
4. 原生 Adapter 继续组织上下文、工具和流式响应。锁定 Core 的 `packages/llm/llm-deepseek/src/adapter.ts:460,521,607` 分别取凭证、组装 Bearer、发送 `/chat/completions`。

上游模型 Key 放在后台是该方案文档中的服务端职责；本次提供的本地仓库只有客户端侧代码，没有据此验证后台的具体验签和转发实现。

### 会话如何交给 Host

`src/main/auth/electron-auth.ts:21–62` 定义镜像文件、原子写入及 0600 权限；`src/main/index.ts:1545` 附近设置 `YINSAI_AUTH_STORE_PATH`。Harness 子进程继承启动环境。Host 的 `auth-service.ts:294–301` 在启动时读文件，`116–122` 在剩余不足 30 秒时刷新。

React 只取公开 user/config/expiresAt，不拿模型 Key 或 refresh token。桌面登录界面仍由 Shell 管理，插件 `AuthController` 检测到桌面账号桥接后不显示第二层登录。

## 与当前客户端及新版手册的差异

| 项目 | 同事本地 09-03 快照 | 当前客户端 / 09-09 手册 |
| --- | --- | --- |
| 登录 | `/api/auth/phone-login`；内部企业会话 | 当前 Shell `/user-server/loginV3`；用户中心 access token |
| 刷新 | POST `/api/auth/refresh`，body 传 refreshToken | 当前 Shell GET `/user-server/refresh`，使用隔离 Electron Session 的 Cookie 与 token |
| 业务身份请求 | `Authorization: Bearer <企业 token>` | 当前用户中心 API 使用 `token` 头；手册要求模型接口使用 `Authorization: Bearer <用户中心 token>` |
| 地址 | localhost 8787/8788，依赖进程环境变量 | 测试公网服务有 `/insight-harness-service` 和 `/insight-harness-llm-gateway` 前缀 |
| 模型 Provider | 已注册企业 Provider | 当前产品 bundle 只注册 desktop-integration，未将登录身份接到 LLM |
| Runtime | `insight-runtime-v0.1.1-rc.10` | 相同；两个 `core-runtime.lock.json` 字节完全一致 |

手册出现 `serviceEndpoint()` 和 `YINSAI_USER_SERVICE_URL`，本地旧实现尚无这些接入。不能把手册中的新实现片段当作该本地版本已具备的功能。

## 必须处理的实际问题

1. **公网地址前缀被截断。** 插件 `index.ts:52–58` 把 pathname 清为 `/`，第 44 行又使用 `new URL('/v1', base)`。使用真实测试 Gateway 地址复现后，目标变成 `https://gapi-test.insight-aigc.com/v1/chat/completions`。必须保留服务路径并只追加一次 `/v1`。业务请求中的根路径拼接同样需关注。
2. **Shell 与 Host 各自维护刷新状态。** Shell 加密保存一份，Host 从镜像读另一份后独立刷新，并只回写明文镜像；没有将刷新结果同步回 Shell 的机制。下次启动 Shell 会把旧凭证再次写到镜像。如果后台轮换 refresh token，可能导致恢复失败。应将当前 Shell 作为唯一登录/刷新所有者，Host 按需获取有效 access token。
3. **所谓临时文件实际含持久 refresh token。** 镜像是 0600 明文 JSON，没有自动 TTL，Host 还会持久回写。0600 不是加密，Windows 上也不能等价当作完整 ACL 隔离。后续优先通过受控的 Main–Host 通道传递短期 access token，不复制 refresh token，也不把它放入 renderer、日志或子进程环境变量。
4. **业务接口故障会误清登录态。** `auth-service.ts:102–112` 的 `currentSession()` 把任何配置/技能同步异常都作为清会话条件；插件客户端每 30 秒调用一次。网络抖动或 `/api/skills/sync` 失败也可能让 Host 丢失身份，而 Shell 仍显示已登录。最小会话接入不应依赖技能、记忆和业务配置同步成功。
5. **模型请求未经过业务代理的 401 刷新分支。** `requestRaw()` 的一次刷新重试仅覆盖经它发出的业务请求；模型由 Adapter 自己 fetch。需明确模型鉴权失效如何回到统一登录/刷新流程，不能承诺已有“模型 401 自动刷新”；已输出的流式会话不能透明整轮重发。
6. **模型目录实际是静态配置。** `allowedModels/defaultModel` 虽存在于下发配置类型，Adapter 与 Profile 仍使用硬编码模型。1.0 可保留一个固定模型，只需确认后台支持；不应顺带建设动态模型管理。

同事 bundle 同时禁用了插件设置和模式切换，后者属于其产品需求，免 API Key 不依赖这些行为。当前客户端的插件管理能力应保留。

## 建议的最小接入范围

1. 保留当前用户中心登录、safeStorage、账号隔离、退出流程；在 Main 的会话服务中提供 Host 可用的有效 access token 获取能力，以及统一过期通知。通道需要绑定当前 Harness 实例和账号生命周期。
2. 提取轻量第一方 Host Provider，复用原生 DeepSeekAdapter；默认模型与测试 Gateway 固定，认证使用当前用户中心 token。不携入完整 enterprise client、画布、生成工具、技能同步和记忆服务。
3. 小范围补充 Profile bundle 和内置包依赖，设置默认 Provider/model，调整不再适用的“必填 API Key”入口。可禁用出厂直连 Provider；不额外封闭现有插件市场或 Agent 模式。
4. 将 Gateway 公网地址写入受控产品配置，避免安装包依赖开发者终端环境。需要同时明确登录与模型服务环境：当前打包版登录仍选生产用户中心，而会话目标暂定测试 Gateway。生产用户中心 token 是否可被测试 Gateway 接受没有证据；1.0 联调应保持同环境，或先获得后台兼容确认。
5. 验收空白 Profile 登录后首条流式回复、工具调用和结果续接、取消请求、重启恢复、临期刷新、退出/切换账号、断网恢复与鉴权失败提示；全程不出现 API Key 必填引导。若首版支持图像，额外验证 Core Adapter 的 Files API/附件协议，单条文本成功不能证明视觉输入可用。

发布上传继续使用 GitHub OIDC → STS。会话使用用户中心 token → 模型 Gateway；即使共用域名，这两种凭证和生命周期也不能混用。

## 本轮证据与边界

- 已逐项分析同事仓库全部 6 条本地提交及相关认证、Provider、Profile 和桌面单登录实现。
- 已对照 09-09 接入手册，明确与 09-03 本地代码的时间顺序和契约差异。
- 已用 Node 的 URL 运算复现服务路径丢失；两个 Runtime lock 的 SHA-256 均为 `1124b4aa2add5f03f65f623610530eb3510a91cf253d7028b70c0e41f76eabe2`。
- 未带用户身份请求模型接口、未发送会话内容、未产生模型调用费用；本轮结论是代码分析与接入建议，不代表已完成联调。
- 本工作树仅新增分析文档；业务接入代码尚未实施。

## 同日后续：用户批准后的实施记录

上述“尚未实施”仅指先前分析阶段。用户批准后，同一独立工作树已按最小范围完成 Shell 单一凭证所有者、Main–Host IPC、第一方 Gateway Provider、默认模型和出厂密钥入口调整。未整批 cherry-pick 同事代码，未携入画布；Runtime 锁、STS 上传和并行主工作树未改动。

当前代码、验证证据和待执行的真实账号门禁见 [模型 Gateway 接入与验收](../model-gateway-integration.md)，执行状态见 [实施计划](../superpowers/plans/2026-09-09-desktop-model-gateway.md)。该实现仍在功能分支，不等于已经合入 `main` 或通过线上模型验收。
