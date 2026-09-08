# Desktop 发布说明

## 当前发布状态

截至 2026-09-08，桌面客户端尚未对外发布首个版本。已批准的生产更新机制是自有 HTTPS 域名后的 OSS/CDN；客户端不以 GitHub Releases 作为自动更新源。

客户端 Phase A 已完成：生产运行时只读取 `https://updates.insight-aigc.com` 的渠道指针与已签名版本目录，动态绑定 Generic Provider；模拟更新源已经删除。登录前和登录后的下载入口仅在发现真实可信更新后显示，更新窗口展示真实目标版本，并可从已验证 Manifest 打开同源完整 DMG/NSIS。

仓库的生产发布链已经按两阶段模型实现：

- 手动 `workflow_dispatch` 只接收 `candidate_tag`，用于 Candidate；
- 推送 `v*` tag 走 Stable；
- 三个平台构建后，`publish` job 在 `desktop-release` Environment 中生成签名 Manifest，只创建 GitHub Draft，不读取 OSS 凭证、不公开 Release；
- 本地发布器从 Draft 下载并复验同一批字节，`stage` 只写不可变版本目录，`promote` 才公开 GitHub Release 并最后提交 `current.json`；
- 版本化安装资产、YAML、blockmap、产品 Manifest、签名、CDN HEAD/Range/缓存/摘要验证和渠道指针单调性均已有自动门禁。

截至 2026-09-08，代码与本地测试已经完成，但尚未运行真实 GitHub Draft、OSS 上传和三平台安装演练。生产 Origin 的 CDN 到私有 OSS 鉴权已响应成功，`stable/current.json` 与 `candidate/current.json` 均尚不存在。真实 Candidate N→N+1 和 Stable 安装证据齐全前不得执行 Stable `promote`。

## 必读资料

- [客户端构建运行手册](client-build-runbook.md)：构建步骤、停止条件和人工门禁的权威说明。
- [桌面客户端 OSS 更新分发设计](plans/2026-09-08-desktop-update-oss-distribution-design.md)：首发更新源、对象布局、信任边界和原子发布顺序。
- [桌面客户端更新与上游管理方案](plans/2026-09-03-desktop-update-and-upstream-policy-design.md)：更新状态机、强制更新和数据兼容策略。
- [2026-08-27 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md)：Runtime、Profile、Sidebar、平台构建和上传故障的历史原因。

重大 Core、Shell、默认插件、工具链或上游更新前必须阅读 Runbook 和相关复盘。历史临时做法不得覆盖当前脚本和已批准设计。

## 进入远程安装包构建前

必须完成客户端构建 Runbook 阶段 1–8，并保留以下证据：

- 变更范围、Shell commit、Core Runtime tag/commit、目标平台和用户数据目录已记录；
- 定向测试、`npm test`、`npm run typecheck` 和普通 build 已按变更范围通过；
- `core-runtime.lock.json` 指向资产完整、哈希和 `runtime.json` 一致的已验收 Runtime Release；
- 独立本地 DEV 应用的绝对路径和 Runtime 身份明确；
- 全新 Profile 与既有 Profile 启动正常，会话、工作区、设置和用户插件未丢失；
- 必需 Sidebar 插件已复制并注册，Markdown 和 HTML 实际在 Sidebar 内打开；
- 没有插件恢复窗口或无限启动页，并已收到明确人工验收结果。

本地阶段未通过时禁止用 GitHub Actions 继续远程调试。Shell 发布标签不得隐式升级 Core Runtime；Runtime 锁变更必须是独立、可审核的 Shell 提交。

## 一次性发布准备

