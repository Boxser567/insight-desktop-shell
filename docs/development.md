# 因赛AI Desktop 开发说明

## 本地启动与验证

```bash
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

`dev` 和 `build` 会先准备由 `core-runtime.lock.json` 锁定的 Core Runtime、运行时清单和默认插件 Profile。开发数据与生产数据使用不同的应用目录；不要并行运行多个工作树来验证同一个 Profile。

当前 `npm run dev` 仍是完整准备路径。为避免频繁 Core、插件和 Shell 联合开发重复发布 Runtime 或重建 Profile，项目已批准 [本地组合开发架构](local-composed-development.md)。目标接口按修改层提供 `dev:shell`、`dev:core` 和 `dev:plugin` 三类入口；这些 script 在真正加入 `package.json` 并完成文档验收前属于待实现设计，不能作为当前可执行命令。

## 打包

```bash
npm run package:mac:arm64
npm run package:mac:x64
npm run package:win
```

安装包必须在目标操作系统和架构上构建。GitHub Actions 的 `windows-2022` runner 负责 Windows x64；macOS 正式包还需要签名和公证。构建完成后，检查包内的 `Resources/runtime/runtime.json`、默认 Profile 和目标平台 Node.js，再进行手工启动验证。

## 变更约束

Shell 只修改宿主职责。需要把 Harness 内部行为正式纳入客户端时，先在 `insight-harness-core` 中发布新的 Runtime 制品，再有意更新 Shell 锁定版本；不要把 Core 的包、补丁或 `node_modules` 回填为 Shell 依赖。

本地组合开发允许在可删除的 DEV Runtime 中临时投影指定 Core package 的构建产物，以便发布前快速验证；该覆盖不改变正式所有权。正式 build、目录应用和安装包仍必须回到锁定 Runtime，拒绝源码软链接、本机绝对路径和 DEV 标记。
