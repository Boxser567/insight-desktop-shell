# 提示词增强插件与 Core 0.2.1 的兼容修复

## 判断

用户截图中的 `ctx.get(...)?.get is not a function` 来自内置社区插件 `dsh-prompt-enhance@0.2.1` 的 Host 模型路由解析。旧代码执行 `ctx.get('settings')?.get('agent-default-model')`，当前官方 Core 的 `settings` 已是 SettingsForms，不提供这个旧同步读取接口；默认模型由 `agentDefaultModel.currentSelection()` 提供。异常发生在模型请求之前，不能归因于企业网关通信失败。

本轮 Core 合并保留了官方 SettingsForms 和 AgentDefaultModel 公共服务，Shell Gateway 使用 Core 已导出的公共 PiAi 接口。问题是配套社区插件的兼容迁移不完整：此前只覆盖输入字段、客户端设置和主题，遗漏了 Host 默认模型链路。原先的插件启动、按钮显示和桌面冒烟不能证明实际增强成功，验收范围需要明确区分。

## 升级与官方接口

2026-10-08 实时读取 npm registry：最新发布版本为 **0.2.7**，发布时间为 2026-09-30 05:08:20 UTC。[作者源码与说明](https://github.com/rongxingda/dsh-prompt-enhance/tree/v0.2.7)明确适配 SettingsForms 与 AgentDefaultModel。来源固定为 `v0.2.7` / `4dc6a140d2b6c59305edb8c74aaed639b71d7291`；npm `gitHead` 与 tag 提交一致。

采用完整上游发布包替换 0.2.1，不给旧 Host 追加私有路由接口。0.2.7 通过 `ctx.get('agentDefaultModel').currentSelection()` 读取默认模型，并在旧服务无 `.get` 时安全回退。包内容的 SHA-512 / SHA-1 与 npm 发布记录一致，固定 SHA-256 为 `31b54b6239354c1c6cbda571ffb5dde3e092d1ee7fdebd440df839d107af7b5e`。

0.2.7 的客户端仍引用旧 `settingsScope`，因此当前 Shell 继续保留明确检查的构建适配：

- 输入 `imageIds` → 当前 Core 的 `attachmentIds`，保留上游 `countOf()` 防御逻辑。
- 设置镜像 → 当前 Core 公共 `configForms.get(namespace)` / `getSnapshot()` / `subscribe()`，每次刷新重新解码。
- 主题 → Core 已解析的 `data-ds-dark-theme`。

这些适配没有扩大 Electron IPC 权限。插件请求仍经过自己的本地 Host 路由、Core LLM 和因赛 Gateway；因赛凭证继续走既有 Main / Utility Process 桥接。

安装迁移将受管理的 0.1.9 / 0.2.1 包及依赖指针升级至 0.2.7，并更新本地归档、清理需要重装的依赖标记。已卸载的插件保持卸载，用户自行升级至非受管理版本的插件保持原版本。正式 Core lock 不变。

## 验证

- 固定 tarball / npm integrity / Git tag 提交检查通过；Profile 的冻结依赖安装通过。
- Shell 最终 127 个文件、918 项通过，包含当前 Profile 第 8 代的 0.2.1 → 0.2.7 迁移、旧第 7 代迁移、客户端设置刷新及保留用户升级/移除的回归。
- Main / Renderer 类型检查和 electron-vite 构建通过。
- 真实 Electron / Core / 插件 / Gateway / 凭证 IPC 下：增强预览不修改原文、回填、撤销、上游失败保留草稿、重试成功、取消请求导致上游中止，全部通过。仅登录和模型 HTTP 响应使用测试替身，没有请求真实企业服务或消耗模型额度。
- 把上一版 DMG 中的真实 Profile 第 8 代和 0.2.1 插件复制到隔离账号目录，实际启动后插件及依赖指针均迁移到 0.2.7，同一轮完整增强与账号切换回归通过。
- 同轮浅色、深色、跟随系统与再次浅色，每种状态采样 30 次，空闲原生主题变化均为 0，保留上一轮闪烁修复。

成功证据目录：`/private/tmp/insight-prompt-enhance-desktop-verified-20261008`、`/private/tmp/insight-prompt-enhance-migration-20261008`。模型请求证据只记录模型 id、流模式与鉴权是否存在，不记录账号令牌。

## 对其他内置插件的限制

此次扫描也发现固定的 Memory Evolve 0.1.0 在模型配置页仍引用 `ctx.settings.get()` 和 `llm.listConfigurableProviders()` 等旧接口。启动正常不能代替该插件的模型选择、同步、会话编排等业务验收；这些引用尚未在本次修复中迁移，不能据此宣称所有社区插件已兼容新 Core。应在其后续升级中逐项复现和验证，而不是仅扩大 `dsh.engines` 版本范围。
