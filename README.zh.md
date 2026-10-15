# 因赛AI客户端

[工程文档入口](docs/README.md)

因赛AI客户端是锁定 Insight Harness Core Runtime 的跨平台 Electron 宿主。

[业务能力全景与实现盘点](docs/analysis/2026-10-08-business-capability-inventory.md)按业务全貌、具体实现、验证缺口和迁移核对项组织，供审核与后续 Agent 追踪。

## Runtime 策略

客户端不会在运行时从 npm registry 安装或升级 `@deepseek-ai/dsh`。`core-runtime.lock.json` 锁定独立发布的 Core Runtime；正式安装包内置该制品及受管理的内置 Profile。

Profile、插件、工作区与 Harness 会话保存在应用安装目录之外，且产品数据目录会在升级后保持稳定。

## 本地开发

```bash
npm install
npm run dev
```

开发启动前会准备锁定的 Core Runtime、运行时清单与内置 Profile。

跨仓开发可使用 `npm run dev:local -- /absolute/path/to/local-runtime`，不会修改正式 Runtime 锁。具体边界见[开发说明](docs/development.md)。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

## 打包

```bash
npm run package:mac:arm64
npm run package:mac:x64
npm run package:win
```

每个目标必须在匹配的操作系统和架构上构建。Windows 安装包由 GitHub Actions 的 `windows-2022` Runner 构建。

## 参考上游

本仓库将 `dataelement/dsh-desktop` 作为参考上游。上游变更按 Commit 范围审计并定向采用，整体仓库合并不再是常规升级路径。每次采用都必须保留独立锁定的 Core Runtime、内置 Profile、产品身份、账号隔离和第一方集成。审计记录见[上游接收规范](docs/upstream-intake.md)。
