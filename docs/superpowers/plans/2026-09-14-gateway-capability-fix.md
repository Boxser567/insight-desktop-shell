# Gateway Capability Fix Implementation Plan

**Goal:** 执行已批准的 Gateway 能力审查发布要求，默认 deepseek-flash，恢复官方模型能力及可靠的原会话继续路径。

**Architecture:** 沿用 DeepSeekAdapter 和官方压缩服务；企业插件只提供身份、路由及经证实的差异。以锁定 Core 的官方模型目录为配置来源，避免重复数字。当前环境未安装 executing-plans 子技能，直接在当前任务按本清单执行，不再请求已获得的方案批准。

**Tech Stack:** TypeScript / Cordis / Vitest / Node / Electron。

## Constraints

- 默认ID `deepseek-flash`，展示名 `DeepSeek-V4.1-Flash`；两个旧Flash别名可继续。
- 保留登录、账号隔离、退出撤销和免API Key机制。
- 无依据的8192/128000覆盖移除；继承官方80%压缩。
- 不开启官方会话日志上传；不删除用户数据；不改无关未跟踪文件。
- 服务端实际容量、路由和计费必须另有证据，不把模拟验收称为真实验收。

## Tasks

- [x] 配置及能力：修改 `model-gateway.ts` 及 Profile patch，基于 `resolveAdapterOptions({}).models` 中 deepseek-flash 条目获取官方能力，旧别名解析为同一能力；同步 `smoke-packaged-harness.mjs` 和配置测试。先增加模型解析/预算/旧别名断言，再运行并修复。
- [x] 凭证错误：`model-credential-client.ts` 引入携带 AUTH/TRANSPORT/TIMEOUT 的错误，Adapter 保留类别；用现有 IPC runtime fixture 验证网络不可用不再AUTH，超时及退出仍有界。
- [x] 附件：按官方 resolveImageAttachmentAccess 接入执行环境路径；用真实Adapter附件请求验证正常图片及offload文本包含可用路径。
- [x] 会话恢复：检查 Core max-tokens 后历史投影与工具配对，复现截断后第二轮；只对证实缺陷修复，验证 length、上下文溢出、压缩、取消及无重复工具执行。
- [ ] 真实网关：从可用服务定义/接口查明契约；如真实授权会话不可用，保留明确待验收项，不伪造结论。
- [ ] 验证交付：运行聚焦测试、类型检查、完整Shell测试及构建；更新审查报告中的已修复/待验证状态，检查diff。

## Current checkpoint

本地实现、696项Shell测试、286项Core测试、类型检查、构建及新Runtime组合冒烟通过。真实网关契约仍待信息；跨平台Runtime发布及锁文件更新尚未执行，详见审查报告实施结果。

补充204项官方Adapter测试、旧会话预算回归均通过。Runtime CI 34824878484三平台构建全部通过，仅上传验证产物（publish=false）；源代码分支已推送，更新渠道未变更。
