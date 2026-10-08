# Candidate 发布与恢复链路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让新 Core Candidate 的真实会话可由已验证的恢复版本读取、继续使用，并通过三平台正式发布门禁。

**Architecture:** 保持服务端发布器与已安装客户端的恢复兼容检查。用实际 Runtime 的 JSONL 持久化实现验证会话迁移、恢复续写和再次打开；恢复版本必须具备 v4 语义，不能把旧 Core 的读取范围改成 2 来冒充兼容。发布顺序取决于恢复基线的选择，见下文两条完整路径。

**Tech Stack:** Node.js 24、Electron、Vitest、GitHub Actions、签名更新 Manifest、JSONL/Zstandard Session。

## Global Constraints

- 公网 Stable `1.0.3` 三目标读取整体 Data Schema `1..1`；旧 Core `5f668026071a5c2f2a0796aff1900be62b0aebe4` 写 Session v3。
- 新 Core `25a49c53c4e0c003a8469ee243aa5d1365df80cd` / `0.2.1-alpha.1` 写 Session v4；本组合整体 Data Schema 为 2。
- Schema 2 不是 Session 格式号 4；Profile Schema、账号 Schema 仍为 1。
- 不修改已发布格式，不覆盖或删除已提交的 v3 generation，不将保留的旧 generation 当作自动降级入口。
- 本地验证仅复用已存在的 Runtime；不下载 Core 制品到本地。
- 正式三端使用相同 Shell/Core 提交、固定归档摘要、正式 App ID；macOS 签名和公证继续执行。
- 不将 Dev ZIP/DMG 改名后冒充正式 Candidate，不修改现有拒绝门禁。
- 现有 README 与业务能力盘点改动不纳入本任务提交。

## 设计选择与官方契约

原先“旧 Core 增加 v4 读取、仍写 v3”的想法不能作为小范围补丁落地。官方 `packages/session/session-format-v3-to-v4/README.md` 明确：工具结果从 user-role wrapper 变成 first-class tool-role，消息 source 改写，developer 消息及 deferred tool schemas 只具有 v4 语义；历史 generation 保留用于检查，不能作为降级回退。当前代码的 v4 catalog 也不是 v3 reader 的 header 放宽开关。

**路径 A（推荐，沿用现有协议）：** 将已验收的新 Core 组合构建为 `1.0.4` 恢复基线，完成三目标人工验收记录后使用现有 Stable 推广流程。随后 `1.0.5` Candidate 写 Schema 2，恢复目标为读 Schema `1..2` 的 `1.0.4`。恢复范围是恢复到新 Core 基线，不是降回旧 Core；若两个版本携带相同 Core，恢复安装只能替换 Shell/插件等差异，不能修复两包共享的 Core 缺陷。不得在验证前把 `1.0.4` 直接投放生产。

**路径 B（保留旧 Core Stable）：** 先交付写 Schema 1 的 Shell 桥接版，使客户端识别 Candidate 中受签名绑定的独立恢复包引用；恢复包必须使用能读 v4 的 Core。发布器验证恢复 Manifest 的签名、目标、版本、摘要、安装器和读取范围；客户端重复相同验证，默认缺失引用继续拒绝。不得借用未验证 URL、仅检查 GitHub prerelease 标记或修改旧 Stable 签名记录。需要扩展 `src/shared/update-contracts.ts`、客户端及脚本协议、恢复源解析、发布器与完整签名/降级攻击测试，不能在旧客户端上静默启用。

2026-10-08 用户已选择路径 A，并明确同意先完成新 Core 1.0.4 恢复基线的三平台验收，再发布 1.0.5 Candidate。路径 B 保留作分析记录，不实施。

### Task 1: 真实 Session 恢复演练

**Files:**
- Create: `scripts/verify-session-recovery.mjs`：隔离临时数据、依次运行指定 Runtime、校验历史文件摘要、输出身份与结果报告。
- Create: `scripts/verify-session-recovery.d.mts`：为测试与后续 workflow 调用提供类型契约。
- Create: `test/fixtures/session-recovery.mjs`：实际 Cordis/JSONL provider 写入文本、工具结果、developer/tool-addition 与 deferred schemas；恢复后继续一轮并重启读取。
- Create: `test/session-recovery-runtime.test.ts`：真实 v4 往返、缺失恢复 Runtime 拒绝；指定旧 Runtime 时增加真实 v3 迁移与旧 Core 恢复拒绝测试。

**Interfaces:**
- `verifySessionRecovery({ candidateRuntime, recoveryRuntime, previousRuntime? })` 返回 `insight-session-recovery-proof/v1` 报告；任一过程失败则抛错，不输出成功报告。
- Runtime 必须原生匹配当前 OS/架构，必须具有 40 位 Core 提交与实际内置 Node。

- [x] 添加失败测试，确认缺少恢复验证入口时测试失败。
- [x] 实现隔离子进程演练；每次读取与预期完整事件数组严格比较，关闭句柄再切换进程。
- [x] 复用已有旧 Runtime，验证 v3→v4→恢复续写→Candidate 再读取。
- [x] 记录旧 Core 实际拒绝 v4；验证原 v3 压缩 generation SHA-256 不变。
- [x] 本地运行四项真实 Runtime 测试，均通过。

```sh
INSIGHT_PREVIOUS_CORE_RUNTIME=/private/tmp/insight-release-1.0.4-old-runtime/extracted \
  npm exec -- vitest run test/session-recovery-runtime.test.ts
node scripts/verify-session-recovery.mjs build/core-runtime \
  'dist-dev/core-0.2.1-alpha.1-prompt-fix-20261008/mac-arm64/因赛AI Dev.app/Contents/Resources/runtime' \
  /private/tmp/insight-candidate-recovery-roundtrip-20261008.json \
  /private/tmp/insight-release-1.0.4-old-runtime/extracted
```

