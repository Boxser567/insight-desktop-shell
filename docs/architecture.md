# 因赛AI Desktop 架构

因赛AI Desktop 是 Insight Harness Core Runtime 的 Electron 宿主。Shell 负责桌面窗口、受限 IPC、启动恢复、用户数据目录和安装包；Core Runtime 负责 Harness 运行时及其内部依赖。

业务阶段的目标架构（登录、受保护业务入口、账号范围数据隔离以及 Harness 工作区的接入边界）见 [业务阶段架构提案](business-stage-architecture.md)。该提案不改变本页记录的已实现 Runtime 边界。

## 运行时边界

`core-runtime.lock.json` 锁定 GitHub Release 中不可变的 Core Runtime 制品。Shell 构建时下载并校验该制品，正式安装包将其复制到 `Resources/runtime`。因此 Shell 不在 `package.json` 中声明或升级 `@deepseek-ai/dsh` registry 依赖；Core 的升级必须显式更新锁定文件并完成验证。

```mermaid
flowchart LR
  MAIN["Electron Main"] --> WINDOW["Sandboxed BrowserWindow"]
  MAIN --> CORE["Resources/runtime"]
  CORE --> HARNESS["Harness on 127.0.0.1"]
  WINDOW --> HARNESS
  MAIN --> DATA["userData/harness"]
```

macOS 通过 Electron UtilityProcess 启动 Harness，Windows 使用随 Core Runtime 打包的目标平台 Node.js。两者均不向渲染进程暴露 Node 权限。

## 数据与插件

Profile、插件、工作区和会话都位于应用安装目录之外，升级不会覆盖它们。默认 Better Sidebar Profile 随安装包提供；用户仍可显式导入本地插件。启动失败时，恢复流程和 Safe Mode 只处理 Profile，不删除用户工作区或会话。

## 升级上游

Shell 定期合并 `dataelement/dsh-desktop` 的宿主能力。解决冲突时必须保留 Core Runtime 锁定、`Resources/runtime` 资源路径、内置 Profile 与用户数据隔离；不恢复 Shell 对 registry DSH 包或其 `patch-package` 文件的直接依赖。
