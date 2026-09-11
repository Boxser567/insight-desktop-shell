# Windows 与 macOS 窗口装饰隔离设计

日期：2026-09-11

## 背景

Windows 更新窗口继承了应用菜单，固定 `480 × 200` 高度因此被菜单栏侵占，正文与按钮发生重叠。Windows 主窗口同时使用透明的 Electron 原生标题栏覆盖层和 Harness 页面内容，页面中的同位控件会透过覆盖层显示，形成最小化、还原和关闭图标重叠。

这些问题不能用一套跨平台窗口参数统一处理。macOS 使用全局应用菜单和原生交通灯；Windows 使用每窗口菜单、原生 Caption Controls 和 Shell 自有的下拉菜单按钮。

## 已批准方案

采用原生 Windows Caption Controls，不新增自定义最小化、最大化或关闭 IPC。

- 更新窗口由 `480 × 200` 调整为 `480 × 240`，最小尺寸同步为 `480 × 240`。
- Windows 的更新、关于和插件恢复窗口设置 `autoHideMenuBar: true`，并在创建后调用 `setMenu(null)`，确保按下 Alt 也不会重新显示应用菜单。
- macOS 不调用 `setMenu(null)`，继续使用系统全局应用菜单；不修改交通灯、窗口按钮位置或 macOS 标题栏行为。
- Windows 主窗口保留 `titleBarStyle: 'hidden'` 与 Electron 原生 Caption Controls，把透明 `titleBarOverlay.color` 改为与当前明暗主题一致的不透明背景，遮住其下方的 Harness 页面控件。
- Shell 自有下拉菜单按钮继续位于原生 Caption Controls 左侧；它不是最小化、最大化或关闭按钮。
- 不调整更新状态机、下载、验签、安装触发、macOS 更新窗口内容或产品主题色。

## 跨平台编码约束

后续修改 `BrowserWindow`、菜单或标题栏时必须遵守：

1. Windows 的 `autoHideMenuBar`、`setMenu(null)`、`titleBarStyle`、`titleBarOverlay` 和 Caption Controls 预留空间只能位于明确的 `process.platform === 'win32'` 分支。
2. macOS 的全局菜单、交通灯、`setWindowButtonVisibility` 和 `setWindowButtonPosition` 只能位于 Darwin 分支，不得因修复 Windows 子窗口而关闭 macOS 应用菜单。
3. 二级窗口必须逐项决定是否继承 Windows 菜单；只设置 `autoHideMenuBar` 不等于禁用菜单，禁止菜单的窗口还必须设置 `setMenu(null)`。
4. 使用透明 `titleBarOverlay` 前，必须确认 WebContents 在 Caption Controls 区域没有可见控件；无法证明时使用随主题切换的不透明覆盖层。
5. 窗口固定尺寸变化必须同时检查 Windows 菜单栏占用、系统缩放、长文案以及 macOS 内容区，不得只在当前开发平台验收。
6. 每次窗口装饰变更至少包含 Windows 与 Darwin 两组配置断言；发布前分别完成目标系统人工截图验收。

## 安装性能边界

当前 Windows 安装包包含约 5.6 万个文件，Core Runtime、内置 Profile 和 Shell 依赖合计约 1.25GB。安装耗时主要来自解压、大量小文件创建和 Windows Defender 扫描。原子卸载兼容修复解决升级失败，但不能消除首次安装的文件系统成本。

1.0 阶段不切换 `asar`、不把 Runtime/Profile 改为启动时解压归档，也不降低卸载回滚安全性。安装性能作为后续独立项目处理，先采集首次安装、覆盖安装、卸载和 Defender 开关前后的分段耗时，再决定是否调整资源归档与压缩策略。

## 验收标准

- Windows 更新窗口为 `480 × 240`，无应用菜单，所有状态下正文和按钮不重叠。
- Windows 关于窗口和插件恢复窗口无应用菜单；按 Alt 不会恢复菜单。
- Windows 主窗口只显示一套原生最小化、还原和关闭按钮，明暗主题下均无底层图标透出。
- Windows Shell 下拉菜单按钮仍可使用，且与原生 Caption Controls 不重叠。
- macOS 更新窗口仍使用系统全局菜单语义和原生交通灯，没有 Windows 专属窗口配置泄漏。
- 更新窗口、关于窗口、Windows 标题栏测试、完整测试和 TypeScript 检查通过。
