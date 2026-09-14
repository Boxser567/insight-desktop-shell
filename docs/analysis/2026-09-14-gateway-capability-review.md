# Gateway 能力完整性审查

日期：2026-09-14。范围：Shell Gateway 注册、模型配置、凭证 IPC、身份校验、Profile patch、运行时测试，以及 rc.10 锁定 Core 的 DeepSeek Adapter、压缩与终止行为。只审查并记录，未修改运行代码、调用付费模型或发布版本。没有取得企业 Gateway 服务端源码、路由配置或故障请求 trace，因此不能证明其实际限制等于官方服务。

## 结论

当前 Gateway 保留了官方传输实现，但自行覆盖模型容量、固定模型目录、简化错误类别并遗漏部分接入钩子。升级 Core 不会自动消除这些覆盖。之前验证了接入可用性，但没有充分验证模型能力完整性。

应让 Gateway 负责企业身份和服务路由；模型能力以对应部署的官方模型规格为基线，企业服务端确有差异才覆盖，且记录来源。压缩、请求预算、SSE、工具调用和重试尽量继承锁定 Core。不能把所有数字删掉，也不能把官方最大值全部当默认值。

## 确定发现

### P1：普通生成的默认输出预算被压到 8192

位置：`packages/insight-desktop-integration/src/model-gateway.ts:17–20`。

连接级和模型级重复指定 maxTokens=8192。Core LLM 服务在调用未明确指定时填充 defaultMaxTokens，序列化最终发送 max_tokens；因此这不是仅供 UI 展示的数字。rc.10 Core Adapter 默认值为 256000，而 Shell 覆盖为 8192。显式调用预算仍可覆盖，所以它不是任何调用都不可突破的服务器硬上限。

影响：长回答或复杂任务提前 length，放大现有停止行为。修复应明确区分模型最大容量、客户端默认预算和单次请求覆盖；先确认企业路由支持范围，再继承相应官方默认策略。

### P1：128000 上下文覆盖官方容量，影响压缩和保留历史

位置：同文件 18–20 行；Core `packages/compaction/compaction-basic/src/config.ts`。

当前 Core DEFAULT_CONTEXT_WINDOW=1000000；Shell 默认和模型目录均写为128000。Core 自动压缩默认 auto=true、thresholdRatio=0.8、retainRatio=0.16。Shell patch 没有关闭压缩。当前阈值据此为102400，默认原文尾部保留预算为20480；这里的触发依据是请求压力，并非只统计聊天文本。

若 Gateway 实际支持1M，当前配置会过早压缩、减少原文保留；若 Gateway 实际只有128K，则应作为有来源的部署限制记录，而非无依据扩大。80% 是官方 Harness 客户端策略，不是 API 服务端承诺。压缩摘要默认8192是另一项官方策略，不应与普通回答8192一起机械删除。

### P1：可恢复的凭证服务故障被误分类为 AUTH

位置：`model-gateway.ts:24–27`、`model-credential-client.ts`、`src/main/runtime/model-credential-bridge.ts`。

Main 区分 LOGIN_REQUIRED 与 SERVICE_UNAVAILABLE，但 Host 将结果变成普通 Error，Adapter 又统一转换为 AUTH。网络失败、超时、通道故障与登录失效因此进入同一错误类别。Core 可重试类别包含 TRANSPORT/TIMEOUT，不包含 AUTH。文字部分保留了“网络重试”提示，但机器恢复策略已失去分类依据。

应保留结构化类别：明确失效才 AUTH，网络/服务不可用及超时采用匹配类别，并保持现有账号撤销保护。

### P2：固定模型目录与静态快照阻断能力更新

位置：`model-gateway.ts:8,13–23`；`packages/insight-desktop-integration/cordis.patch.yml`。

只公布旧别名 deepseek-v4-flash-vision-exp，目录和 options 在注册时一次构造；禁用原生模型配置页后，也没有替代的非密钥能力配置来源。官方 Adapter 本来每次读取 options，但此处永远返回同一个对象。升级上游模型目录不会更新这份自建目录。

官方目前推荐 deepseek-flash，旧别名由官方转到V4.1-Flash；企业路由是否同样映射未知。应统一默认路由和能力目录来源，支持旧会话别名，不应直接批量重写会话。无需恢复用户 API Key 输入，也不必重建整套模型管理系统。

### P2：缺少官方附件访问桥接

位置：`model-gateway.ts:30–33`；对照 Core `packages/llm/llm-deepseek/src/index.ts:476`。

接入了 resolveAttachments，却没有 resolveImageAccess。官方实现通过 resolveImageAttachmentAccess 和 fs.processPathFromHostPath 提供工具执行环境内的只读路径。缺失后图片句柄/被移出请求的占位文本没有该路径，模型无法通过这条官方路径找回附件；这不等于所有图片请求都失败。

应复用官方桥接并验证工作区路径映射、图片 offload 后的读取能力。

### P1 验收缺口：测试没有覆盖本次最重要的能力边界

位置：`test/model-gateway-runtime.test.ts`、`test/fixtures/model-gateway-runtime.mjs`。

