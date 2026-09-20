# 因赛品牌与原生侧栏迁移

用户已明确要求：首页使用因赛 Logo 与“以专业为引擎，让团队与AI共成长”，移除预览标记；卸载内置 better-sidebar；Windows 任务栏标题为“因赛 AI”。

1. Core 提供首页标题 slot，默认品牌保持原状；因赛通过 Logo/title slots 接入，不覆盖 DOM 或翻译字典。
2. Profile 版本 6 停止打包 better-sidebar，升级版本 2–5 删除旧依赖和加载入口，保留自定义插件、设置及会话。移除市场与恢复流程中的必需插件保护，重新生成冻结锁。
3. Windows 主窗口设置并保持“因赛 AI”原生标题。
4. 验证 Core 首页默认与替换渲染、旧 Profile 迁移、Shell 类型与测试、模板构建及 Harness 冒烟。Windows 任务栏需真实 Windows 安装包验收。

不修改现有登录页和启动页未提交内容。Core 改动随下一次 Runtime/客户端发布交付。

## 已完成验证

- 首页通过公开的 `conversation.hero.brand.mark/title` 接入；原标题和标签作为 Core 默认 fallback 保留。
- Profile 6 不再预装或强制恢复 better-sidebar，旧版本 4/5 迁移测试覆盖依赖、bundle 和安装目录删除、自定义插件与配置保留；版本 2/3 的迁移路径继续通过。
- 冻结 Profile 锁从 177 个包缩减为 13 个包，移除旧侧栏所独占的依赖树。
- Shell 108 个测试文件、697 项测试通过，Shell/集成类型检查与客户端构建通过。
- Core 会话界面 31 个文件、396 项测试；原生侧栏/文件/文档预览 47 个文件、440 项测试通过。
- 隔离 Electron 真界面（模拟认证、无模型请求）通过登录、首页 Logo/文案/无标签、单一侧栏、账号菜单、设置、市场保护、退出登录和第二账号隔离验收。截图：`/private/tmp/insight-brand-release-desktop-smoke-20260914/workspace-open.png`。文件面板由 Core 测试覆盖；本次 Electron 验收保持空会话，未完成真实文件面板交互验收。
- Windows 标题创建及页面更新保持“因赛 AI”的代码检查通过；真实 Windows 任务栏与 Alt+Tab 仍是安装包人工验收项。

## 原生能力范围

当前官方原生右侧栏提供会话级文件浏览和文档预览。better-sidebar 自带的编辑器、终端、Git 和嵌入式浏览器面板随插件移除，不应把原生 Sidebar 等同于旧插件全部功能。没有新增替代插件或自行重写这些面板。

## 安装包验收

1. 新会话展示因赛 Logo 和完整指定文案，无“探索未至之境”或“预览版”；窄窗口可换行，无裁切。
2. 新装及 rc.10 升级后都不加载 better-sidebar，原生侧栏、已有会话/工作区、账号菜单正常；市场不再保护旧插件。
3. 在已有会话中打开原生文件面板并预览工作区文件。
4. Windows 启动、登录、进入会话、退出登录后，任务栏和 Alt+Tab 均有“因赛 AI”标题；系统任务栏需处于显示标签的设置。
5. Gateway 真实服务容量/路由验收仍按前次评审报告执行，不由本次品牌测试替代。

## Runtime 交付

三平台 CI 全部成功：https://github.com/Boxser567/insight-harness-core/actions/runs/34827862153 。
Runtime 预发布 `insight-runtime-v0.1.5-rc.2-insight.1`，Core commit `42ddfb640a97d551e458613d11ddb73936d15e11`。Shell `core-runtime.lock.json` 已更新全部平台 URL、commit 与 SHA-256；本地 Apple Silicon 归档已下载并独立校验，标准构建使用此 Release 产物。该 Runtime 同时包含前次 Gateway 的生成上限/鉴权提示修复。

客户端仍为 rc.10，未发布新客户端安装包，未更改 OSS/Candidate/Stable 指针。

锁定 Release 产物复验：标准 `npm run build`、Profile 刷新、Shell 全量 697 项、Packaged Harness 启动/模型目录/工作区/会话/20 秒稳定性，以及真实 Electron 首页/账号隔离均通过。
