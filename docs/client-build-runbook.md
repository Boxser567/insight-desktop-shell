# 因赛AI Desktop 客户端构建 Runbook

## 适用范围

本 Runbook 是因赛AI Desktop 在 Core Runtime、Shell、默认 Profile、Better Sidebar、Electron/Node/pnpm、原生依赖、签名流程或 upstream Shell 更新后的当前构建规范。2026-08-27 的完整故障过程见 [Core Runtime 与 Better Sidebar 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md)。当历史复盘与当前脚本不一致时，以本 Runbook、当前 `package.json` 和 `.github/workflows/release.yml` 为准。

目标不是一次性跨过所有构建步骤，而是用从低成本到高成本的证据尽早发现错误。任一阶段失败即停止；修复后从该修复所影响的最便宜阶段恢复，不用重复已经成立且未被变更影响的阶段。

## 核心原则

- Shell 自主锁定 Core Runtime。升级只通过审核后的 `core-runtime.lock.json` 发生，不因 `@deepseek-ai/dsh` registry 或 Core upstream 更新而自动发生。
- Core Runtime 提供可执行 Harness、Node、pnpm 和生产依赖闭包；Shell 提供产品身份、Electron 生命周期、用户数据隔离、默认 Profile、插件恢复和安装包。
- Better Sidebar 是内置产品能力。文件存在、Profile 已复制、Utility Process 能加载、Markdown/HTML 能在 Sidebar 打开是四项独立证据。
- GitHub Actions 成功只证明 job 和产物生成完成，不能替代本地行为或最终安装包验收。
- 每轮验收必须说明 Shell commit、Core Runtime tag/commit、应用绝对路径、目标平台/架构和用户数据目录。Electron 单实例机制不得把旧进程冒充为新构建。
- 用户数据操作必须精确、可恢复。不得用宽泛删除命令清理会话、工作区、设置或插件；任何测试 Profile 变更前先记录并备份确切目录。

## 变更分类与验证起点

阶段 1 的范围与身份审计对所有变更必做。下表“最低起点”表示阶段 1 之后最早必须执行的阶段；一次变更同时属于多类时，采用成本更低、覆盖面更大的起点，并合并所有必需目标。

| 变更类别 | 最低起点 | 必需目标与说明 |
| --- | --- | --- |
| 仅文档 | 阶段 2 | 文档链接、命令存在性和 `git diff --check`；不构建应用 |
| 不涉及 Runtime 或打包的 Shell UI | 阶段 2 | 当前开发平台；定向 UI 测试后执行受影响的普通 build/DEV 行为 |
| Shell main/preload 或用户数据行为 | 阶段 2 | 当前开发平台，并覆盖受影响的 macOS/Windows 路径；必须验证既有用户数据不丢失 |
| 默认 Profile 或 Better Sidebar | 阶段 2 | macOS 本地 DEV 功能门禁；发布前再覆盖 darwin-arm64、darwin-x64、win32-x64 的包内结构 |
| Core Runtime 依赖、启动或 loader | 阶段 3 | 先在 Core 源码证明，再由三个原生 target runner 生成 Runtime；Shell 从阶段 5 接入 |
| Electron、Node、pnpm、原生依赖、签名或 workflow | 阶段 1 | 先审计平台与工具链；只在对应原生 runner 验证平台特性，发布范围决定是否扩到三平台 |
| upstream Shell 合并 | 阶段 1 | 先完成差异审计，再按被触及类别选择后续阶段，不直接从安装包开始 |

upstream Shell 合并的差异审计必须明确保护：Core Runtime 的锁定与资源路径、默认 Profile 和 Better Sidebar 初始化、用户数据隔离、App ID、产品名/安装包命名，以及 `package.json` 中 build、DEV 与各平台 package scripts。任何一项被 upstream 覆盖都先恢复并测试，再进入打包。

## 分阶段验证曲线

### 阶段 1：范围与身份审计

**输入：** 待验证提交、工作树、目标平台和预期 Core Runtime。

