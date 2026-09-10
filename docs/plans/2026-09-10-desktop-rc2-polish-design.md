# 因赛AI Desktop RC2 体验收口设计

日期：2026-09-10  
状态：已批准，待实施

## 背景

`v1.0.0-rc.1` 已通过 GitHub Actions 构建并公开为 Candidate，更新指针当前指向 `1.0.0-rc.1`。RC1 已在 Apple Silicon 测试机完成安装和基础使用，但仍存在四项发布前体验问题：正式打包客户端仍连接测试用户中心和测试模型 Gateway；自研界面的品牌蓝色不完全一致；应用缺少符合品牌的“关于”窗口；菜单“检查更新”只打开空闲窗口，没有立即执行检查。

产品负责人确认采用阶段化环境策略：RC2 继续使用测试服务以验证 `RC1 → RC2` 的真实客户端更新；后续正式迭代再一次性切换生产用户中心和生产模型 Gateway。升级安装可以无感完成，但生产切换后允许用户重新登录一次，不迁移测试 Token、Cookie 或测试账号工作区。

## 目标

- RC2 保持测试用户中心、测试模型 Gateway 和正式更新 Origin。
- 把客户端服务地址集中到一个只读配置，后续生产切换只改一个受测试保护的选择值。
- 使用 `#315dfb` 统一因赛AI自研界面的品牌主色。
- 提供接近 ChatGPT 桌面端比例和信息层级的“关于因赛AI”窗口。
- 菜单“检查更新”立即进入真实检查流程，不要求用户在弹窗内再点击一次。
- 在本地完成 UI、契约、类型和构建验证后再决定是否触发 RC2 GitHub Actions。

## 非目标

- RC2 不切换生产用户中心或生产模型 Gateway。
- 不提供普通用户可编辑的测试/生产环境开关。
- 不迁移测试环境登录凭据、Cookie、账号目录或工作区到生产环境。
- 不修改上游 Harness 设计系统的 Token。
- 不为更新窗口增加动态尺寸切换、检查取消协议或新的后台更新状态。
- 不在本设计实施阶段触发 GitHub Actions、写入 RC2 OSS 目录或修改 Candidate 指针。

## 方案选择

采用最小稳定方案：独立 About BrowserWindow、复用现有更新窗口和 UpdateManager、集中客户端服务环境、审计自研主题色。未采用 Electron 原生 About Panel，因为它无法精确控制 Logo、字距和信息布局；未采用动态缩放更新窗口，因为它会扩大跨平台窗口状态同步范围，不是验证 RC1 → RC2 所必需。

## 客户端服务环境

新增共享的只读客户端服务配置，至少包含环境名、用户中心 Origin 和模型 Gateway `/v1` 地址。开发通道始终使用测试配置；RC2 的 Candidate 和打包客户端选择测试配置。认证 Main 和第一方模型 Gateway 插件必须读取同一选择值，避免一个模块切生产、另一个仍留在测试环境。

RC2 固定值：

- 用户中心：`https://gapi-test.insight-aigc.com`
- 模型 Gateway：`https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1`
- 更新 Origin：`https://updates.insight-aigc.com`

配置中同时登记生产值，便于后续原子切换：

- 用户中心：`https://gapi.insight-aigc.com`
- 模型 Gateway：`https://gapi.insight-aigc.com/insight-harness-llm-gateway/v1`

非预发布版本必须增加发布门禁：如果客户端服务环境仍为测试，稳定版构建应失败。GitHub OIDC/STS Gateway 属于 CI 发布基础设施，不会打入客户端，本次继续使用已验证的测试 Gateway。

## 品牌主题

所有因赛AI自研界面使用同名 Token `--insight-primary: #315dfb`。浅色和暗色模式的品牌主色保持一致；hover、focus、disabled 可以使用派生颜色或透明度，但主操作按钮、进度条和激活态不得回退到当前的 `#315efb`、`#6d8cff` 或其他紫色。

覆盖范围包括 Shell 登录页、启动状态、更新窗口、左下角更新入口、第一方账号集成、Windows 应用菜单、About 窗口、插件恢复和安全模式。品牌图形可以保留层次和阴影，但主色起点必须是 `#315dfb`。上游 Harness 自身 Token 不在本次修改范围。

## 关于窗口

新增一个单实例、只读的本地 BrowserWindow：

- 内容尺寸约 `380 × 312`，不可调整大小、不可最大化；
- 标题为“关于因赛AI”，复用原生窗口标题栏；
- 复用正式应用图标，视觉尺寸约 `58 × 58`；
- 内容居中，使用紧凑字距和稳定段落间距；
- 重复点击菜单项时聚焦已有窗口；
- 页面只加载打包内的 `about.html`，禁止外部导航和新窗口。

窗口文案：

```text
因赛AI

Powered by InClaw & OWL
版本 1.0.0-rc.2

发布于 2026年9月10日

© 因赛AI
```

版本读取 `app.getVersion()`；发布日期使用与版本一同维护的 ISO 日期元数据，并在 Renderer 中按中文格式显示。版本和发布日期不在 React 组件中写死。

macOS 在应用菜单顶部增加“关于因赛AI”；Windows 自定义应用菜单顶部增加相同入口。两个入口执行同一个受信任 Main 命令。

## 主动检查更新

菜单“检查更新…”调用统一 Main helper。Helper 先启动 `UpdateManager.check(true)`，再打开或聚焦更新窗口，使页面首次读取状态时已处于 `checking`，避免先显示“检查客户端更新”及二次按钮。

检查状态显示“正在检查更新…”和使用 `#315dfb` 的不确定进度条。检查完成后继续复用现有状态机：无更新显示“已经是最新版本”；有更新显示真实当前版本、目标版本、下载更新、下载完整安装包和跳过版本。左下角更新入口仍只在发现可信新版本时出现，点击该入口只展示当前状态，不重复检查。

本次不提供“取消检查”按钮。关闭窗口仅关闭展示，不伪装成取消网络请求。

## 安全与错误处理

- About 页面保持 `contextIsolation`、Renderer sandbox、禁用 Node 集成并限制本地 URL。
- 新的 Windows 菜单命令继续经过现有 `DesktopMenuCommand` 白名单和 IPC sender 校验。
- 主动检查失败时由现有 UpdateManager 进入可重试 error 状态；菜单命令不得吞掉窗口加载错误。
- 服务环境配置不从 Renderer、URL 参数、用户设置或未受信任环境变量读取。
- 生产切换仍使用独立 Cookie partition、`auth/production.json` 和环境参与计算的账号 scope，不复用测试凭据。

## 验收

本地自动化必须覆盖：服务配置一致性、Stable 测试环境阻断、品牌 Token、About 窗口约束和文案、跨平台菜单命令白名单、菜单触发 `check(true)` 的调用顺序、checking 不确定进度条、原有更新状态行为不回归。

本地人工验证使用 DEV 包检查登录主题、About 窗口、菜单和 checking 状态；使用 Candidate 目录包只检查资源、版本、渠道和配置，不把本地未签名包作为钥匙串验收依据。全部通过后才允许把版本提升为 `1.0.0-rc.2` 并触发 GitHub Actions。最终升级能力必须由当前已安装的云端 RC1 更新到云端签名、公证并推广的 RC2 来证明。
