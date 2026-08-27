# 因赛AI客户端

因赛AI客户端是锁定 Insight Harness Core Runtime 的跨平台 Electron 宿主。

## Runtime 策略

客户端不会在运行时从 npm registry 安装或升级 `@deepseek-ai/dsh`。`core-runtime.lock.json` 锁定独立发布的 Core Runtime；正式安装包内置该制品及默认的 Better Sidebar Profile。

Profile、插件、工作区与 Harness 会话保存在应用安装目录之外，且产品数据目录会在升级后保持稳定。

## 本地开发

```bash
npm install
npm run dev
```

开发启动前会准备锁定的 Core Runtime、运行时清单与内置 Profile。

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

## 同步上游

本仓库定期合并 `dataelement/dsh-desktop`。解决冲突时必须保留独立 Core Runtime 与内置 Profile，不得恢复已不再由锁定 Core 制品使用的 registry DSH 依赖或补丁文件。