1. 确认 `insight-desktop-updates` 保持私有且从未启用 Bucket Versioning。OSS 的 `forbid-overwrite` 在已启用或已暂停 Versioning 的 Bucket 中无效；发布器会主动拒绝这种配置。不要给该 Bucket 开 WORM，因为 `current.json` 是唯一需要覆盖的对象。
2. 使用专用 RAM 用户的 AccessKey，不使用阿里云主账号 AccessKey。若现有密钥属于主账号，先创建专用 RAM 身份并轮换，不把现有密钥复制到仓库、GitHub、客户端、命令参数或 `.env`。
3. RAM 策略只授予 Bucket 级 `oss:GetBucketVersioning`、`oss:ListObjects`，以及 `insight-desktop-updates/desktop/*` 的 `oss:GetObject`、`oss:PutObject`；不授予删除对象、修改 Bucket、ACL、CDN 或其他 Bucket 的权限。
4. 安装精确版本 `ossutil 2.3.0`，运行 `ossutil config credential`，在交互向导中使用 profile `desktop-updates-publisher`、认证模式 `AK` 并选择加密凭证；然后为该 profile 设置 Bucket 所在的实际 Region。不要在 shell 配置中导出 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_SESSION_TOKEN`、`OSSUTIL_CONFIG_FILE` 或 `OSSUTIL_PROFILE`。
5. 使用 `gh auth status` 确认本机 GitHub CLI 已登录且能读取/编辑 `Boxser567/insight-desktop-shell` Release。GitHub 的 `desktop-release` Environment 只保存与仓库 `build/update-signing-public.pem` 匹配的 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`；密钥不匹配会在 Draft 创建前被签名校验阻止。
6. CDN 加速域名固定为 `https://updates.insight-aigc.com`，源站为私有 OSS Bucket 并启用私有 Bucket 回源鉴权。`/desktop/releases/*` 不压缩、不改写、不重定向并支持 HEAD/Range；缓存遵守源站的一年 immutable。`/desktop/*/current.json` 遵守 60 秒缓存和重新验证。不得启用会拦截 Electron 主进程无 Referer 请求的防盗链。

建议使用以下最小 RAM Policy；`Resource` 中不要扩大到其他 Bucket：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:GetBucketVersioning", "oss:ListObjects"],
      "Resource": ["acs:oss:*:*:insight-desktop-updates"]
    },
    {
      "Effect": "Allow",
      "Action": ["oss:GetObject", "oss:PutObject"],
      "Resource": ["acs:oss:*:*:insight-desktop-updates/desktop/*"]
    }
  ]
}
```

准备完成后先执行只读检查：

```bash
ossutil config set region cn-hangzhou \
  --profile desktop-updates-publisher
ossutil version
ossutil api get-bucket-versioning \
  --bucket insight-desktop-updates \
  --output-format json \
  --profile desktop-updates-publisher \
  --ignore-env-var
gh auth status
```

示例中的 `cn-hangzhou` 必须替换成控制台显示的 Bucket 实际 Region。Bucket Versioning 的 JSON 响应必须没有 `Status`；`Enabled` 和 `Suspended` 都不通过。

## 生产发布流程

实现完成后，GitHub 工作流与本地发布器共同执行：

1. 校验 tag、渠道、版本、发布策略、Runtime 锁和发布配置。
2. 在 macOS arm64、macOS x64 和 Windows x64 各构建一次，完成签名、公证、YAML、blockmap 和安装器结构验证。
3. 汇总相同制品，生成并签名 `insight-update.json`，执行完整资产校验。
4. 创建 GitHub Draft Release 并上传同一批字节；GitHub Actions 不读取 OSS AccessKey。
5. 本地发布器从 Draft 下载全部 Assets，重新验证签名、文件集、版本和摘要。
6. 确认 OSS `desktop/releases/v<version>/` 不存在，然后上传完整不可变版本目录。
7. 从 `https://updates.insight-aigc.com` 验证 HTTPS、HEAD、Range、缓存、大小和摘要，并完成 Candidate N→N+1 或 Stable 确切制品验收。
8. 人工确认后公开 GitHub Release，再从 OSS 权威指针确认渠道版本单调递增。
9. 最后更新该渠道唯一的 `current.json`，等待或确认其在约定 TTL 内收敛并执行外部 canary。

`current.json` 是唯一生效点。其更新前的任何失败都必须保留旧指针；禁止覆盖版本目录、已发布 tag 或 Release 资产。

GitHub workflow 成功并生成 Draft 后，在仓库根目录执行暂存；下面以 Candidate 为例：

