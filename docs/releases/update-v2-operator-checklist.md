# Desktop Update v2 操作清单

本清单用于 `v1.0.0-rc.18` 桥接、按目标测试最终版本、拒绝失败版本，以及把同一批
已验收字节转为 Stable。任何签名、摘要、身份、兼容或 CDN 门禁失败都必须停止，禁止
覆盖 tag、Release Asset 或 OSS 不可变对象。

## 0. 本地与合入门禁

- [ ] 当前分支已合入 `main`，工作区干净，`package.json`、Runtime 锁和兼容声明已审核。
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build:prepared`
- [ ] `node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json`
- [ ] `node scripts/verify-publish-workflow.mjs .github/workflows/publish-update.yml scripts/github-oss-client.mjs`
- [ ] `node scripts/verify-release-v2-workflow.mjs .github/workflows/release-v2.yml`
- [ ] `node scripts/verify-publish-v2-workflow.mjs .github/workflows/publish-update-v2.yml`
- [ ] `git diff --check`

## 1. 发布 rc.18 桥接包

旧 `.github/workflows/release.yml` 与 `.github/workflows/publish-update.yml` 在 rc.18 后只
用于桥接维护，不再创建新的日常 Candidate。

- [ ] 从已审核提交创建短期分支，设置 `package.json` / lock / policy 为
  `1.0.0-rc.18`、`candidate`、`optional`。
- [ ] 运行 `Release desktop installers`：`candidate_tag=v1.0.0-rc.18`，`target=all`。
- [ ] 核对三端签名/公证、Runtime 测试、Manifest 和 Draft 资产。
- [ ] 运行 `Publish desktop updates` 的 `stage`，然后以精确版本确认执行 `promote`。
- [ ] 在 rc.17 的 macOS arm64、macOS x64、Windows x64 实机验证自动发现、下载、安装、
  重启和 userData 连续性。
- [ ] 确认 rc.18 首次启动写入 `candidateOptIn=true`，但启动、六小时和恢复定时任务只检查
  Stable；Candidate 只在用户点击“检查内测更新”后执行。
- [ ] 冻结 `desktop/candidate/current.json` 在 rc.18。失败时废弃 rc.18 并使用更高 legacy
  RC，禁止替换 rc.18 字节。

## 2. 初始化最终版本并按目标构建

`Build desktop v2 target` 输入为 `version` 和一个 `target`：`darwin-arm64`、
`darwin-x64` 或 `win32-x64`。第一次运行会创建不可移动的 `v<version>` tag 和 Draft；
之后只能从该 tag 补齐目标。tag 创建后不允许再修改该版本源代码。

对当前需要测试的单一目标执行：

- [ ] 运行 `Build desktop v2 target`，填写最终 SemVer（例如 `1.0.0`）和目标。
- [ ] 确认 Draft 资产全部以 `<target>--` 开头，且含安装包、更新元数据、blockmap、
  `insight-target.json` 和签名。
- [ ] 确认重复运行只验证或补齐缺失资产；同名不同摘要必须失败，禁止 `--clobber`。
- [ ] 记录 workflow run URL、tag commit、Runtime tag/commit、Target Manifest SHA-512 和安装包摘要。

测试阶段可以只构建一个端；不要为了单端问题提前构建另外两端。Stable 转正前才要求三个
目标全部完成。

## 3. 投放和验收单一 Candidate 目标

在 `Publish desktop v2 updates` 依次运行：

1. `command=stage-target`，填写精确 `version` 和 `target`。此动作只写入不可变目标目录，
   不改变客户端指针。
2. `command=publish-candidate`，填写相同版本和目标。此动作校验恢复基线兼容性，然后只更新：
   `desktop/candidate-v2/<target>/current.json`。
3. 测试者在“关于因赛AI”中显式开启“接收内测更新”，点击“检查内测更新”。Candidate
   不应产生红点、后台检查或主动通知。
4. 完成干净安装、覆盖安装、上一接受版本到当前版本、连续三次重启、主题、完整安装包恢复、
   userData、账号、会话、工作区、设置和插件验证。
5. `command=accept-target`，填写相同版本和目标。验收记录包含操作者、run、时间、目标与
   Target Manifest 摘要，写入后不可覆盖。

任一目标失败时运行 `reject-version`，填写精确版本确认和简短原因。拒绝不会删除资产或回滚
指针；修复必须使用全局更高的最终 SemVer。

## 4. 转为 Stable（不重新构建）

- [ ] 三个 Candidate 指针均指向相同版本。
- [ ] 三个不可变验收记录均存在且摘要匹配。
- [ ] 三个 Target Manifest 的 Shell commit、Runtime、兼容声明和版本完全一致。
- [ ] Candidate `writesDataSchema` 可由当前 Stable 读取；首个 Stable 前由签名 rc.18 桥接包读取。
- [ ] 运行 `Publish desktop v2 updates`：`command=promote-stable`、`target=none`、
  `version=<精确版本>`、`confirm_version=<精确版本>`。
- [ ] 确认发布器生成并签名 Release Index、追加到 GitHub Draft 和 OSS，先公开 GitHub Release，
  最后写入 `desktop/stable/current.json`。
- [ ] 确认 Stable 客户端能自动发现；已安装相同 Candidate 字节的用户显示“当前版本已转为正式版”，
  且不重新下载。

## 5. 公网与证据

逐项保存响应头、正文摘要与时间：

- `https://updates.insight-aigc.com/desktop/candidate-v2/darwin-arm64/current.json`
- `https://updates.insight-aigc.com/desktop/candidate-v2/darwin-x64/current.json`
- `https://updates.insight-aigc.com/desktop/candidate-v2/win32-x64/current.json`
- `https://updates.insight-aigc.com/desktop/stable/current.json`
- `https://updates.insight-aigc.com/desktop/releases/v<version>/insight-release.json`
- `https://updates.insight-aigc.com/desktop/releases/v<version>/targets/<target>/...`

- [ ] 指针在 60 秒窗口内收敛，版本目录保持一年 immutable。
- [ ] 安装资产支持 HTTPS、HEAD 和 Range，无重定向或字节改写。
- [ ] CDN 下载摘要与 Target Manifest 完全一致。
- [ ] 报告中不包含更新私钥、OIDC Token、STS 凭证、用户路径或完整异常响应。
- [ ] rc.17 仍能通过冻结的 legacy Candidate 指针到达 rc.18。

只有以上证据齐全后才清理不再被 legacy 或 v2 指针引用的旧 Draft/Release；不得先删除再验证。
