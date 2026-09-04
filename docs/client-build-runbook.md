# 因赛AI Desktop 客户端构建 Runbook

## 适用范围

本 Runbook 是因赛AI Desktop 在 Core Runtime、Shell、默认 Profile、Better Sidebar、Electron/Node/pnpm、原生依赖、签名流程或 upstream Shell 更新后的当前构建规范。2026-08-27 的完整故障过程见 [Core Runtime 与 Better Sidebar 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md)。当历史复盘与当前脚本不一致时，以本 Runbook、当前 `package.json` 和 `.github/workflows/release.yml` 为准。

目标不是一次性跨过所有构建步骤，而是用从低成本到高成本的证据尽早发现错误。任一阶段失败即停止；修复后从该修复所影响的最便宜阶段恢复，不用重复已经成立且未被变更影响的阶段。

## 核心原则

- Shell 自主锁定 Core Runtime。升级只通过审核后的 `core-runtime.lock.json` 发生，不因 `@deepseek-ai/dsh` registry 或 Core upstream 更新而自动发生。
- Core Runtime 提供可执行 Harness、Node、pnpm 和生产依赖闭包；Shell 提供产品身份、Electron 生命周期、用户数据隔离、默认 Profile、插件恢复和安装包。
- Better Sidebar 是内置产品能力。文件存在、Profile 已复制、Utility Process 能加载、Markdown/HTML 能在 Sidebar 打开是四项独立证据。
- 登录后产品界面必须遵守 [单侧栏集成设计](plans/2026-08-28-authenticated-sidebar-integration-design.md)：Harness 侧栏是唯一导航，产品入口只依赖正式扩展槽和受限账号桥接。
- 日常跨仓调试遵守 [本地组合开发架构](local-composed-development.md)：允许在派生 DEV Runtime/Profile 中投影局部制品，但正式 build 和 package 必须从锁定输入重新生成并拒绝所有 DEV 覆盖。
- 桌面更新以一个经过产品签名的完整 Release 为单位。macOS Apple Silicon、macOS Intel、Windows x64、平台更新元数据、`insight-update.json` 和 `insight-update.json.sig` 缺一不可；不得用局部上传、覆盖同版本资产或单平台发布修补线上版本。
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
| upstream Shell 变更审计或定向采用 | 阶段 1 | 先完成差异审计，再按被触及类别选择后续阶段，不直接从安装包开始 |

upstream Shell 变更的差异审计必须明确保护：Core Runtime 的锁定与资源路径、默认 Profile 和 Better Sidebar 初始化、用户数据隔离、App ID、产品名/安装包命名、未登录全屏 Shell、登录后全窗口 Harness View、第一方集成插件及其受限账号桥接，以及 `package.json` 中 build、DEV 与各平台 package scripts。任何一项会被候选变更覆盖，都先完成本地适配并测试，再进入打包。

Core Runtime 锁更新和 Shell upstream 定向采用必须拆成两个独立提交与验证批次。Core 侧栏扩展槽或设置控制服务发生变化时，先通过集成契约测试和本地 DEV 单侧栏验收，再更新 Runtime 锁；不得用 DOM 注入、模拟点击或修改 Harness 布局源码临时兼容。

Core 模块或独立插件的开发覆盖只能证明待发布组合的本地行为，不能替代阶段 3–5 的 Core 源码证明、原生 Runtime Release 和锁更新。覆盖验证通过后，正式收口必须关闭 watcher、从新目录重新准备锁定 Runtime/Profile，并确认没有源码软链接、本机绝对路径或 DEV 状态文件，再继续阶段 6。

## 分阶段验证曲线

### 阶段 1：范围与身份审计

**输入：** 待验证提交、工作树、目标平台和预期 Core Runtime。

**执行：**

- 查看 `git status --short --branch`、目标提交范围和相关 diff。
- 记录 Shell commit、`core-runtime.lock.json` 的 tag/commit/平台哈希、Node/pnpm 版本和构建目标。
- 区分用户修改、构建输出、缓存和本轮允许修改的文件；不得为获得“干净工作树”清理不属于本轮的内容。
- upstream 变更按 [上游接收规范](upstream-intake.md) 审计，并核对单侧栏设计中的升级决策矩阵。

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

Shell、Harness 或辅助窗口的 sandbox preload 发生变化时，必须检查每个 preload 构建产物都是自包含文件：

```bash
rg -n 'require\(.+\./chunks/' out/preload/*.cjs
```

