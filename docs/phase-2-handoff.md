# Insight Desktop Shell - 阶段 2 交接文档

## 文档目的

本文记录 `insight-desktop-shell` 当前已达成的基础状态，以及下一阶段的实施边界。

当前目标不是开发完整的 Insight 产品界面，而是将已经验证可用的 `dsh-desktop` 基线，改造成一个最小化、具备 Insight 品牌、运行稳定、数据隔离、插件策略可控的 Harness 桌面宿主。

## 当前状态

- 仓库：`Boxser567/insight-desktop-shell`
- 当前分支：`main`
- `origin`：`git@github.com:Boxser567/insight-desktop-shell.git`
- `upstream-dsh-desktop`：`https://github.com/dataelement/dsh-desktop.git`
- 第一轮验证已完成：未修改的 DSH Desktop 基线可完成安装并成功启动。
- `package-lock.json` 因本地执行依赖安装而变更。该变更已确认需要保留，并应作为基线的一部分提交。

## 仓库协作模型

```text
deepseek-ai/deepseek-harness
  -> insight-harness-core
       - 可与上游同步的 Harness Fork
       - 只保留必要的框架兼容性补丁

dataelement/dsh-desktop
  -> insight-desktop-shell
       - Electron 宿主、原生生命周期、打包与品牌

insight-platform-extensions
  - Insight 插件、共享协议与控制面 API
  - 账号、租户、角色、Skill 与插件策略
```

`insight-desktop-shell` 应消费由 `insight-harness-core` 构建出的、有明确版本的 Harness Runtime；不能将 Core 的 Git 源码直接复制进桌面仓库。

## 为什么以 DSH Desktop 为基线

DSH Desktop 已处理好本阶段不应重新实现的桌面端问题：

- Harness 子进程生命周期管理
- 随机回环端口分配与就绪检测
- 启动超时、日志、错误恢复与优雅退出
- Electron 安全默认配置
- Electron 用户数据目录中的 Harness Profile、会话与插件持久化
- macOS 与 Windows 的打包配置

除非本文明确说明移除，否则上述能力都应保留。

## 阶段 2 范围：最小 Insight 宿主

### 保留

- `src/main/runtime/harness-runtime.ts`
- Harness 启动目录、Profile 持久化、Profile 一致性/恢复与日志
- 仅监听回环地址 `127.0.0.1`
- BrowserWindow 安全配置：`contextIsolation`、`sandbox`、禁用 Node Integration、导航及权限限制
- Harness 启动期间的启动页与错误恢复生命周期
- Electron 构建配置，作为后续 macOS 与 Windows 发布的基础

### 当前移除或禁用

- `dsh-market` 用户界面及 `dsh-desktop-market-installer`
- 手机配对、局域网桥接、Cloudflare Tunnel
- DSH Desktop 的自动更新行为
- DSH 专属 Preset 导入/导出产品界面
- 注入到 Harness 侧栏的 DSH 品牌
- DSH 专属菜单文字与 About 信息

移除市场不等于移除 Harness 插件支持。它只是不再向普通用户提供任意社区插件的市场入口。

### 替换为 Insight

- 应用名、产品名、App ID、安装包名称与 About 信息
- 应用图标、启动页、Logo 与 Slogan
- Electron 的 `userData` 目录名
- `userData` 下的 Harness 数据目录，例如：

```text
<Electron userData>/insight/harness/
  profiles/
  sessions/
  plugins/
  logs/
```

最终目录结构必须在正常升级中保持数据，并且绝不能与 DSH Desktop 共用数据。

## dsh-better-sidebar 出厂预装策略

### 已确定的决策

`dsh-better-sidebar` 作为出厂预装插件。它是工作台底座，不只是一个视觉侧栏：包含文件操作、终端、Git 面板、嵌入式浏览器、子代理任务，以及供其他插件注册侧边栏 Tab 和文件预览器的 API。

### 交付规则

- 使用经过验证的精确版本，禁止以 `@latest` 方式发布。
- 在构建/发布准备阶段安装进初始的 Insight Harness Web Profile。
- 将完整解析后的依赖和桌面 Runtime 一起打包。
- 首次启动时，以这个内置模板初始化 Insight 用户的 Profile。
- 正常升级时保留用户已经初始化的 Profile。
- 后续仅通过 Insight 自己控制的版本发布或插件策略服务升级该插件。

该插件依赖 `node-pty`；其原生依赖必须针对每个目标平台和架构完成构建与验证。发布流程不得依赖最终用户手动执行 `pnpm approve-builds`。

### 安全立场

该插件具备本地机器能力，不能被视为低风险的普通 UI 扩展。

平台权限模型至少预留以下策略能力：

```text
workspace.read
workspace.write
workspace.execute
plugin.manage
```

首个本地桌面版本的预期默认策略是：已登录的本机桌面用户可使用完整工作台能力。服务端策略约束将在后续阶段引入；Electron 本地保存的角色信息永远不能作为授权事实来源。

### 后续扩展点

优先使用插件公开的 `ctx.betterSidebar.registerTab` 与 `registerFileViewer` API，开发 Insight 自有的侧边栏能力，例如画布、Skill 面板、项目看板或受控文件预览器。只要公开 API 可以满足需求，就不应修改该插件源码或对其打补丁。