**执行：**

- 查看 `git status --short --branch`、目标提交范围和相关 diff。
- 记录 Shell commit、`core-runtime.lock.json` 的 tag/commit/平台哈希、Node/pnpm 版本和构建目标。
- 区分用户修改、构建输出、缓存和本轮允许修改的文件；不得为获得“干净工作树”清理不属于本轮的内容。
- upstream 合并按上一节审计产品约束。

**通过条件：** 变更类别、验证起点、必需平台、应用身份和用户数据目录均已明确，未跟踪文件所有权清楚。

**失败时：** 停止。先缩小范围或确认文件所有权，不运行安装、构建或清理命令。

### 阶段 2：定向测试与静态检查

**输入：** 已确认范围的 Shell 或文档变更。

**执行：**

- 先运行最贴近变更的单个测试文件、配置检查或文档检查。
- 源码变更运行 `npm run typecheck`；进入发布链前运行 `npm test`。
- Electron/Vite/Rollup 或 lockfile 变更必须检查每个 release runner 所需的平台原生包既在根 `optionalDependencies` 中精确锁定，也在 `package-lock.json` 中具有具体 package 节点；不能只依赖 Rollup 的传递可选依赖列表。
- 文档变更检查链接、当前脚本名和 `git diff --check`，不为文档单独构建应用。

**通过条件：** 定向断言覆盖实际失败条件，类型与静态配置一致，失败不是被跳过或被环境错误掩盖。

**失败时：** 留在本阶段修复并只重跑受影响检查。没有相关源码变化时，不重复全量测试。

### 阶段 3：Core 源码证明

**输入：** Core Runtime 依赖、loader、启动、Profile 解析或打包脚本变更。

**执行：**

- 在 Core 仓库运行能复现问题的最小测试，并让回归测试先覆盖真实失败分支。
- 执行 Core 受影响包的 build/typecheck/发布脚本静态检查；需要目标平台语义时使用对应原生 runner。
- 对 loader 变更同时验证：internal loader 成功、`ERR_MODULE_NOT_FOUND` 回退、无 internal loader、非解析错误透传和 Windows 路径。

**通过条件：** 原始失败可复现，修复后定向测试通过，构建产物包含预期代码；没有靠 Shell 覆盖文件才能工作。

**失败时：** 不发布 Runtime，不更新 Shell 锁。先在 Core 缩小根因。

### 阶段 4：目标原生 Core Runtime Release

**输入：** 已通过源码证明的 Core commit 和新的不可变 Runtime tag。

**执行：**

- 在 `darwin-arm64`、`darwin-x64`、`win32-x64` 原生 runner 生成 Runtime。
- Release 必须具有每个平台的 `.tar.gz`、`.tar.gz.json` 和 `.tar.gz.sha256`，共九项资产。
- 核对 JSON/`runtime.json` 中 Core repository、version、commit、Node、pnpm、platform 和 architecture。
- 若仅上传失败，先确认 archive 是否已经正确构建；只重跑失败 job。

**通过条件：** 九项资产齐全，哈希可验证，三个 target 的元数据对应同一预期 Core commit。

**失败时：** 编译/打包失败回到阶段 3；纯上传故障停留在阶段 4，不重跑已成功平台。

### 阶段 5：Shell 更新锁与归档证明

**输入：** 完整、不可变且已核验的 Core Runtime Release。

**执行：**

- 更新 `core-runtime.lock.json` 中 tag、URL、SHA-256、Core、Node 和 pnpm 身份。
- 运行 `npm run build`。该命令已经执行 `prepare:core-runtime`、校验锁定归档并生成 Runtime manifest，除非单独隔离下载步骤，不要立即在它之前重复运行 `npm run prepare:core-runtime`。
- 核对解压后的 `build/core-runtime/runtime.json` 与锁一致；Core loader 修复需确认归档内容包含预期变更，或与阶段 3 已验证产物字节等价。