本报告证明 Session 持久化兼容与续写，不替代真实模型请求、账号、Memory Evolve 或三平台人工安装验收。

### Task 2: 正式 Runtime 的 Windows 解包修复

**Files:**
- Modify: `scripts/prepare-core-runtime.mjs`。
- Modify: `test/prepare-core-runtime.test.mjs`。

**Interfaces:** `extractRuntimeArchive(archive, destination, execute?)` 使用归档文件名作 tar `-f` 参数，以归档所在目录为 cwd。正式入口调用同一函数；保留归档摘要和 Core 元数据检查。

- [x] 添加回归测试，先证明缺少函数时失败。
- [x] 把正式 Runtime 解包的绝对 `D:` 路径替换为 basename + cwd；Dev 之前修复过相同原因，正式链路原先仍有此问题。
- [x] 运行 Runtime 准备与 Candidate 客户端/发布器拒绝门禁测试。
- [x] 完成实际归档解包回归与桌面类型检查。

```sh
npm exec -- vitest run test/prepare-core-runtime.test.mjs \
  test/session-recovery-runtime.test.ts test/candidate-recovery-policy.test.ts \
  test/publish-update-v2.test.ts
npm run typecheck
```

### Task 3: 路径 A 的正式构建与投放（选择该路径后执行）

**Files:** `core-runtime.lock.json`、`.github/workflows/release-v2.yml`、发布说明与操作清单。

- [x] 为固定 Core 提交创建不可变 Runtime tag `insight-runtime-v0.2.1-alpha.1-insight.1`，构建 `37793858141` 三目标全部通过并发布归档。
- [x] 更新公开 lock 的三个 URL/摘要、Core 提交和工具链，确保不再回到旧 `0.1.6-alpha.2` Runtime；本地不下载。
- [x] 正式构建改用与内测一致的 Node 24，保留正式 App ID、签名、公证和 immutable Tag/Draft 检查。
- [x] 配置三目标最终包内身份/文件校验、`smoke-packaged-harness.mjs` 与恢复演练；保存独立报告，不把测试报告当作更新器安装产物。原生实际执行结果随正式安装器构建记录。
- [ ] 按现有 `release-v2.yml` 从主分支构建 `1.0.4` 全平台 Draft；真实覆盖 `1.0.3` 时验收迁移、重启、账号、插件和模型请求。
- [ ] 用 `stage-target` 上传三个不可变目标。真实验收通过后，用 `accept-recovery-baseline-target` 写入三个独立签名记录，再以 `promote-recovery-baseline` 建立新 Stable 基线。
- [ ] 复核公网签名链已指向新基线且三目标读 Schema 2；分配更高最终语义版本 `1.0.5`，构建/投放 Candidate，验证客户端得到新 Stable 完整恢复安装器。
- [ ] 使用正式 App ID 的测试用户数据，完成 Candidate→恢复基线覆盖安装→Candidate 再安装；不能删除 userData 来使验收通过。

首次格式升级需要独立基线入口：旧 Stable 不可读新数据时，现有 Candidate→Stable 路径形成循环依赖。
新入口只处理超出旧 Stable 读取范围的数据格式升级，绑定旧 Stable 信封摘要与三目标人工验收，
仍使用现有发布 workflow、签名/不可变对象/CDN/版本下限与最后提交 Stable 指针的事务。
普通 Candidate 的客户端与服务端检查不变；后续 1.0.5 仍使用 `publish-candidate-all`。

### Task 4: 路径 B 的签名独立恢复协议（选择该路径后执行）

**Files:** `src/shared/update-contracts.ts`、`src/main/update/v2-release-contract.ts`、`src/main/update/v2-release-source.ts`、`src/main/update/update-manager.ts`、`scripts/update-v2-contract.mjs`、`scripts/publish-update-v2-to-oss.mjs` 及对应现有测试。

- [ ] 固定恢复引用为 `{ version, manifestSha512 }`，随 Candidate Target Manifest 一起签名；不允许任意 origin/安装器 URL。
- [ ] 客户端从同一更新源读取该目标的不可变恢复 Manifest，验证签名、版本、目标、SHA-512 与安装器元数据；再检查读取范围。
- [ ] 发布器在任何 Candidate 指针写入前重复同一信任链；恢复包缺失、被拒绝、跨目标或签名不一致时保持原指针不变。
- [ ] 增加篡改摘要、跨目标、未签名、缺失引用、旧客户端拒绝、新客户端安全恢复的测试；保留现有 Stable 默认恢复路径。
- [ ] 旧 Core Shell 桥接版的锁与 Host peers 必须匹配旧 API；完成三平台桥接升级后，才允许投放携带独立恢复引用的下一 Candidate。
- [ ] 实际独立恢复 Runtime 运行 Task 1 演练与全平台模型/插件验收后，再绑定签名引用；不得只让 Schema 数字通过。

## 当前验证证据

- `/private/tmp/insight-candidate-readiness-20261008.json`：公开 Stable 签名链、三目标读取范围与拒绝结果。
- `/private/tmp/insight-candidate-recovery-roundtrip-20261008.json`：两个实际 Runtime 目录间的 v4 恢复续写，及真实 v3 历史迁移/保留。
- 新建历史测试只在明确提供旧 Runtime 时运行；未提供时不能声称 CI 覆盖了历史迁移。
- 本地六个针对性测试文件、34 项测试通过（含明确指定的旧 Runtime）；桌面类型检查通过。未声称完成原生三平台正式构建或人工覆盖安装。
- 当前尚未更新公开 lock、合并主分支、创建正式桌面 tag 或改动生产 Candidate/Stable 指针。