预期无输出。多个 preload 复用同一个运行时 helper 时，Rollup 可能生成共享 `chunks/*.cjs`；Electron sandbox preload 无法加载该相对模块，随后会同时出现 preload 加载失败、桥接 API 为 `undefined`、账号入口消失或辅助窗口空白。跨 preload 只共享会在编译后擦除的 TypeScript 类型；少量运行时 IPC bridge 保持在各自入口内，并由契约测试校验一致性。

**通过条件：** 测试、类型检查和普通 build 均通过，生成的 manifest/Runtime/Profile 与锁和默认插件版本一致；所有 sandbox preload 均不依赖相对共享 chunk。

**失败时：** 不生成 DMG、zip、NSIS，也不触发 GitHub installer。按失败属于测试、Runtime 下载、Profile 或 Electron build 回到相应阶段。

### 阶段 7：独立本地 DEV 应用

**输入：** 阶段 6 通过的 Shell 工作树。

**执行：**

需要先验证实时 DEV 行为时，宿主 Node 必须使用 22.x；Vite 7 的开发服务器依赖该版本提供的 `crypto.hash()`。本地 Core 覆盖已经准备完成时直接启动 Electron Vite，不能运行会重新下载锁定 Runtime 的 `npm run dev`：

```bash
node --version
npm exec electron-vite -- dev
```

退出时使用 `Ctrl+C`，并确认 Electron 与 Vite 一同结束、开发端口已经释放。macOS 上为读取 `.zprofile` 和 `.zshrc` 启动的交互式 Shell 必须位于独立进程会话；否则它退出后可能把终端前台进程组留在失效 PID，表现为终端只打印 `^C` 而 Dev 客户端继续运行。

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

- Candidate 从 `Release desktop installers` 手工触发，输入严格的 `candidate_tag`，格式为 `vX.Y.Z-rc.N`，且该 tag 必须尚不存在；Stable 只由已存在的 `vX.Y.Z` tag push 触发。触发前，`package.json` 与 lockfile 版本、`build/update-release-policy.json` 的版本和 channel 必须与 tag 完全一致。
- 首个 `release-preflight` job 固定运行在 `ubuntu-24.04`，只检查 tag/channel、包版本、发布策略、三个 Core Runtime target 及其共同 Core commit，并运行发布配置测试。该 job 不下载 Runtime、不构建应用；预检失败时三个原生 job 均不得开始。
- macOS Apple Silicon 与 Intel 分别在 `macos-15` 和 `macos-15-intel` 构建 Candidate 或 Stable。架构打包命令必须用 `finalize-mac-release.mjs` 根据最终 ZIP 和 blockmap 确定性生成 `latest-mac.yml`，不能依赖 electron-builder 的发布副作用。两者都必须使用 `Developer ID Application` 完整签名，提交 Apple 公证并 staple；随后验证应用和 DMG 的 codesign、Gatekeeper、stapling，运行 `hdiutil verify` 与 `unzip -t`，并检查 zip blockmap 和架构更新元数据。
- Windows x64 在 `windows-2022` 构建，不执行代码签名。runner 必须运行 `finalize-windows-release.mjs` 重建 installer blockmap 和 `latest.yml`，并用 `7z t` 验证安装包结构。研发阶段接受 SmartScreen 或“未知发布者”提示，但不接受安装包损坏、产品更新清单缺失或哈希不一致。
- `publish` 必须直接依赖预检、两个 macOS job 和 Windows job，且只在 GitHub `desktop-release` Environment 中读取 `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY`。它合并两个 macOS 元数据，生成并验证完整制品清单与签名，先创建 draft、再上传全部资产，最后才公开 Release。
- 同一 tag 已存在 Release 时必须失败；禁止 `--clobber`、覆盖资产或只重跑 publish 来替换已有版本。任何制品内容变化都创建新的 Candidate 或 Stable 版本。
- Candidate 发布为 prerelease；Stable 发布为普通 Release。两者均包含两个 DMG、两个 zip 及 blockmap、一个 Windows installer 及 blockmap、`latest-mac.yml`、`latest.yml`、`insight-update.json` 与 `insight-update.json.sig`。
- 观察失败发生在 preflight、install、Runtime/Profile preparation、builder、macOS 签名/公证、平台格式验证、manifest 验证还是 GitHub upload；只修复并重跑最便宜的失效层。工作流不再提供单平台 DEV 发布或 Windows UKey 签名路径。