现有真实 Adapter+IPC 测试覆盖 success、expired、gateway401、cancel，检查 URL、Bearer、model、工具序列化与基本流。没有证明默认输出预算、80% 压缩、上下文溢出恢复、length 后下一轮、截断工具参数、图片上传/fallback/offload、实际 Gateway usage/error 透传符合契约。安装包和基础 smoke 成功不能代替这些证据。

## 已确认差异，但不能直接定性为需要全部开启

- `prepareExtensions` 永远返回空字段，确实跳过官方扩展注册服务。目前检索到的真实消费者包含 `session-log-deepseek` 的 dsh_session_log；不能据此声称思考/工具调用被关闭，也不应无条件恢复官方日志上传。应逐项确认企业接口接受的扩展及业务授权。
- 官方当前 deepseek-flash 目录声明 systemPromptUpdate='in-history'，我们的旧模型目录未声明。会使用前置 system 的兼容语义，未证明提示词丢失。只有服务端确认中途 system 更新语义后，才可继承此声明。
- 图片声明为 text+image，但 Adapter 首先尝试 Files API，失败才转 inline。若企业只代理 chat/completions，可能增加失败上传和等待，部分“上传成功但后续拒绝文件引用”的错误也不能假设自动改为 inline。需核实服务端 Files API、文件归属、重用、inline限制，不能仅凭 image 标签宣告完整兼容。
- 每次模型操作前调用 currentUser，即使有效 token 也依赖用户中心可用；长工具循环及压缩请求会增加校验往返。这是现有明确身份策略，属于可用性取舍，需依据 token 有效期和撤销要求评估，不能直接删掉校验。

## 上游行为及不应误报的问题

- thinking=enabled / reasoningEffort=high 与当前官方 API 默认一致；Core 仍公开 off/low/high/max，调用级参数可覆盖。不能声称用户被锁死在 high。
- Core 将 length 归为 max-tokens、保存部分输出并停止本轮；Goal driver 也停止自动推进。上下文溢出错误另有压缩重试路径，但正常 length 不进入该路径。这是上游已有行为，8K 配置会使其频发。仅靠 length 无法可靠区别输出预算与上下文耗尽。
- 自动80%压缩、手动 /compact、上下文错误恢复、SSE usage、工具参数拼接、取消、图片规范化、标准请求重试已有复用；不要在 Shell 再各写一套。
- “会话完全不可继续”尚无故障 trace 证明。必须验证截断后消息/工具调用配对、下一请求错误、UI idle 状态，不能用提高上限掩盖它。
- 测试环境路由是此前明确选定的环境，并非本次发现的误配置。

## 官方参考与版本边界

2026-09-14 查询：官方模型规格为1M上下文、最大384K输出，旧Flash别名仍可请求但已路由至V4.1-Flash。[模型规格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)

API未指定max_tokens时，非思考默认8K，思考默认64K，max强度默认128K；允许范围1–393216，输入与输出总长受上下文限制。length同时可能表示输出或上下文限制。[Chat Completions](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)

rc.10 锁定 Core 源码检查路径：`/private/tmp/insight-core-upgrade-20260914`，commit `5c7450d116d59f972b5df64efa3942220d363809`。其 Adapter 默认输出256000，与今日官方API默认值/最大值是不同概念。官方Harness的80%策略来源：[compaction config](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/compaction/compaction-basic/src/config.ts)。版本升级时应审查这些差异，避免用网页最大值替换所有默认值。

## 建议修复顺序与验收

1. 核实企业路由对应模型、允许/默认max_tokens、context、Files API、usage及错误透传。形成有来源的最小能力契约；不能假设标准 /models 返回完整容量。
2. 删除无依据的重复容量覆盖，按官方对应模型/锁定Core策略设置唯一来源；保留企业身份及旧别名兼容。区分官方容量与经证实的企业限制。
3. 修复凭证错误分类，补官方附件桥接；逐项处理扩展和system更新差异。
4. 对输出截断与真实上下文溢出分别验收。先保证原会话可继续、工具不误执行；需要自动续接时使用有界、可取消的机制，避免无限重试。
5. 发布门禁：超过旧8K的正常回答；阈值前不压缩、跨阈值后保留目标和近期原文；上下文错误压缩后重试；length后下一轮成功；截断工具不执行且后续请求合法；图片Files/inline/offload路径；鉴权过期与网络故障分类；取消及时、无重复工具执行。当前报告未执行这些新验收。

## 用户最终确认的需求与下一次发布门禁

2026-09-14 在正式修复前确认。以下为待实现/待验收要求，不表示已修复。

### 模型身份

