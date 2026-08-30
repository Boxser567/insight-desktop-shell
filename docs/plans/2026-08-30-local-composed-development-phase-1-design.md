# 本地组合开发 Phase 1A 设计

> 状态：approved（2026-08-30）
>
> 本文定义 [因赛AI Desktop 本地组合开发架构](../local-composed-development.md) 的首个可执行切片。上位文档继续负责完整目标、长期边界和后续阶段；本文只负责验证 Shell Renderer 与一个 Core UI package 的快速自测链路。

## 目标

研发阶段应能在不发布 Core Runtime、不更新 `core-runtime.lock.json`、不构建 DMG、也不触发 GitHub Actions 的情况下验证两类高频修改：Shell Renderer 的登录与业务界面，以及 Core `ui-settings-general` 的设置界面。

Phase 1A 的价值不是提供完整开发编排平台，而是用最小垂直切片证明以下判断成立：锁定 Runtime 可以作为稳定基座，本地 Core package 可以作为受控制品覆盖，正式构建仍只消费锁定制品。

## 范围

本阶段实现两个命令：

```bash
npm run dev:shell
npm run dev:core -- ui-settings-general
```

`dev:shell` 负责 Shell Renderer、Electron Main 和 preload 的日常开发启动。`dev:core` 首期只接受 `ui-settings-general`，使用本地 Core 仓库生成该 package 的制品，并把成功制品投影到派生 DEV Runtime。

本阶段不实现：

- `dev:plugin`；
- 第一方 `@insight-ai/desktop-integration` 的 watch 或 HMR；
- 任意 Core package 自动发现；
- 多 package 联合覆盖；
- 完整 Runtime 从本地 Core 重组；
- `dev:reset` 和 `verify:release`；
- 同时运行多个 composition；
- 通用守护进程或图形化开发控制台。

第一方集成插件仍可使用现有显式构建流程验证，但不把该流程伪装成 Phase 1A 的热更新能力。上述能力只有在本阶段两条链路证明稳定后才进入下一设计。

## 方案选择

采用“锁定基座 + 可删除派生 Runtime + 单包制品覆盖”。不采用只增加 npm alias 的方案，因为它不能验证 Core 修改；不采用 `npm link`、源码软链接或 TypeScript 路径直连，因为这些方式会改变 Node/Electron 解析、pnpm 链接和打包输入，并可能引入 React 双实例或本机路径污染。

```text
build/core-runtime（只读锁定基座）
          │ 首次或锁变化时派生
          ▼
build/dev-compositions/core-ui-settings-general/runtime
          ▲
          │ staging 校验后原子替换一个 package
Core packages/client/ui-settings-general/lib
```

Shell 正式构建、目录应用和安装包继续读取 `build/core-runtime`。只有未打包 DEV 进程且存在编排器提供的显式环境变量时，才允许读取派生 Runtime。

## 命令行为

### `dev:shell`

命令先执行轻量就绪检查，而不是无条件运行现有 `npm run dev` 的完整准备链。检查内容包括：

- 当前平台的 `build/core-runtime/runtime.json` 与 `core-runtime.lock.json` 一致；
- Runtime 的 DSH、Node 和 pnpm 入口存在；
- `build/runtime-manifest.json` 与锁定 Runtime 一致；
- bundled Profile 的 manifest、Better Sidebar 和第一方集成插件制品存在。

输入已经就绪时直接启动 `electron-vite dev`。输入缺失或 Runtime 锁变化时，命令只执行对应的既有准备步骤，并明确打印原因。Renderer 继续使用 Vite HMR；Main 或 preload 的重启继续由 electron-vite 负责。

`dev:shell` 沿用当前 `insight-desktop-dev` 用户数据目录，使现有研发账号和测试数据不因命令改名而丢失。它是固定的 Shell composition，不与 Core 覆盖 composition 共用数据。

### `dev:core -- ui-settings-general`

命令要求本地 Core 仓库可读，默认查找 Shell 同级的 `insight-harness-core`；只有默认位置不存在时才读取显式的 `INSIGHT_CORE_REPO`。目标目录必须通过根 `package.json`、workspace 和目标 package manifest 校验，不能仅因目录同名就接受。

启动过程为：

1. 对锁定 Runtime、Runtime manifest 和 bundled Profile执行与 `dev:shell` 相同的就绪检查；
2. 根据 Runtime lock、目标 package 和本地 Core commit 计算稳定 composition ID；
3. 当基座身份变化或派生目录不存在时，从 `build/core-runtime` 创建一次派生 Runtime；
4. 比较本地和基座 package 的 runtime dependencies、peer dependencies、exports、DSH client inject 与必要入口；
5. 兼容时运行 Core package 的既有 `bundle`，将 `package.json`、`lib/` 和 manifest 明确声明的必要静态资源复制到 staging；
6. 校验 staging 后原子替换派生 Runtime 中的目标 package；
7. 启动 Core package watcher 与 Shell 开发客户端；
8. 后续构建成功时重复 staging、校验和原子替换，并请求 DEV 客户端重启 Harness；失败时保留上一次成功制品。

Phase 1A 不处理新增依赖闭包。本地 package 相比基座增加运行依赖、公开入口或 client inject 时，命令应停止并列出差异，说明该修改需要多包覆盖或派生 Runtime 重组；不得从 registry 自动补齐。

## DEV 运行选择

编排器通过只对当前子进程生效的环境变量传入派生 Runtime、composition ID、用户数据目录和刷新标记路径。Electron Main 只在 `app.isPackaged === false` 时接受这些变量；已打包 DEV 或正式应用均忽略它们。