**通过条件：** preflight、三个原生 job 与 publish 全部成功；公开 Release 中的全部资产与已验证 `insight-update.json` 完全一致，Candidate/Stable 属性和版本正确，macOS 签名、公证、stapling 与 Gatekeeper 检查通过，Windows 安装包结构和更新元数据通过。

**失败时：** 回到最便宜的失效阶段。能本地复现的错误先本地修复，不用 GitHub Actions 作为远程调试循环。

### 阶段 10：最终安装包验收

**输入：** 从阶段 9 对应 GitHub Release 下载的确切安装包、`insight-update.json` 和 `insight-update.json.sig`。macOS 必须是使用 `Developer ID Application` 完整签名并已 notarize/staple 的 Candidate 或 Stable DMG；未签名 DEV artifact 不是本阶段输入，`Apple Development` 身份不能替代外部分发身份。Windows 当前为未签名 installer。

**执行：**

- 记录 workflow URL、Release URL、tag、channel、Shell commit、Core Runtime tag/commit、资产文件名、文件大小和 SHA-256；实际文件必须与产品签名的 release manifest 一致。
- macOS 先运行 `hdiutil verify <dmg>`，挂载后对其中应用执行 `codesign --verify --deep --strict --verbose=4` 和 `spctl --assess --type execute --verbose=4`，再用 `xcrun stapler validate` 检查应用与 DMG；任一失败即停止安装验收。
- 保留下载文件的 quarantine；如果必须运行 `xattr` 才能启动，签名候选包验收失败。
- 分别完成干净安装与覆盖安装；启动前确认没有旧实例占用单实例锁。
- 重复阶段 8 的 Sidebar Markdown/HTML、恢复窗口、启动页、会话、工作区、单侧栏、统一设置入口、账号退出和插件清单检查。
- macOS 验证首次安装和覆盖安装、签名、公证及 stapling。Windows 接受预期的 SmartScreen/未知发布者提醒，继续后必须能完成首次安装、覆盖安装、启动和卸载；提示本身不算失败，无法继续、安装包损坏或更新后版本/数据错误才算失败。

正式 macOS 本地打包命令为：

```bash
npm run package:mac:arm64
```

