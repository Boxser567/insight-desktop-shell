# Windows RC8 → RC10 更新再次失败：初步调查

## 当前结论

未确认 Windows 现场根因，不能把源码检查或三平台构建成功视为真实覆盖升级通过。用户反馈的重复失败重新打开此发布阻断项。本次仅增加只读现场诊断工具，不修改或发布安装器。

## 已确认的代码事实

- 截图组合对应 NSIS 旧版本卸载阶段；“无法关闭”有多个触发点，单凭该文案无法判定残留进程。
- `app-builder-lib@26.15.3` 的 `include/installUtil.nsh` 中，旧卸载器返回非零会连续重试；第六轮弹 `appCannotBeClosed`。用户取消后进入卸载结果处理。进程检测和文件替换也复用此提示。
- 当前产品 `DshRecoverFailedAtomicUninstall` 在 `customUnInstallCheck` 中，位于上述重试/弹窗之后。此前普通删除回退没有解决前置重复弹窗，这是结构上可确定的缺口。
- RC10 tag 已包含 `DshStopLegacyProcesses` 和 app-builder-lib 补丁。仅有这段源码不代表现场实际运行的安装器、卸载器或进程属于预期版本。
- 清理依赖注册安装目录及 CIM 的 ExecutablePath。读取失败被 SilentlyContinue 隐藏，空查询可能被当成“没有进程”，三次失败也仍继续卸载；缺乏足够现场诊断信息。
- 旧卸载器带 `--updated` 时，逐文件从安装目录 Rename 到 `$PLUGINSDIR/old-install`，失败后回滚并 Abort。文件占用、权限、路径等需现场区分；错误码 2 并非某个 Windows 系统错误的直接证明。
- 普通删除回退使用的仍是旧卸载器，且要求旧主程序和临时卸载器仍存在，不能保证修复历史残缺安装目录。
- 截图一底部可见 rc.7；需用户确认是历史截图还是本次现场。不能据此断言注册表损坏或 RC8 安装成功。

## 与上次判断的区别

上次复盘把“残留进程”作为主要解释，但此前未完成 Windows 真实旧版本升级验收。当前证据表明错误文案是通用错误出口，因此该根因仍是假设，清理重装只能改变现场，不能证明更新链路修复。

上游相同报错案例： https://github.com/electron-userland/electron-builder/issues/9593 。提交者后续称与较大的解包依赖目录有关；这是独立案例，不应直接套用到本产品。

## 下一步现场取证

运行 `scripts/diagnose-windows-update.ps1`：仅读取安装注册表、安装目录权限/二进制版本与 SHA-256、相关进程路径、更新缓存安装器版本/hash、TEMP 位置与 PowerShell 策略；只写一份 JSON 报告，不结束进程、不删除文件、不修改注册表或权限、不读取账号/会话内容。

在失败弹窗保持打开时，以管理员 PowerShell 执行以减少 CIM 路径不可见；报告记录本次诊断是否提权。安装器本身是否提权仍需用户告知。可通过 `-InstallDirectory` 补充自定义路径。报告可能包含 Windows 用户目录名和本机路径。

本地仅完成 ASCII/只读命令检查，尚未在 Windows PowerShell 5.1 实际运行；不要将该检查描述为 Windows 执行验收。

拿到报告后区分：源版本/注册信息残留、旧安装目录存活进程、权限差异、非系统盘与临时目录、旧卸载器自身故障。必要时进一步采集 Process Monitor 中该卸载器失败的具体文件操作，再决定修复；不扩大为全盘清理或直接删除卸载注册表。

## 现场报告复核（17:56）

- 用户已执行只读采集，Windows PowerShell 5.1 / 64 位 / 管理员；报告无注册表或 CIM 查询错误。诊断程序提权不等于安装器也提权。
- 注册记录、主程序 FileVersion、卸载器 FileVersion 均为 `1.0.0-rc.8`。HKCU 32/64 视图返回同一路径/身份，不能把这两条读数当成两份不同安装。卸载项 InstallLocation 为空，但独立应用注册项存在，且 UninstallString 与之吻合；符合当前路径解析，不是本身的缺损证据。
- 安装目录 `%LOCALAPPDATA%/Programs/insight-desktop` 与 TEMP 都在 C 盘，未发现跨盘搬移条件。
- 安装目录顶层 ACL 给当前用户、管理员和 SYSTEM 完全控制；未检查每个子文件的 ACL，也未获得安装器令牌权限。
- 进程快照仅命中 rc.10 更新安装器，未发现安装目录中的存活应用进程；20 个系统进程路径不可用，所以单次快照不能证明整个失败过程中始终没有占用。
- pending 安装器是 `1.0.0-rc.10`，271999350 bytes，SHA-256 `58c7e3580a79f9d2f0341ca1d3ae878fa03e0514cfba0bbe8aa6ff2e16d203c4`，与 GitHub RC10 Release asset 的 digest/size 精确一致。排除下载到错误发布包或包字节损坏这一方向。
- ManifestError 显示中文被按系统代码页误读。诊断脚本已给 Get-Content 增加 `-Encoding UTF8`；该错误不能作为实际 package.json 损坏的证据，无需用户仅为此重新采集同一报告。

下一步需安装失败瞬间的事件记录：使用 Microsoft Process Monitor 捕获一次“重试→再次提示→取消→错误码2”，至少保留 rc10 setup、old-uninstaller.exe、Uninstall 因赛AI.exe 的文件/进程事件。查看首个导致退出的文件操作、Result、目标路径和进程退出状态，才能区分共享冲突、权限、路径、旧卸载器提前退出及回退未生效。不要把所有 NAME NOT FOUND 事件直接认定为根因。

参考工具：https://learn.microsoft.com/en-us/sysinternals/downloads/procmon 。报告原件和用户 SID/用户名不纳入仓库。
