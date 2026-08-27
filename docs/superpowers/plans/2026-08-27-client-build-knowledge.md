# Client Build Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 2026-08-27 Core Runtime and Better Sidebar build failures into a durable incident record, an executable client build Runbook, and a concise release entry point.

**Architecture:** Historical facts live in one dated incident document; current operating rules live in one evergreen Runbook. The existing release document links both layers and defines the gate into GitHub installer builds, so history does not obscure current procedure.

**Tech Stack:** Markdown, npm scripts, Electron Builder, GitHub Actions, Core Runtime Release assets, SHA-256, macOS and Windows native runners.

## Global Constraints

- Modify documentation only; do not change application code, dependencies, Runtime locks, workflows, or build output.
- Preserve all unrelated tracked and untracked user files in the dirty worktree.
- Use commands and workflow names that exist in the current `package.json` and `.github/workflows/release.yml`.
- Separate historical facts from current rules: dated facts belong in the incident, reusable obligations belong in the Runbook.
- Do not claim a check proves more than it observes; GitHub job success does not replace installed-application validation.
- Require explicit human acceptance after Sidebar HTML/Markdown behavior is exercised locally and after a final installer is installed.
- Do not trigger Core Runtime or desktop installer workflows while implementing these documents.

---

### Task 1: Record the Core Runtime and Sidebar build incident

**Files:**
- Create: `docs/incidents/2026-08-27-core-runtime-sidebar-build.md`

**Interfaces:**
- Consumes: Core commits `b580d6f4ce` and `85e67608ff`, Runtime tags `insight-runtime-v0.1.1-rc.8` and `insight-runtime-v0.1.1-rc.9`, Shell commits from `44c7768` through `a346076`, and GitHub Runtime run `33059565058`.
- Produces: a stable historical record linked by the evergreen Runbook and release entry point.

- [ ] **Step 1: Create the incidents directory and incident document**

Write these sections in this order:

```markdown
# 2026-08-27 Core Runtime 与 Better Sidebar 构建复盘

## 摘要
## 变更背景
## 影响
## 事件时间线
## 症状、根因与修复
## 无效或证据不足的做法
## 最终验证证据
## 可复用经验
## 后续改进
```

The summary must state that the Runtime upgrade exposed an Electron Utility Process module-resolution gap, Profile installation-state ambiguity, and insufficient validation gates, causing repeated Runtime and Shell packaging.

- [ ] **Step 2: Record the factual timeline**

Include the following facts without turning them into current instructions:

- `insight-runtime-v0.1.1-rc.8` contained the first profile-directory fallback but only used it after an internal loader returned `ERR_MODULE_NOT_FOUND`.
- Electron Utility Process had no internal loader, so `dsh-better-sidebar` was imported relative to the packaged Runtime and could not be found in the user Profile.
- The recovery window named `dsh-better-sidebar`; uninstalling it allowed startup but removed built-in Sidebar behavior.
- The Profile template already contained `dsh-better-sidebar@0.16.1`; `.install-complete` belongs in the copied user Profile, not the read-only bundled template.
- The no-internal-loader fallback was reproduced locally, fixed in Core commit `85e67608ff`, and released as `insight-runtime-v0.1.1-rc.9`.
- Windows paths returned by `require.resolve()` required conversion to `file:` URLs before ESM import.
- Runtime run `33059565058` built all three targets; the first ARM asset upload failed with a GitHub Unicorn response after the archive and JSON uploaded, and rerunning only the failed job completed the Release.
- Shell commit `a346076` pinned rc.9 after verifying the Release assets and hashes.

- [ ] **Step 3: Add the symptom-to-root-cause table**

Use a table with the exact columns `症状`, `真正根因`, `确认方法`, and `修复位置`. Cover at least:

- startup recovery window for `dsh-better-sidebar`;
- Markdown and HTML opening external macOS applications;
- startup hanging on the splash screen;
- missing `runtime.json` in Windows tests;
- macOS signing rejecting `.DS_Store` resource forks;
- zip/blockmap failure after DMG success;
- GitHub Release sidecar upload failure;
- pnpm non-TTY module purge and tsx sandbox IPC failures.

For the zip/blockmap row, distinguish an installer-format failure from application behavior and state that a verified DMG can be used for macOS functional acceptance while the zip issue remains separately tracked.

- [ ] **Step 4: Record weak validation patterns and their replacements**

Explicitly mark these as insufficient:

- treating `npm test`, typecheck, or `electron-builder` success as proof that Sidebar works;
- triggering GitHub installers before a fresh local Profile can start and open Markdown/HTML in Sidebar;
- testing a locally overlaid Runtime without later proving the published archive contains byte-equivalent loader output;
- rerunning every platform after a single upload-only failure;
- restoring or deleting user data without first naming and preserving the exact directory.

Pair each item with the stronger evidence used in the final workflow.

- [ ] **Step 5: Verify incident facts against repository history**

Run:

```bash
git log --since='2026-08-27 00:00:00 +0800' --oneline --reverse
git show --stat 44c7768 caf47f9 a346076
rg -n "insight-runtime-v0.1.1-rc.9|dsh-better-sidebar|install-complete" core-runtime.lock.json src scripts test docs
```

Expected: every Shell commit, tag reference, package version, and marker name used in the incident is present in tracked history or current source.

- [ ] **Step 6: Validate and commit the incident**

Run:

```bash
git diff --check -- docs/incidents/2026-08-27-core-runtime-sidebar-build.md
```

Expected: no whitespace errors.

Commit only the incident:

```bash
git add docs/incidents/2026-08-27-core-runtime-sidebar-build.md
git commit -m "docs: record Core Runtime Sidebar build incident"
```

### Task 2: Add the evergreen client build Runbook

**Files:**
- Create: `docs/client-build-runbook.md`

**Interfaces:**
- Consumes: `package.json` scripts, `.github/workflows/release.yml`, `core-runtime.lock.json`, the packaged `Resources/runtime` and `Resources/bundled-profile` layout, and the incident from Task 1.
- Produces: the current validation curve used before every major Core, Shell, default-plugin, or upstream upgrade.

- [ ] **Step 1: Create the Runbook with stable responsibilities**

Write these sections in this order:

```markdown
# 因赛AI Desktop 客户端构建 Runbook

## 适用范围
## 核心原则
## 变更分类与验证起点
## 分阶段验证曲线
## 人工验收点
## 常见故障索引
## 构建耗时控制
## 构建记录模板
## 维护规则
```

Link the incident near the top as historical context. State that the Runbook is current authority when a dated incident and the current build scripts differ.

- [ ] **Step 2: Define change classes and starting stages**

Include a table mapping these classes to their minimum starting stage and required targets:

- documentation-only;
- Shell UI with no Runtime or packaging change;
- Shell main/preload or user-data behavior;
- default Profile or Better Sidebar;
- Core Runtime dependency or loader change;
- Electron, Node, pnpm, native dependency, signing, or workflow change;
- upstream Shell merge.

An upstream Shell merge must start with a diff audit that protects Runtime ownership, bundled Profile behavior, user-data isolation, App ID, product naming, and package scripts before any package build.

- [ ] **Step 3: Specify the low-to-high-cost validation curve**

Define the stages below with `输入`, `执行`, `通过条件`, and `失败时` subsections:

1. scope and identity audit;
2. focused tests and static checks;
3. Core source proof;
4. target-native Core Runtime Release;
5. Shell lock adoption and archive proof;
6. Shell tests, typecheck, and ordinary build;
7. independent local DEV application;
8. human functional acceptance;
9. GitHub desktop installer build;
10. final installer acceptance.

The Runbook must require stopping at the first failed stage and resuming from the cheapest stage invalidated by the fix.

- [ ] **Step 4: Include exact current commands**

Use these tracked commands:

```bash
npm test
npm run typecheck
npm run build
npm run prepare:bundled-profile
npm run package:dev:dir
npm run package:dev:mac:arm64
npm run package:mac:arm64
```

Explain that `npm run build` already downloads and verifies the locked Runtime, so repeating `prepare:core-runtime` immediately beforehand is unnecessary unless isolating that step. For an independent local application, document use of an alternate Electron Builder output directory so the currently installed or running application is not overwritten.

- [ ] **Step 5: Define artifact and installed-application checks**

Require checking:

- Release has `.tar.gz`, `.sha256`, and `.json` for `darwin-arm64`, `darwin-x64`, and `win32-x64`;
- archive SHA matches `core-runtime.lock.json`;
- `runtime.json` commit, package version, Node, pnpm, platform, and architecture match the lock;
- packaged loader contains the expected fix or is byte-equivalent to the locally built artifact when validating a Core change;
- `Resources/bundled-profile/web/node_modules/dsh-better-sidebar/lib/index.js` exists;
- the copied user Profile contains `dsh-better-sidebar@0.16.1`, bundle registration, and `.install-complete`;
- fresh-profile startup and existing-profile upgrade both preserve sessions and workspaces;
- Markdown and HTML open inside Sidebar;
- no plugin recovery or indefinite splash appears.