**通过条件：** 下载归档哈希匹配，Runtime 元数据与目标完全一致，关键入口、Node 和 pnpm 文件存在。

**失败时：** 哈希/元数据/内容不一致则拒绝该 Release，回到阶段 4；Shell 选择错误则只修复锁和对应测试。

### 阶段 6：Shell 全量检查与普通 build

**输入：** 已验证的 Runtime 锁和通过定向测试的 Shell 变更。

**执行：**

```bash
npm test
npm run typecheck
npm run build
```

默认 Profile 变更需要时单独运行：

```bash
npm run prepare:bundled-profile
```

`npm run build` 已准备 Core Runtime；`prepare:bundled-profile` 会复用已满足 `dsh-better-sidebar@0.16.1` 和模板版本要求的 Profile，避免无意义地重新安装。

**通过条件：** 测试、类型检查和普通 build 均通过，生成的 manifest/Runtime/Profile 与锁和默认插件版本一致。

**失败时：** 不生成 DMG、zip、NSIS，也不触发 GitHub installer。按失败属于测试、Runtime 下载、Profile 或 Electron build 回到相应阶段。

### 阶段 7：独立本地 DEV 应用

**输入：** 阶段 6 通过的 Shell 工作树。

**执行：**

先构建成本较低的目录应用：

```bash
npm run package:dev:dir
```

需要 macOS 安装介质时再运行：

```bash
npm run package:dev:mac:arm64
```

若现有 `dist-dev` 应用正在运行或已被人工验收，使用独立输出目录，避免覆盖证据：

```bash
npm run build
npm run prepare:bundled-profile
npm exec electron-builder -- --dir --config electron-builder.dev.cjs --config.directories.output=dist-dev-validation
```

检查目标应用内：

- `Resources/runtime/runtime.json` 与锁中的 Core commit、包版本、Node、pnpm、平台和架构一致；
- Runtime loader 包含预期修复或与已验证 Core 产物字节等价；
- `Resources/bundled-profile/web/node_modules/dsh-better-sidebar/lib/index.js` 存在；
- 应用名、App ID/channel、绝对路径和输出目录正确。

**通过条件：** 独立目录应用资源完整，未覆盖当前已安装/运行应用，具备进入真实启动验证的身份记录。

**失败时：** 包内资源错误回到阶段 5 或 6；仅 DMG/zip 格式失败时保留已验证目录应用，单独诊断格式层。

### 阶段 8：人工功能验收

**输入：** 阶段 7 的明确应用绝对路径、Runtime tag/commit 和专用 DEV 用户数据目录。

**执行：**

- 退出同 App ID/channel 的旧实例；启动指定路径，确认进程没有被单实例机制转交给旧应用。
- 使用全新 Profile 验证首次启动；使用既有 Profile 验证升级，不得丢失会话、工作区、设置和用户插件。
- 检查复制后的用户 Profile：`dsh-better-sidebar@0.16.1` 依赖、bundle 注册和 `.install-complete` 均存在。
- 新建或打开会话，实际点击 Markdown 和 HTML 文件，确认均在 Sidebar 内打开。
- 确认没有插件恢复窗口，没有无限启动页，插件列表中能看到 Better Sidebar。

**通过条件：** 人工明确回复上述行为通过，并在记录中写明应用路径、Runtime tag、全新/升级 Profile 类型及用户数据目录。

**失败时：** 立即停止。保留日志和精确 Profile 备份；根据失败落在资源、Profile、Utility Process 或交互层回到阶段 5、6 或 7。不得以卸载内置 Sidebar 作为通过条件。

### 阶段 9：GitHub Desktop 安装包构建

**输入：** 阶段 1–8 的记录和明确人工通过结论。

**执行：**