- 默认请求模型 ID：`deepseek-flash`（全小写，API标识）。
- 对应模型展示名称：`DeepSeek-V4.1-Flash`（按官网大小写及标点）。
- `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 作为历史兼容别名；官方由V4.1-Flash提供服务并按Flash计费。企业网关必须验证相同路由行为，客户端不得仅修改显示文字就宣称完成迁移或计费验证。
- 新会话、普通模式和安全模式的默认模型一致；旧会话无需重建即可继续。旧别名不再作为不同在售模型展示，历史请求记录保持真实。
- 默认配置、目录、界面和冒烟测试同步更新，模型身份及能力来源集中维护，避免多处复制后漂移。

### 必须完成的发布项目

| 项目 | 完成标准 |
| --- | --- |
| 模型路由与命名 | 实际请求使用deepseek-flash；显示DeepSeek-V4.1-Flash；两个旧别名会话均可继续；后端确认实际路由和Flash计费映射 |
| 容量与输出预算 | 移除无依据的8192/128000覆盖；以对应官方模型与Harness策略为基线，服务端差异有证据；区分最大容量、默认预算和请求覆盖，不另猜一个固定上限 |
| 压缩 | 继承官方80%请求压力策略并使用正确容量；验证阈值前后、近期历史保留、手动/compact及上下文溢出后有界重试；摘要预算与普通输出预算分别处理 |
| 截断恢复 | 保留已有回答及历史；提供有效继续路径，输入可用、原会话下一轮成功；上下文耗尽走压缩恢复；不能仅凭length误报原因；截断工具参数不得执行或污染后续请求 |
| 错误分类 | 登录失效、网络故障、超时、限流和服务端错误正确区分；恢复不误要求输入API Key，不无限重试、不重复工具执行 |
| 图片与能力桥接 | 补齐官方附件路径桥接，验证图片理解、实际支持的Files/inline路径和offload后读取；核对system更新及扩展差异，支持项正确接入、排除项有明确依据 |
| 回归与诊断 | 验证超过旧8K的生成、长会话压缩、截断后继续、思考强度切换、工具循环和取消；记录脱敏模型ID、有效预算、usage、finish reason及压缩结果，能定位限制来源 |
| 企业能力保留 | 登录、刷新、退出、账号隔离和免用户API Key调用均通过；普通/安全模式及三个发布平台完成适用回归 |

仅有基础回复成功、构建通过或提高token数，不满足本次发布门禁。特别是实际企业路由/容量未验证，或原会话截断后仍无法继续，均不能宣称本次问题修复完成。

不要求本次新增完整多供应商管理、Responses/Anthropic接口或所有官方扩展。官方日志上传不会因“对齐官方”自动开启；本次要求完成能力差异审查和与桌面实际调用相关的兼容修复。自动续接如果实施，必须有界且可取消；最低发布标准是可靠的继续路径及上下文耗尽恢复。

## 实施结果（2026-09-14，尚未发布）

修复分支：Shell 与隔离 Core 均为 `codex/gateway-capability-20260914`。

- 默认请求改为deepseek-flash、展示为DeepSeek-V4.1-Flash。目录只列新模型，旧别名仍解析并发送，使用同一套Flash能力。
- 删除普通生成8192及上下文128000的自定义覆盖，继承锁定Core官方Flash条目、默认生成预算、图片策略及重试。当前继承值为上下文1000000/默认输出256000；不是企业端实测容量，也不是把官方最大384K当默认。
- Host凭证错误保留AUTH/TRANSPORT/TIMEOUT；未知异常使用脱敏TRANSPORT提示。补齐官方附件访问与工具文件系统路径映射。
- Core提交 `4489dd61edc403117ec0903e86de426633fb20d4` 修正AUTH的“API密钥无效”误导文案，length提示改为生成长度限制，说明继续及/compact路径。
- 复用现有Core恢复逻辑：编译版Core的模拟HTTP测试证明length后保留回答并允许下一轮；截断工具不执行且不会带入下一请求；上下文错误触发摘要并重试；长会话自动压缩并保留近期指令。未添加Shell压缩器或无限续接循环。

验证证据：

- Shell全量108文件696测试通过，包含会话、图片inline回退/offload路径、旧别名序列化、四档思考及显式输出预算覆盖。最终使用新组装Core，日志 `/private/tmp/insight-gateway-final-tests.log`。
- Core会话循环、压缩、聊天UI共6文件286测试通过；客户端构建通过，日志 `/private/tmp/insight-gateway-core-tests.log`。
- Shell与integration类型检查、build:prepared、bundled profile刷新通过。
- 本地macOS arm64新组装资源 `/private/tmp/insight-gateway-resources-20260914` 冒烟通过，确认新模型目录、工作区/会话创建及稳定运行。日志 `/private/tmp/insight-gateway-smoke.log`。
- 模型响应及usage为模拟数据；不能代替真实模型超过8K生成验收。未调用真实模型或核实后端计费。

发布仍阻断：

1. 待企业Gateway仓库/文档或真实服务证据，核实新旧模型路由、容量、计费、Files协议和错误/usage透传。
2. systemPromptUpdate保持前置system兼容语义，服务端确认in-history后再启用；官方session-log扩展保持关闭。
3. Shell的core-runtime.lock.json仍锁定rc.10已发布依赖。Core文案修复已在本地新Runtime验证，但尚未制作三个平台新发布资产和更新锁文件；常规安装包尚不包含全部修复。
4. 未升级应用版本、触发OSS或更新Candidate/Stable指针；发布前仍须完成跨平台安装包及真实账号验收。
