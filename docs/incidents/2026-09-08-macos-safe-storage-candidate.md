# 2026-09-08 macOS Safe Storage 候选版故障与验收

## 状态与验收范围

- 状态：macOS Apple Silicon 定向候选已解决并人工验收。
- Candidate：`v0.1.2-rc.3`。
- Shell commit：`ce70b86774d44ee48b9212d5b7ce4c060e7a337a`。
- Core Runtime：`insight-runtime-v0.1.1-rc.10`，Core commit `833f4246abaf3ce5fcf39c3f81a8be2499e7f434`，Core version `0.1.1-rc.2`。
- GitHub Actions：[run 34210934030](https://github.com/Boxser567/insight-desktop-shell/actions/runs/34210934030)，手工输入 `candidate_tag: v0.1.2-rc.3`、`target: macos-arm64`。
- 人工结论：从该 run 下载 DMG 并安装后，启动不再弹出 `因赛AI Safe Storage` 密码框。
- 未覆盖：macOS Intel、Windows、`target: all`、完整 Candidate Release、覆盖安装、N→N+1 自动更新和该 DMG 的完整登录/重启数据连续性回归。

本结论只关闭 macOS Apple Silicon 签名候选的钥匙串授权回归，不代表三平台发布完成。

## 现象

使用云端 `Developer ID Application` 签名、公证并 staple 的 DMG 安装后，应用启动会请求访问 `因赛AI Safe Storage`。未选择“始终允许”时，一次启动可能连续请求两次；退出后再次启动仍会重复请求。拒绝授权后登录界面可进入，但登录操作会把本地安全存储失败显示为“认证服务暂时不可用”。

## 根因证据

登录钥匙串中的旧 `因赛AI Safe Storage` 条目早于云端签名 DMG 创建。此前曾运行使用正式产品名和正式 `insight-desktop` 用户数据身份的本地未签名 Candidate；该进程首先创建了同名 Safe Storage 条目。后续 Developer ID 签名应用访问这个条目时不满足原访问控制，从而触发系统授权框。

因此，云端签名、公证本身并不是重复弹框的失败点。问题是本地快速验证错误复用了生产身份和生产钥匙串条目。

## 修复与安全处理

代码侧将安全存储拒绝与远端认证失败分离：当 `safeStorage` 不可用或用户拒绝授权时，当前登录只保留在内存，不写入明文 token，也不把成功的远端登录改写为“认证服务暂时不可用”。该会话退出应用后不会恢复，属于失败关闭而不是降低凭据保护。

验证前只删除已确认由本地未签名 Candidate 创建的精确条目：

```bash
security delete-generic-password -s '因赛AI Safe Storage' "$HOME/Library/Keychains/login.keychain-db"
```

该操作不得扩大为删除 Cookies、整个钥匙串、完整用户 Profile、会话、工作区或插件数据。删除后由云端签名应用重新创建条目。

## 构建与自动检查结果

该 run 的 Release preflight、macOS Apple Silicon 构建以及 Sonoma distribution compatibility 均成功。Apple Silicon job 完成 Developer ID 签名、Apple 公证、staple、完整 bundle 校验、DMG 校验和 artifact 上传；Sonoma job 对下载后的 DMG 只读挂载，并再次执行严格签名、分发策略和 stapling 校验。

由于 target 为 `macos-arm64`，macOS Intel、Windows 和 Publish 均按设计跳过。该 run 只生成 `macos-apple-silicon` Actions artifact，不创建 `v0.1.2-rc.3` GitHub Release。

## 同批次相关修复

- 默认窗口调整为 `1024 × 720`，最小窗口调整为 `800 × 480`，并增加低高度登录布局，避免部分 Windows 屏幕无法操作登录页。
- Candidate 与 Stable 的制品基础名统一，channel 只保留在发布策略和签名 manifest 中。
- workflow 增加 `macos-arm64`、`macos-x64`、`windows-x64` 定向候选 target；定向运行不发布 Release。
- `package.json` 和发布策略推进到 `0.1.2-rc.3`。

## 后续构建规则

1. 日常快速功能验证只运行隔离身份的 `因赛AI Dev`，禁止运行使用正式产品名、App ID/channel 或正式用户数据目录的本地未签名 Candidate。
2. Safe Storage 行为只能用云端 Developer ID 签名并完成公证的 DMG 验证；本地 DEV 无法证明该路径。
3. 单平台 Actions artifact 可以关闭对应平台候选门禁，但不得写成完整 Candidate/Stable 发布通过。
4. 发生钥匙串提示时，先比较精确条目的创建时间、签名身份、应用路径和用户数据目录，不先删除用户 Profile，也不通过明文持久化绕过安全存储。
5. 安全存储拒绝、远端认证失败和业务接口失败必须保持不同错误语义。

## Git 状态边界

`v0.1.2-rc.3` 相关的 `ac11928`、`7ce8290`、`4d57b1e`、`ce70b86` 四个提交位于 `codex/v0.1.2-rc.2-integration`，尚未进入 `origin/main`。本次验收成立后仍需通过新的 PR 合入；不得把已合并的 PR #1 当作这四个增量提交的交付证据。