## Patch 使用策略

按以下优先顺序选择集成方式：

1. Harness 配置、公开插槽与插件 API
2. `insight-platform-extensions`
3. Insight 自有 Shell Renderer
4. `insight-harness-core` 中有文档记录的最小补丁
5. 针对精确 Harness 依赖版本的 `patch-package`

`patch-package` 仅用于无法避免的兼容性问题或上游 UI 接缝。登录、权限、画布、看板和 Insight 全局导航不能以补丁方式实现。

每一个保留的 Patch 都必须记录：原因、影响的上游版本、负责人和移除条件。

## 后续 UI 架构

不要把 Harness 当作整个 Insight 产品的首页。目标是一个双层桌面应用：

```text
Electron BrowserWindow
  -> Insight Shell Renderer
       - 登录与账号状态
       - Insight 首页/数据看板
       - 全局导航与品牌
       - 画布与 Skill 中心
       - Harness 工作区路由
            -> 随机 127.0.0.1 端口上的本地 Harness UI
```

账号、租户、角色、Skill 目录和插件白名单都需要服务端控制面。初期可以将它放在 `insight-platform-extensions/apps/control-plane-api` 中，但绝不能只保存在 Electron 或 Harness Profile 本地。

## 下一会话实施顺序

### 1. 冻结可运行的 DSH Desktop 基线

- 保留当前 `package-lock.json` 变更。
- 记录当前 DSH Desktop 的精确 Commit 与依赖版本。
- 在进行功能修改前，提交这个已验证可运行的基线。

验收标准：

- 全新克隆后执行 `npm install` 和 `npm run dev` 能够完成。
- Electron 中能够打开 Harness。
- 该基线 Commit 可以独立检出并运行。

### 2. 移除 DSH Desktop 专属产品模块

- 移除市场安装器依赖及 Patch 配置。
- 移除手机桥接/Tunnel 代码和对应 Renderer 控件。
- 禁用自动更新启动逻辑与用户入口。
- 移除 DSH 专属 Preset UI 路径。
- 移除 DSH 专属侧栏品牌注入。

验收标准：

- 移除后 Type Check 和 Build 能通过。
- 菜单与 Preload API 中没有指向已移除能力的悬挂引用。
- Harness 仍能正常启动、加载和退出。

### 3. 建立 Insight 应用身份与数据隔离

- 将应用元数据和安装包改为 Insight。
- 替换 DSH 图标、启动页、文案和产品名称。
- 将用户数据与 Harness 数据迁移到稳定的 Insight 专属目录。
- 保持现有 Runtime 和安全配置。

验收标准：

- 启动和原生元数据中显示 Insight 品牌。
- 不会读取或修改现有 DSH Desktop 数据。
- 重启 Insight 后可保留自己的 Harness Profile 和会话。

### 4. 打包固定版本的 better-sidebar

- 选择并记录经过测试的 `dsh-better-sidebar` 版本。
- 创建只加载一次该插件的初始 Profile 模板。
- 为每个目标平台/架构带入所需 Runtime 与原生依赖。
- 增加不泄露敏感信息的插件启动失败诊断。

验收标准：

- 新 Insight 本地用户首次启动时只出现一个侧栏实例。
- 第二次启动不会产生重复 Loader Entry。
- 目标平台上终端、文件视图和 Git 面板能够加载。
- 插件故障时显示可恢复的诊断信息，而不是空白窗口。

### 5. 准备 Core Runtime 集成契约

- 定义 Runtime Manifest：Core Commit、Harness 版本、Node 版本、目标平台/架构与校验和。
- 在 Shell 稳定前，暂时保持当前基于 Registry 的 Harness Runtime。
- 后续替换为由 `insight-harness-core` 构建的发布产物。

验收标准：

- 每个桌面发布包都能确认其包含的精确 Harness Core Commit。
- 可以在 Release Candidate 中测试 Core 更新，而无需把源码复制进 Shell 仓库。

## 本阶段明确不做

- 账号登录界面或 OAuth
- 租户和角色服务
- 权限强制执行
- Insight 数据看板
- 画布/原型编辑器
- Skill 市场或面向普通用户的任意插件安装
- 自研自动更新后端
- 完整的 Core Runtime 构建流水线

这些工作必须在桌面宿主稳定、出厂插件边界验证完成后再开始。

## 需要持续关注的风险

- `dsh-better-sidebar` 带有高权限本地能力；每次发布前都要审查其版本与依赖树。
- `node-pty` 会引入按平台、按架构的打包要求。
- Harness 与 DSH Desktop 上游仍在快速迭代；必须通过固定版本和 Release Candidate 测试路径升级。
- 开发环境中的 Profile 可能含有用户手动安装的插件；生产策略必须区分内置、已批准和不受支持的插件。
- 自动更新涉及代码签名、渠道控制、回滚和安装包完整性；不能直接原样重新启用继承自 DSH Desktop 的更新器。

## 新会话续接提示词

```text
阅读 insight-desktop-shell/docs/phase-2-handoff.md。现在开始阶段 2 的第 1 步：冻结已验证可运行的 DSH Desktop 基线，同时保留当前 package-lock.json。不要实现账号、画布、权限、市场或自动更新功能。先检查现有基线，并提出移除 DSH 专属模块的最小改动计划。
```