Core composition 使用独立用户数据目录，并在后续启动中复用同一 composition 的登录与测试数据。目录名由稳定 composition ID 派生，不包含本地 Core 绝对路径、账号 ID 或凭证。启动摘要必须打印 Shell commit/dirty 状态、锁定 Runtime tag 与 commit、本地 Core commit、覆盖 package、派生 Runtime 和用户数据绝对路径。

正式打包配置、`build`、`package:*` 与 GitHub Actions 不设置开发覆盖变量，也不读取 `build/dev-compositions`。测试必须固定这一约束，防止本地成功但安装包隐式依赖 Core 源码或派生目录。

## 刷新机制

Phase 1A 不尝试 Core package HMR。编排器只在新制品已经完成原子替换后更新当前 composition 的刷新标记。Electron Main 在未打包 DEV 模式观察该标记：

- 已登录且 Harness ready 时，停止并重新启动当前账号 Harness；
- 未登录时只记录新 generation，登录后首次启动直接使用最新制品；
- 正处于启动、恢复或停止流程时合并重复刷新请求，只在当前生命周期操作结束后执行一次；
- 重启失败时保留 Shell 窗口和日志，不回滚或删除账号数据。

该机制不向 Renderer、Harness 页面或第三方插件暴露新的控制接口，也不在生产应用中启动文件观察器。若实现复杂度明显超过现有 Harness 生命周期能力，首期允许降级为编排器提示开发者重启 DEV 客户端，但必须在验收记录中明确，不能声称已自动刷新。

## 制品投影与恢复

派生 Runtime 位于 `build/dev-compositions/<composition-id>/runtime`。基座复制优先使用操作系统支持的 copy-on-write clone，无法使用时回退到普通递归复制；两种方式都不得在 `build/core-runtime` 内创建链接或写入文件。

每次 package 更新先写入同一文件系统的 staging 目录，至少验证：

- package 名称与允许目标一致；
- `package.json` 可解析；
- `exports` 指向的必要 `lib` 入口存在；
- `lib/client.js`、`lib/index.js` 和 `lib/invariant.js` 与基座所需入口一致；
- 制品不含源码目录、`.git`、测试、缓存、`.DS_Store` 或绝对软链接。

校验成功后才替换目标 package。替换中断时，下次启动根据 composition state 与 package generation 不一致重新从锁定基座派生，不尝试猜测半完成目录是否可用。该恢复只删除对应派生 composition，不触碰用户数据、锁定 Runtime 缓存或正式构建产物。

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 锁定 Runtime 缺失或不一致 | 运行现有准备流程；失败则停止，不创建覆盖 |
| Core 仓库不存在或身份错误 | 停止并显示默认位置及显式配置方式 |
| 不支持的 package 参数 | 停止并列出 Phase 1A 唯一允许值 |
| package 依赖或 exports 与基座不兼容 | 显示结构化差异并停止，不安装依赖 |
| 初次 bundle 失败 | 不启动 Core composition |
| watcher 后续编译失败 | 保留上一成功 generation，客户端继续运行并标记 degraded |
| staging 校验或替换失败 | 不刷新 Harness；下次启动重新派生该 composition |
| Harness 自动重启失败 | 保留 Shell 与账号数据，显示唯一的手工重启动作 |
| `Ctrl+C` | 停止本轮 watcher、electron-vite 和子进程，不删除 composition 数据 |

## 验证设计

自动验证分为四层：

1. 单元测试验证 Runtime/profile 就绪判断、Core 路径与 package allowlist、manifest 兼容性差异、composition ID、复制白名单和 staging 失败保留旧制品；
2. 脚本集成测试使用临时目录验证首次派生、重复启动复用、锁变化重建、成功 generation 替换和失败 generation 不替换；
3. Shell 回归测试验证已打包应用与所有正式命令忽略开发覆盖，release 配置不包含 `build/dev-compositions`；
4. 本地人工验证分别证明 Shell Renderer 和 Core UI package 的反馈链。

人工验证一：运行 `npm run dev:shell`，登录后退出回登录页，临时修改一个可见的登录页文案或样式，确认 Vite HMR 生效；随后恢复该测试修改。记录首次准备耗时、再次启动耗时和保存到可见的耗时。

人工验证二：运行 `npm run dev:core -- ui-settings-general`，临时修改设置页一个无行为影响的可见文案，确认只构建目标 package、没有创建 Runtime tag、没有修改 Runtime lock、没有构建安装包，并在 Harness 重启后看到新文案；随后恢复测试修改并再次确认。还要制造一次语法错误，确认客户端保留上一成功界面，修复后再更新。

首轮通过标准：

- 第二次 `dev:shell` 启动不下载 Runtime、不安装 Profile；
- Shell Renderer 修改无需 Electron 安装包即可验证；
- Core 可见修改无需 Runtime release、Shell build 或 DMG 即可验证；
- `build/core-runtime` 和 `core-runtime.lock.json` 在验证前后内容不变；
- 编译失败不会破坏上一成功 Core composition；
- Core composition 与 Shell composition 的登录和测试数据互不污染；
- 停止命令后没有本轮遗留 watcher、Harness 或 Electron 进程。

## 后续决策门槛

Phase 1A 人工通过后再决定 Phase 1B。只有反馈耗时确实下降、派生 Runtime 可稳定恢复且正式构建隔离成立时，才扩展第一方集成插件 watch、多 Core package 覆盖、`dev:reset` 和 `verify:release`。独立插件接入继续属于更后阶段，不与首轮可行性验证绑定。