- [ ] **Step 6: Define human gates and stop rules**

Require explicit human confirmation after local DEV behavior and after final DMG/Windows installer behavior. State that the agent must report the exact application path and Runtime tag under test, then wait. It must not silently substitute an older running single-instance application for the newly built application.

- [ ] **Step 7: Add build-time controls and a reusable record template**

Include these controls:

- reuse a proven downloaded Runtime and bundled Profile within one validation cycle;
- avoid running full tests repeatedly after no relevant source changed;
- use focused tests before full Shell tests;
- build a directory application before DMG, zip, or NSIS;
- use native runners only after local platform evidence passes;
- rerun only failed jobs for upload-only infrastructure failures;
- preserve exact user-data backups and never use broad deletion commands;
- record commit, Runtime tag, target, commands, results, manual evidence, artifact path, and unresolved issues.

- [ ] **Step 8: Verify Runbook commands and links**

Run:

```bash
node -e "const p=require('./package.json'); for (const n of ['test','typecheck','build','prepare:bundled-profile','package:dev:dir','package:dev:mac:arm64','package:mac:arm64']) { if (!p.scripts[n]) throw new Error(n) }"
rg -n "name: Release desktop installers|windows-2022|package:dev:win|package:mac:arm64" .github/workflows/release.yml
test -f docs/incidents/2026-08-27-core-runtime-sidebar-build.md
git diff --check -- docs/client-build-runbook.md
```

Expected: all commands exit zero and every referenced workflow fact exists.

- [ ] **Step 9: Commit the evergreen Runbook**

```bash
git add docs/client-build-runbook.md
git commit -m "docs: add client build validation Runbook"
```

### Task 3: Make the release document the stable entry point

**Files:**
- Modify: `docs/release-runbook.md`

**Interfaces:**
- Consumes: `docs/client-build-runbook.md` and `docs/incidents/2026-08-27-core-runtime-sidebar-build.md`.
- Produces: a short release entry page that routes engineers to current procedure and relevant history.

- [ ] **Step 1: Replace the minimal release text with an entry checklist**

Keep the title `# Desktop 发布说明` and add these sections:

```markdown
## 必读资料
## 进入安装包构建前
## GitHub Actions
## 最终安装验收
## 发布记录
```

The required-reading section must link both new documents. The pre-build section must require completion of local stages 1–8 from the Runbook.

- [ ] **Step 2: State the GitHub Actions limits**

Document the tracked workflow name `Release desktop installers`, file `.github/workflows/release.yml`, input values `macos`, `windows`, and `all`, and `windows-2022` ownership of Windows x64 packaging. State that CI success proves only workflow completion and artifact creation.

- [ ] **Step 3: Define final acceptance and release record**

Require recording:

- Shell commit and Core Runtime tag/commit;
- workflow run URL and target;
- installer filename and checksum when published externally;
- clean-install and overwrite-install results;
- Sidebar Markdown/HTML result;
- startup recovery, sessions, workspaces, settings, and plugin inventory result;
- known format-specific issues such as a zip failure when the DMG was separately accepted.

- [ ] **Step 4: Validate all documentation links and commands**

Run:

```bash
test -f docs/client-build-runbook.md
test -f docs/incidents/2026-08-27-core-runtime-sidebar-build.md
rg -n "client-build-runbook.md|incidents/2026-08-27-core-runtime-sidebar-build.md" docs/release-runbook.md
git diff --check -- docs/release-runbook.md docs/client-build-runbook.md docs/incidents/2026-08-27-core-runtime-sidebar-build.md
```

Expected: all commands exit zero.

- [ ] **Step 5: Review documentation scope and commit the release entry**

Run:

```bash
git status --short
git diff -- docs/release-runbook.md docs/client-build-runbook.md docs/incidents/2026-08-27-core-runtime-sidebar-build.md
```

Expected: the diff contains only the release entry change because Tasks 1 and 2 were committed independently; unrelated dirty files remain untouched.

Commit:

```bash
git add docs/release-runbook.md
git commit -m "docs: gate desktop installer releases"
```

## Self-review

- The incident owns dated facts, symptoms, root causes, weak validation patterns, and final evidence.
- The Runbook owns current validation stages, exact commands, stop rules, human gates, time controls, and the build record template.
- The release entry links both layers and prevents GitHub installer work before local acceptance.
- Every file has one responsibility and can be reviewed or updated independently.
- No application code, dependency, Runtime lock, workflow, user data, or build output is changed.
