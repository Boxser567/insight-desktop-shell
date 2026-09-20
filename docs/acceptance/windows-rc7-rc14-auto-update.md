# rc7 → rc14 单机自动升级验收准备

状态：rc14 手动覆盖升级已由用户确认成功、会话保留。自动升级尚未开始。用户同意复用现有 OSS/CDN 做内测，要求避免主动弹窗并尽量减少对 Mac 的影响。

## 已确定的发布方式（2026-09-20）

- 复用 `https://updates.insight-aigc.com`，不要求新增域名或修改单机更新配置。
- Candidate 的 `desktop/candidate/current.json` 是跨平台共享指针，当前不能只向一台 Windows 宣告版本。
- 仅 Windows 的 Manifest 会导致 Mac 检查时报缺少目标产物；因此补齐 rc14 全平台产物并签名后再 stage/promote，不改更新协议。
- 已触发全平台构建：https://github.com/Boxser567/insight-desktop-shell/actions/runs/35493516218
  源码为 `edeb64316641f08604f0d13be82aa41d68448b63`，与已手动验收的 Windows run 35491806028 相同。重新构建的安装器不能假定与之前逐字节相同；自动验收应记录新产物哈希。
- 发布策略保持 `optional`、最低支持版本 `1.0.0-rc.1`，不移动 Stable 指针。
- rc7 已有启动后 15–30 秒和每 6 小时的后台检查；不能声称只有点击检查才访问更新源。
- rc7 的 `autoDownload=false`、`autoInstallOnAppQuit=false`；更新 IPC 只广播状态，更新窗口由用户操作打开。现有普通更新入口不等于主动弹窗。
- Mac 可能出现非阻塞更新入口，手动检查也可发现 rc14；不承诺 Mac 完全不可见。无需为本次验收新增客户端通知机制。
- 构建完成后须校验完整清单、签名、各平台文件与策略，再上传 OSS、核验 CDN 并切换 Candidate 指针。目前尚未上传或切换。

## 更新源就绪标准

`desktop/releases/v1.0.0-rc.14/` 中包含完整全平台产物及签名清单；签名与客户端已有公钥匹配。指针与 Manifest 版本一致，Windows 的 `latest.yml`、安装器和 blockmap 哈希正确。沿用发布工作流验证，不绕过签名、TLS 或覆盖不可变资产。

## 数据保护与执行顺序

1. 条件就绪前保持 rc14，不卸载。
2. 完全退出后备份 `%APPDATA%\insight-desktop` 整个目录。此路径与 `%LOCALAPPDATA%\Programs\insight-desktop` 安装目录不同。
   账号及 Harness 数据在 `insight\accounts\<scope>\` 下；工作区外部业务文件保留原位置。备份留在用户电脑，不上传账号数据。
3. 不让旧 Core 直接处理唯一一份 rc14 数据。保留原目录的离线副本，测试可使用单独的新数据目录状态和一条可识别的测试会话；旧会话保持性已有手动升级证据。
4. 更新源确认就绪后，按完整步骤正常卸载 rc14、安装原版 rc7；保留默认更新配置。
5. 启动 rc7，确认测试会话，保持运行，从客户端检查更新。必须明确显示 rc14，再下载、安装、重启。不得手动关闭客户端或杀进程来帮助通过。
6. 保存主安装器与兼容卸载器两份日志；确认 rc14 版本、测试会话、基本对话、无遗留升级进程。区分自动重启与手动启动。
7. 核验 `resources/update-distribution.json` 与发布内容一致；保留备份，完成退出后的数据恢复计划，不覆盖正在写入的数据。

此文是准备清单，不是让用户现在执行卸载的指令。全平台构建、签名、OSS/CDN 和 Candidate 指针核验完成后，才通知用户执行。
