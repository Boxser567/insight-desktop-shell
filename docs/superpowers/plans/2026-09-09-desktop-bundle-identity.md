# Desktop Bundle Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新构建只使用用户批准的正式与 DEV 两套 Bundle ID。

**Architecture:** 保留现有三个构建配置与运行时渠道机制，只修改 active appId/元数据并用实际配置测试锁定一致性；旧兼容识别不扩展。

**Tech Stack:** electron-builder CJS/JSON、TypeScript、Vitest。

## Global Constraints

- 正式/Candidate：`com.insight-aigc.desktop`；DEV：`com.insight-aigc.desktop.dev`。
- 不修改产品名、userData、服务地址、签名/钥匙串、版本/tag 和既有生成包；不清理未跟踪文件。
- 设计已获用户确认，见 [身份规范](../../plans/2026-09-09-desktop-bundle-identity-design.md)。执行辅助 skill 当前不可用，按已批准范围在本任务内实施，不派生任务。

### Task 1：配置与回归

**Files:** `package.json`、`electron-builder.candidate.cjs`、`electron-builder.dev.cjs`、`test/release.test.ts`、`test/runtime.test.ts`；`src/main/application-channel.ts` 与 `src/main/index.ts` 只补历史兼容注释。

**Interfaces:** 消费构建配置 `appId` / `extraMetadata.insightDesktopAppId`，生产新身份包；`resolveApplicationChannel` 接口与行为保持不变。

- [x] 新增实际配置测试：`expect(candidate.appId).toBe('com.insight-aigc.desktop')`、`expect(dev.appId).toBe('com.insight-aigc.desktop.dev')`，以及元数据相等、产品名/DEV 签名策略不变；更新现有旧 ID 文本断言。
- [x] 执行 `npm test -- test/release.test.ts test/runtime.test.ts`，观察旧配置造成失败。
- [x] 三个配置分别更新为 `appId: 'com.insight-aigc.desktop'` / `appId: 'com.insight-aigc.desktop.dev'`（JSON 使用双引号），同步对应 `insightDesktopAppId`；重跑同一测试通过。

### Task 2：发布规则与交接

**Files:** `docs/release-runbook.md`、`docs/client-build-runbook.md`、`docs/superpowers/plans/2026-09-09-desktop-v1-release-verification.md`；三个旧身份计划增加替代说明，历史原值不改。

- [x] 同步当前身份表；注明旧内部包验收不能证明新 Bundle ID，主/Helper ID、签名和新身份升级需重新验证。
- [x] 执行 `npm test`、`npm run typecheck`、`npm run build:prepared`、`git diff --check`；记录实际结果。
- [x] 只提交上述本任务文件，不推送、不发布；人工安装/签名验收保持未完成。

## 验证记录（2026-09-09）

- 定向测试先因旧 ID 失败 3 项；配置修改后 74 项全部通过。
- `npm run typecheck` 与 `npm run build:prepared` 通过；最终全量复验 89 个测试文件、564 项通过，无跳过。
- 沙箱内全量测试曾因回环监听 `EPERM` 和 Electron 启动限制失败。非沙箱首次复验有一项既有 Electron IPC 测试返回 code 0 但 stdout 为空；该测试文件未改动，单独复验 5 项和随后全量 564 项均通过。记录为测试输出波动，不推断 Bundle ID 或签名故障已被该重试修复。
- `git diff --check` 通过；未跟踪的 `dist-candidate-merged/` 和 `docs/analysis/` 均保留，未签名/公证/启动或改写任何已有应用。
- 后续人工门禁仍未完成：新身份主 App/Helper 打包核对、真实签名/钥匙串、登录连续性及 N→N+1。
