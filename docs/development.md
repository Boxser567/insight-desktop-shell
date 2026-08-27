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

## 打包

```bash
npm run package:mac:arm64
npm run package:mac:x64
npm run package:win
```

安装包必须在目标操作系统和架构上构建。GitHub Actions 的 `windows-2022` runner 负责 Windows x64；macOS 正式包还需要签名和公证。构建完成后，检查包内的 `Resources/runtime/runtime.json`、默认 Profile 和目标平台 Node.js，再进行手工启动验证。

## 变更约束

Shell 只修改宿主职责。需要改变 Harness 内部行为时，先在 `insight-harness-core` 中发布新的 Runtime 制品，再有意更新 Shell 锁定版本；不要把 Core 的包、补丁或 `node_modules` 回填为 Shell 依赖。
