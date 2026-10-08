# macOS Dev 窗口主题与阴影闪烁修复

用户安装 Core 0.2.1-alpha.1 的 Dev DMG 后，发现主窗口和被唤起的窗口阴影闪烁，“关于因赛AI”原生标题栏持续切换主题。

## 根因与复现

Shell preload 只传递页面的深浅色布尔值，Main 使用 `nativeThemeSourceForResolvedTheme()` 根据持久化设置、当前 Electron 深浅色和页面颜色推测主题来源。

当读取到的设置是 `system`、macOS 为深色、Core 页面为浅色时，会出现循环：Electron 被强制设为浅色；下一次页面媒体事件中，两者颜色一致，Main 又将 Electron 设回 `system`；系统深色重新触发页面事件，Main 再设为浅色。原生标题栏及窗口阴影因此持续重绘。Core 新版已通过 `html[data-ds-theme-source]` 发布 `light`、`dark`、`system`，旧 Shell 未读取该信息。

使用相同 Electron 44、真实 Shell Main/preload/Renderer、模拟登录及独立数据目录复现：窗口空闲约 12 秒，记录到 971 次主题 IPC 和 971 次 `nativeTheme.updated`，来源交替为 `light` / `system`。证据：`/private/tmp/insight-theme-flicker-before-20261008/theme-observation.json`。

此前桌面冒烟只确认一次主题状态和静态截图，没有连续观察原生主题事件；因此没有发现这一循环。

## 修复

- preload 观察 Core 发布的主题来源，随页面深浅色一起传给 Main；来源或颜色未变化时不重复发送 IPC。
- Main 按明确来源设置原生主题，删除根据颜色相等与否推测 `system` 的逻辑；旧 Core 未发布来源时按持久化偏好处理。
- 对相同 `nativeTheme.themeSource` 不重复赋值，包括设置文件监听链路。
- 保留 IPC 的受信页面校验，新增主题来源 allowlist 校验。

Electron 官方说明原生主题会影响 macOS 窗口框架和页面的 `prefers-color-scheme`，因此主题来源必须保持明确：[nativeTheme API](https://www.electronjs.org/docs/latest/api/native-theme)。

## 验证

- 新增 3 项 preload 回归：主题来源传递、重复 DOM/媒体事件去重、来源改变但颜色不变、旧 Core 回退；修复前失败，修复后通过。
- Shell 全量 127 个文件、917 项通过；Main/Renderer 类型检查和 electron-vite 构建通过。完整测试显式选择 Core 0.2.1-alpha.1 Runtime，并允许测试本地回环服务运行。
- 真实 Electron 切换浅色、深色、跟随系统、再次浅色，每种状态采样 30 次；主页面、关于、更新窗口配色一致，空闲期间原生主题变化全部为 0 次。
- 同次桌面回归覆盖工作区、12 个技能选择与移除、退出登录及第二账号分区，全部通过。

修复后证据：`/private/tmp/insight-theme-flicker-after-20261008/theme-stability.json`。回归使用隔离文件和测试登录响应，没有请求真实模型。
