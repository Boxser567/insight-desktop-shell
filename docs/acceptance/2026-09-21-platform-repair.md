# 平台修复验证记录

## 代码状态

- Shell：`codex/rc15-platform-repair-20260921`，功能提交 `84e0c07`。
- Core：`codex/windows-console-repair-20260921`，功能提交 `14fbe92786`，测试启动目录修正 `be346c8169`；从已发布 Runtime 提交创建隔离 worktree，没有合并其它开发分支。
- 保持 Electron 44.0.0，最低支持 macOS 13。没有修改生产指针，没有发布新的 Runtime 或安装器；Shell 当前锁定的 Runtime 仍是 RC15 基线，Windows 修复必须通过新 Runtime 打包后才进入客户端。

## 已完成验证

Shell 类型检查、Desktop Integration 类型检查、`npm run build:prepared`、`npm run prepare:bundled-profile` 和 `git diff --check` 通过。认证、更新源及管理器、签名发布清单、macOS 元数据合并、Profile 迁移、安装修复、Windows 打包与现有 NSIS 兼容卸载路径的专项测试通过。

Profile 测试覆盖第 2–7 代升级到第 8 代、归一化版本依赖、包清单缺失、过期锁文件、重复执行及无关插件保留。迁移使用已有 Windows 中文路径清理实现，清理配置与包后再启动 Harness。

认证测试覆盖离线重置无需远程注销、重置抢占在途恢复、凭据读取失败、清理失败后可重试、IPC 来源校验，以及诊断文本不泄露令牌或异常原文。重置范围仅限认证凭据和认证分区，不是删除整个用户目录。

Core 本地 112 项专项测试通过，12 项 Windows 专属测试在 macOS 跳过。Core 提交和推送 hooks 的 lint、Host 构建及 Host/Client 类型检查通过。

[Windows 原生测试运行 35571053449](https://github.com/Boxser567/insight-harness-core/actions/runs/35571053449) 全部通过：9 个文件、84 项测试。三种权限模式各执行 20 次全新 PowerShell；普通后代及两种受限子进程的控制台窗口句柄均为空；输出、二进制管道、取消、进程树回收和 ACL 拒绝行为通过。首轮测试的两项失败来自测试以临时目录为 cwd 加载源码模块，修正 cwd 后重跑通过，未放宽断言。

## 已知基线检查问题

Core `pnpm run doc-sync`：40 项通过，1 项失败。失败为 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` 的生成目录过期，在未修改的已发布 Core worktree 执行 `pnpm run verify-client-catalog` 同样复现。此项没有在平台修复中顺带重写；不得将完整 doc-sync 描述为通过。

## 下一阶段：安装包验收

1. 从上述 Core 提交构建独立候选 Runtime，验证产物架构、提交和摘要，再接入 Shell 测试构建。不得复用旧 Runtime 并宣称包含 Windows 修复。
2. Windows 10/11 使用实际安装器分别覆盖旧版和全新安装，三种权限模式各执行 20 次 Pwsh；观察任务栏无频繁新增/移除条目、无黑窗口、无 App 退出。自动化服务会话不能替代桌面视觉验收。
3. 使用带旧 GenUI/Market 依赖和缺失包的用户数据覆盖升级，验证登录后直接进入 Harness，不出现插件启动修复页。无需手动卸载或删除 APPDATA。
4. Mac Intel/Apple Silicon、macOS 13+ 完成覆盖安装、登录及离线重置。确认 Info.plist 最低版本为 13.0、latest-mac.yml 为 Darwin 22.0.0，两个架构元数据一致。macOS 12 已无法打开的安装只能升级系统或手动恢复兼容旧包。
5. 受影响 Mac 的网络问题尚缺原始错误码。恢复入口及脱敏诊断已实现；若清理认证状态后仍无法登录，使用新增 origin/endpoint/错误码定位网络原因，不能宣称所有网络故障已修复。

上述验收通过后，再选择发布版本、生成正式资产和推广更新指针。
