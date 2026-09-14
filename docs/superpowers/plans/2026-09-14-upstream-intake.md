# Upstream Intake and Core Compatibility Implementation Plan

> Execute inline in this session. The user authorized implementation when the direction is supported by the audit; no additional execution-choice prompt is needed.

**Goal:** Adopt three independently verifiable Windows fixes while preserving Insight authentication, Gateway credentials, Runtime lock and signed updates.

**Architecture:** Keep the current Shell/Core split. Adapt upstream `a6ffac7`, `c52f450`, and `1454ea3` at the existing process environment and renderer URL boundaries. Do not merge the upstream dependency graph or release workflow.

**Tech Stack:** Electron 43.4.0, TypeScript, Vitest, locked Insight Core Runtime `insight-runtime-v0.1.1-rc.10`.

## First-batch constraints (completed)

- Baseline Shell `aeb8444b6465c67e93bac274fb005806f186756b`; upstream main `6a9c6687c14f9d4183d6907935024f9dd804043e`.
- Branch `codex/upstream-intake-20260914`; leave pre-existing untracked analysis untouched.
- No Core lock, dependency, credential, account directory, updater or release changes in this batch.
- Automatic checks establish source/build correctness; real Windows process-group and window behavior require a native run before publication.

## Task 1: Preserve Windows PATH and isolate the Harness process

**Files:** `src/main/runtime/harness-runtime.ts`, `src/main/runtime/profile-plugin-command.ts`, `test/runtime.test.ts`, `test/profile-plugin-command.test.ts`.

**Interface:** `resolveEnvironmentPath(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string` is shared by the two existing environment builders.

- [x] Add regression cases for `path`, `pAtH`, `Path`, `PATH`, POSIX case sensitivity, and Windows-only detachment. For each Windows spelling:

```ts
const options = buildHarnessSpawnOptions('/launch', '/account', 'win32', { path: 'C:\\Windows\\System32' })
expect(options.env?.Path).toBe('C:\\Windows\\System32')
expect(options.detached).toBe(true)
```

- [x] In the plugin test, temporarily mock `process.platform` as `win32`, call the existing environment builder, assert all case-insensitive PATH keys carry the augmented value, then restore the mock in `finally`. This catches Node's case-deduplication choosing an unmodified key.
- [x] Run `npm test -- test/runtime.test.ts test/profile-plugin-command.test.ts` and confirm the regression cases fail.
- [x] Resolve `Path` / `PATH` first, then scan case-insensitively on Windows; POSIX reads `PATH`. Preserve empty values. Use the helper at both call sites. After augmenting plugin PATH, update every existing Windows PATH spelling to the same value. Set `detached: platform === 'win32'` in Harness spawn options; preserve RC9 process-tree shutdown.
- [x] Re-run the two suites and confirm they pass.

## Task 2: Expose the native Windows titlebar inset

**Files:** `src/main/window-navigation.ts`, `test/runtime.test.ts`.

**Interface:** Keep `desktopHarnessUrl(url, platform): string`; add the existing `WINDOWS_TITLEBAR_HEIGHT` as the `dsh-desktop-titlebar-inset` query parameter on Windows.

- [x] Update exact URL expectations and cover overwriting an obsolete inset without dropping query parameters or the fragment:

```ts
const url = new URL(desktopHarnessUrl('http://127.0.0.1:43127/?workspace=demo&dsh-desktop-titlebar-inset=0#chat', 'win32'))
expect(url.searchParams.get('dsh-desktop-titlebar-inset')).toBe('36')
expect(url.searchParams.get('workspace')).toBe('demo')
expect(url.hash).toBe('#chat')
```

- [x] Confirm failures, import the existing shared constant and call `parsed.searchParams.set('dsh-desktop-titlebar-inset', String(WINDOWS_TITLEBAR_HEIGHT))`.
- [x] Run `npm test -- test/runtime.test.ts test/windows-titlebar.test.ts test/harness-workspace-view.test.ts`.

## Task 3: Verify and record the intake

**Files:** `docs/analysis/2026-09-14-upstream-strategy.md`, `docs/upstream-intake.md`.

- [x] Run `npm test`, `npm run typecheck`, `npm run build` in validation order. Inspect preload outputs for relative shared chunks.
- [x] Run `git diff --check`; confirm product identity, Core lock, Gateway and update-distribution files are unchanged.
- [x] Record exact upstream/release identities, merge-trial evidence, adoption/defer decisions, checks and native acceptance gaps. Keep rollout policy and Core upgrade as separate future batches with explicit prerequisites.
- [x] Leave the patch reviewable on the branch; no release, version bump or public channel promotion in this analysis/intake batch.

## Approved continuation: Shell stability and isolated Core upgrade

The user approved continuation after clarifying that the initial three-file patch was not a full compatibility upgrade. Follow the original product-preservation constraints; apply compatible Shell fixes locally and prove Core upgrades in an isolated worktree before changing the production lock.

- [x] Adapt renderer/GPU recovery to the active account view with bounded retries and persisted Windows fallback.
- [x] Preserve account isolation during async cache cleanup/navigation and use a preferred loopback port with conflict fallback.
- [x] Fail Profile startup repair without deleting bundle declarations; improve multi-plugin diagnosis while protecting managed integrations.
- [x] Target native menu commands at the active view, stop boot scanning after startup, and bound signed Release fetch duration.
- [x] Support both CLI entry styles and new launch token/Cookie authentication without exposing secrets in snapshots or logs.
- [x] Merge Core `dsh-v0.1.5-rc.2` in an isolated worktree, preserve Insight settingsDialog/slots and desktop release workflows, build and test migration/desktop surfaces.
- [x] Reproduce and repair deployed Runtime peer, hardlink-manifest, and pnpm hoisted-placement failures; assemble a self-contained darwin-arm64 candidate from committed Core HEAD.
- [x] Compile the first-party integration against both Runtime type surfaces and run real Gateway parent/child plus Electron IPC cases.
- [x] Run minimal first-party and complete Profile Host smokes; reproduce old Sidebar failure and verify fixed-version Sidebar 0.19.1 / Market 1.46.1 candidate combination.
- [x] Record results and scope limits in the analysis and intake log; keep production Core/plugin locks unchanged until rollout gates pass.
- [ ] Lock and install the complete new plugin dependency graph; port and verify Insight Market management policy against the new release.
- [ ] Verify Renderer/UI, Safe Mode, account switching, plugin operations and copied production-session data on the candidate.
- [ ] Build all three native Runtime targets, publish immutable assets through the existing release process, and only then update the Shell lock and prove N→N+1 installed updates.
- [ ] Add rollout decisions after an owned service API and minimum-version precedence are defined.

Completed local checks: Shell 107 files / 686 tests, typecheck and production build; Core official build and 26 files / 871 focused tests, plus the 9-case updated deployment suite; candidate Gateway IPC 5 cases and Host Profile smoke. These results do not close the unchecked rollout gates.