- 使用 `.github/workflows/release.yml` 的 `Release desktop installers`，按发布范围选择 `macos`、`windows` 或 `all`。
- Windows x64 由 `windows-2022` runner 负责；macOS 由相应原生 runner 构建。
- 当前 `workflow_dispatch` 的 macOS 路径生成未签名的 `因赛AI Dev` artifact：它显式设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，只用于目标 runner 构建证明，不得进入阶段 10。只有 `v*` 标签路径在配置完整 secrets 后导入 `Developer ID Application`、签名、公证、stapling 并执行 Gatekeeper 验证。
- 观察失败发生在 install、test、Runtime、Profile、builder、签名/公证、blockmap 还是 upload；只重跑基础设施型失败的受影响 job。

**通过条件：** 目标 job 成功，预期安装包与伴随文件存在，文件名和架构符合目标；macOS 若要进入阶段 10，还必须来自签名发布链并通过 workflow 中的签名、公证、stapling 与 Gatekeeper 检查。

**失败时：** 回到最便宜的失效阶段。能本地复现的错误先本地修复，不用 GitHub Actions 作为远程调试循环。

### 阶段 10：最终安装包验收

**输入：** 从阶段 9 对应 run 下载的确切安装包。macOS 必须是使用 `Developer ID Application` 完整签名并已 notarize/staple 的 DMG；未签名 DEV artifact 不是本阶段输入。`Apple Development` 身份不能替代外部分发身份。

**执行：**

- 记录 workflow URL、artifact 文件名、文件大小和对外发布时的 SHA-256。
- macOS 先运行 `hdiutil verify <dmg>`，挂载后对其中应用执行 `codesign --verify --deep --strict --verbose=4` 和 `spctl --assess --type execute --verbose=4`，再用 `xcrun stapler validate` 检查应用与 DMG；任一失败即停止安装验收。
- 分别完成干净安装与覆盖安装；启动前确认没有旧实例占用单实例锁。
- 重复阶段 8 的 Sidebar Markdown/HTML、恢复窗口、启动页、会话、工作区、设置和插件清单检查。
- macOS 正式包额外验证签名、公证和 stapling；Windows 验证安装、启动、卸载及需要的签名状态。

正式 macOS 本地打包命令为：

```bash
npm run package:mac:arm64
```

**通过条件：** 人工明确确认最终安装包的首次安装、覆盖安装和核心行为通过；发布记录完整。

**失败时：** 保留安装包和日志，标记失败格式与平台。一个已验收 DMG 可用于 macOS 功能结论，但 zip/blockmap 故障必须作为独立未解决项记录，不能宣称整个发布完全通过。

## 人工验收点

有两个不可跳过的人工门禁：

1. 阶段 8 的独立本地 DEV 应用。执行者必须先报告应用绝对路径、Shell commit、Core Runtime tag/commit、用户数据目录以及全新或升级 Profile，再等待人工操作结果。
2. 阶段 10 的最终 DMG/Windows installer。必须从具体 workflow run 下载，报告文件名和校验信息，再等待首次安装与覆盖安装结果。

人工回复只对当时明确命名的应用和制品有效。旧版应用仍在运行、只检查插件列表、只看到包内文件或只完成 builder，均不能代替 Markdown/HTML 的实际 Sidebar 行为。

## 常见故障索引