```bash
node scripts/publish-update-to-oss.mjs stage \
  --tag v0.1.2-rc.2 \
  --bucket insight-desktop-updates \
  --origin https://updates.insight-aigc.com \
  --profile desktop-updates-publisher
```

`stage` 成功只表示版本目录已上传并通过最终 CDN 复验，不会公开 GitHub Release，也不会改变客户端看到的版本。`ossutil put-object` 按安全 basename 的扩展名推导 Content-Type；最终 CDN 验证器会按文件类别拒绝缺失或异常 MIME、错误缓存、缺失 Range、重定向和字节差异。无凭证的摘要报告保存在被 Git 忽略的 `release-reports/`。

完成对应平台的确切安装包和 N→N+1 人工验收后，才执行：

```bash
node scripts/publish-update-to-oss.mjs promote \
  --tag v0.1.2-rc.2 \
  --bucket insight-desktop-updates \
  --origin https://updates.insight-aigc.com \
  --profile desktop-updates-publisher \
  --confirm-version 0.1.2-rc.2
```

Stable 使用相同命令和 `v0.1.2` / `0.1.2`。`promote` 会再次下载并校验 Draft、复验 CDN、校验权威旧指针严格递增，随后先公开 GitHub Release，再重读指针，最后写入 `current.json` 并等待最多 120 秒收敛。若公开后发生瞬时失败，可用完全相同参数安全重跑；脚本只在远端指针已经精确指向该版本时进入收敛复验，不会降级或覆盖版本目录。

## 首发专用门禁

首发没有存量客户端，不需要 GitHub 桥接版本。必须按以下顺序验证：

1. 当前仓库版本 `0.1.2-rc.1` 在 macOS arm64、macOS x64 和 Windows x64 完成干净安装。
2. `0.1.2-rc.2` 从 rc.1 在客户端内完成检查、下载、校验、安装和重启。
3. `0.1.2` 的确切 Stable 制品完成干净安装与覆盖安装。
4. 在可信 Manifest 已解析后人为让自动下载失败，确认更新窗口可以从同一版本目录下载适配架构的 DMG/EXE 并完成覆盖安装；完全禁用更新 Origin 时应安全失败。
5. 上述证据齐全后，才允许首次写入 `stable/current.json`。

## 最终安装验收

必须从 OSS 不可变版本目录或对应 GitHub Draft 下载本次确切安装包，不得用本地重建包替代：

- macOS 验证 DMG、完整 bundle 签名、Gatekeeper、公证和 stapling；
- Windows 核对产品 Manifest 摘要，接受当前预期的 SmartScreen/未知发布者提示，但必须能继续安装；
- 完成干净安装和覆盖安装；Candidate 完成 N→N+1 客户端更新；
- 验证首次启动、既有 Profile、Sidebar、会话、工作区、设置和插件清单；
- 验证登录前、Core 失败和更新错误状态仍能进入更新窗口；只有已有可信 Manifest 时才显示同源整包入口；
- 核对实际版本、应用路径、用户数据目录和 Runtime 身份。

DMG、ZIP、NSIS 和 blockmap 是不同产物层。某一格式失败时记录准确影响范围；ZIP 或 blockmap 失败时，即使 DMG 人工安装成功，也不能宣称自动更新通过。

## 发布记录

每次 Candidate 或 Stable 至少记录：

- tag、channel、Shell commit、Core Runtime tag/commit、Node 和包管理器版本；
- `Release desktop installers` run URL、attempt 和各 job 结果；
- OSS 版本前缀、最终 CDN 验证结果、GitHub Draft/Release URL；
- 安装包与更新元数据的文件名、架构、大小、SHA-256 和 Manifest SHA-512；
- 推广前 `current.json`、待发布 `current.json` 和实际提交后的响应；
- 干净安装、覆盖安装、N→N+1、同源整包兜底和数据保留结果；
- 已知的平台或格式问题、确认不受影响的范围和下一验证阶段。

完整记录可使用[客户端构建 Runbook 的模板](client-build-runbook.md#构建记录模板)。