**通过条件：** 人工明确确认 Candidate 或 Stable 的 macOS 与 Windows 最终安装包均完成首次安装、覆盖安装和核心行为，N→N+1 更新后版本正确且登录、会话、工作区、账号隔离、设置、用户插件和内置 Sidebar 数据不丢失；发布记录完整。

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
| `release-preflight` 在原生 job 前失败 | tag/channel、`package.json` 与 lockfile 版本、发布策略版本、三个 Runtime target 和共同 Core commit | 阶段 9；只修正元数据并重跑，不下载 Runtime 或启动原生构建 |
| macOS DMG、ZIP 和 blockmap 已生成但缺少 `latest-mac.yml` | `publish: null` 或 `--publish never` 不保证 electron-builder 生成更新元数据；检查架构打包命令是否执行 `finalize-mac-release.mjs` | 阶段 7/9；根据最终 ZIP 重建并校验 YAML，不为生成元数据启用自动发布 |
| Linux preflight、macOS Intel 或 Windows Vitest 缺少对应 `@rollup/rollup-<platform>` | 根 `optionalDependencies` 与 lockfile 是否显式包含 `linux-x64-gnu`、`darwin-x64`、`win32-x64-msvc` 的精确版本和具体 package 节点；npm 不保证从其他平台生成完整 optional lock | 阶段 2/9；在原生构建前修复，并先用目标 OS/CPU 的临时 `npm ci` 验证解析 |
| Windows 安装时出现 SmartScreen 或“未知发布者” | 确认下载来源、release manifest 哈希和当前 Windows 未签名策略；区分预期信誉提示与文件损坏 | 阶段 10；允许用户明确继续，无法继续或哈希不符立即停止 |
| Windows 包已生成，但 Harness smoke 在登录接入后等待 endpoint 超时 | 干净 DEV 用户目录按设计停留在登录界面，登录前不会启动 Harness；旧 smoke 把历史启动顺序当作 Runtime 健康条件 | 阶段 9；先验证未登录 Shell 稳定且无 endpoint，再用 `scripts/smoke-packaged-harness.mjs` 独立验证包内 Runtime/RPC，不得绕过登录 |
| macOS 下载 DMG 提示应用“已损坏” | 先验证 DMG，再检查完整 bundle 签名、Gatekeeper、notarization/stapling 与 quarantine；手动 DEV artifact 默认未签名 | 阶段 9，不能移除 quarantine 后宣称阶段 10 通过 |
| codesign 或 `xattr -d -r` 报 Runtime `.bin/node: No such file` | 检查锁定 Runtime 的 `.bin/node` 是否指向 Core 构建机绝对路径，并确认 `node_modules/node/bin/node` 存在；Shell 准备 Runtime 时必须移除该无效 shim | 阶段 6；不得携带失效链接进入 builder，真实 Node 缺失则退回 Core Release |
| codesign 报 `.DS_Store`/resource fork | `Resources` 和默认 Profile 的 Finder 元数据过滤 | 阶段 7 或 9 |
| `iconutil` 对尺寸完整的 iconset 报 `Invalid Iconset` | 先用 `file`/`sips` 核对全部标准尺寸；若 `iconutil` 自己解包的 iconset 也无法重新封装，则属于宿主工具异常 | 阶段 2/7，使用仓库生成器直接写入标准 ICNS PNG entries，并以 `file`、`sips` 和品牌资产测试验证，不进入远程打包调试 |
| DMG 成功、zip/blockmap 失败 | 独立分发格式与 artifact 命名，不先否定应用行为 | 阶段 7/9，格式问题单独跟踪 |
| GitHub 上传 Unicorn/单 sidecar 失败 | Release 资产列表与失败 step | 阶段 4/9，只重跑失败 job |
| pnpm 非 TTY 清理、OOM 或下载失败 | Node/pnpm 版本、store、`CI=1`、并发和网络 | 阶段 3/6，不进入 builder |
| `npm test` 的发布说明测试报 `spawnSync python3 ENOEXEC` | `command -v python3`、`file "$(command -v python3)"`；检查 PATH 首项是否为空文件或损坏的 Homebrew shim | 阶段 2；改用可执行的系统 Python 或修复本机 shim，不修改测试来掩盖宿主环境故障 |
| Vite DEV 报 `crypto.hash is not a function` | 宿主 `node --version`；普通 build 成功不能证明 Vite 7 DEV 可启动 | 阶段 7，切换到 Node 22 后重启，不改产品代码 |
| Dev 终端按 `Ctrl+C` 只打印 `^C`，客户端或 5173 端口仍存活 | 比较 Dev 进程 `PGID/TPGID`；检查交互式登录 Shell 是否夺走终端控制权，以及 Development 主进程是否处理 `SIGINT/SIGTERM` | 阶段 7；禁止带残留进程继续下一轮验证，先恢复进程组与优雅退出链路 |
| `Unable to load preload script` 同时报 `module not found: ./chunks/*.cjs`，账号入口消失或辅助窗口空白 | `out/preload/*.cjs` 是否引用 Rollup 共享 chunk；多个 sandbox preload 是否导入同一个运行时 helper | 阶段 6；让各 preload 构建为自包含文件并完成真实 Electron 冷启动，禁止仅凭 Vite build 成功继续 |
| tsx IPC/sandbox 权限失败 | 宿主 sandbox 与 IPC 权限 | 在同一阶段用最小宿主权限重试，不改产品代码 |
| 新构建似乎没有变化 | 旧 Electron 单实例、实际进程路径和 channel | 阶段 8/10，先退出旧实例 |

更完整的根因和处理经过见 [2026-08-27 构建复盘](incidents/2026-08-27-core-runtime-sidebar-build.md)。

## 构建耗时控制

- 一轮验证内复用已经过哈希验证的 Runtime 和满足版本条件的 `build/bundled-profile`；只有锁、目标或模板输入变化时重新准备。
- 先跑定向测试，再跑一次完整 `npm test`。相关源码没有变化时，不为提交、推送或重跑上传重复执行已通过的全量检查。
- 先生成目录应用，目录应用资源和行为通过后才生成 DMG、zip 或 NSIS。
- 原生 runner 只处理本机不能证明的平台、签名和安装器行为；本地可复现问题先本地解决。
- 同一次 run 的纯基础设施失败可重跑失败 job；任何源码、依赖、lockfile、策略或制品修复都必须创建新 Candidate 版本并从新提交启动完整 workflow，不能与旧 run 的成功制品混合发布。
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
- 单侧栏、品牌、账号入口、统一设置和原生退出逃生路径：

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