| 症状 | 首查层级 | 停止位置 |
| --- | --- | --- |
| `dsh-better-sidebar` 恢复窗口 | Runtime loader、用户 Profile、Utility Process 日志 | 阶段 8，禁止 installer |
| Markdown/HTML 打开外部应用 | Sidebar 是否真实加载、是否曾被恢复流程卸载 | 阶段 8 |
| 无限启动页 | Harness Utility Process、Profile 安装标记、Runtime 身份 | 阶段 8 |
| `runtime.json` 缺失或不匹配 | Runtime Release、Shell 锁、测试是否错误依赖 `build/` | 阶段 4–6 |
| Windows Vitest 启动时报缺少 `@rollup/rollup-win32-x64-msvc` | 根 `optionalDependencies` 与 lockfile 的 Windows package 节点 | 阶段 2/9，修复后只跑 Windows |
| macOS 下载 DMG 提示应用“已损坏” | 先验证 DMG，再检查完整 bundle 签名、Gatekeeper、notarization/stapling 与 quarantine；手动 DEV artifact 默认未签名 | 阶段 9，不能移除 quarantine 后宣称阶段 10 通过 |
| codesign 报 `.DS_Store`/resource fork | `Resources` 和默认 Profile 的 Finder 元数据过滤 | 阶段 7 或 9 |
| DMG 成功、zip/blockmap 失败 | 独立分发格式与 artifact 命名，不先否定应用行为 | 阶段 7/9，格式问题单独跟踪 |
| GitHub 上传 Unicorn/单 sidecar 失败 | Release 资产列表与失败 step | 阶段 4/9，只重跑失败 job |
| pnpm 非 TTY 清理、OOM 或下载失败 | Node/pnpm 版本、store、`CI=1`、并发和网络 | 阶段 3/6，不进入 builder |
| tsx IPC/sandbox 权限失败 | 宿主 sandbox 与 IPC 权限 | 在同一阶段用最小宿主权限重试，不改产品代码 |
| 新构建似乎没有变化 | 旧 Electron 单实例、实际进程路径和 channel | 阶段 8/10，先退出旧实例 |

更完整的根因和处理经过见 [2026-08-27 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md)。

## 构建耗时控制

- 一轮验证内复用已经过哈希验证的 Runtime 和满足版本条件的 `build/bundled-profile`；只有锁、目标或模板输入变化时重新准备。
- 先跑定向测试，再跑一次完整 `npm test`。相关源码没有变化时，不为提交、推送或重跑上传重复执行已通过的全量检查。
- 先生成目录应用，目录应用资源和行为通过后才生成 DMG、zip 或 NSIS。
- 原生 runner 只处理本机不能证明的平台、签名和安装器行为；本地可复现问题先本地解决。
- 某平台的依赖或 lockfile 修复不改变其他平台已构建的输入时，只重跑该平台；新提交不能通过“重跑失败 job”带入，必须从新提交启动对应单平台 workflow。
- 编译成功但单个上传失败时只重跑失败 job；先确认是否需要重新编译。
- 把 Runtime 下载、Profile 准备、测试、普通 build、目录应用、安装包和上传分别计时，优化重复最高的阶段，不减少校验项。
- 测试用户数据使用独立 App ID/channel，并保留精确命名的备份。禁止把清理整个应用数据作为常规提速手段。

## 构建记录模板

每次重大 Core、Shell、默认插件、工具链或 upstream 更新复制以下模板：

```markdown
# 客户端构建记录：<日期/变更>

- Shell commit：
- Core Runtime tag / commit：
- 变更类别与验证起点：
- 目标平台/架构：
- Node / npm / pnpm / Electron：
- 应用名、App ID/channel、绝对路径：
- 用户数据目录与备份：

| 阶段 | 命令或操作 | 结果 | 耗时 | 证据/产物路径 |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| ... | | | | |

## 人工验收

- 全新 Profile：
- 既有 Profile/覆盖安装：
- Markdown/HTML Sidebar：
- 恢复窗口/启动页：
- 会话、工作区、设置、插件清单：

## 未解决项

- 问题：
- 影响的平台/格式：
- 已证明不受影响的范围：
- 下一验证阶段：
```

## 维护规则

- 本文只维护当前有效流程；一次事件的时间线和临时诊断写入 `docs/incidents/`。
- 新故障若改变后续每次构建的操作、门禁或停止条件，就同步更新本文；否则只补充对应复盘。
- 命令和 workflow 名必须以当前 `package.json`、Electron Builder 配置和 `.github/workflows/release.yml` 为准。
- 删除或改名构建命令、资源路径、App ID、用户数据目录、Runtime manifest 字段时，在同一变更中更新本文。
- 文档不得把猜测写成规则，也不得把某一平台、某一格式或某一 job 的通过扩大为整个发布通过。
- 构建优化以减少重复下载、重复全量测试、重复原生构建和无效 CI 为目标，不以取消人工功能门禁换取速度。
