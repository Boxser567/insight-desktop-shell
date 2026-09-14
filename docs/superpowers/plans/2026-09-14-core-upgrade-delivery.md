# Core Upgrade Delivery Implementation Plan

> Execute inline in this task: the user approved the four-step delivery plan. Referenced superpowers execution skills are not installed; use the existing repository commands and track each step here without an additional handoff question.

**Goal:** Turn the Core 0.1.5-rc.2 experiment into a reproducible Insight candidate, retaining account, Gateway, settings, plugin protection and installed-update behavior.

**Architecture:** Keep the Shell and Core release repositories separate. Pin Sidebar 0.19.1 and Market 1.46.1 alongside the new Core. Validate temporary account/Profile data before publishing assets or changing update channels.

**Tech Stack:** Electron 43.4.0, TypeScript/Vitest, Core 0.1.5-rc.2, Node 24.9.0, pnpm 11.7.0.

## Global Constraints

- Shell base `3c61043`; Core candidate `33a669535c2f073be753cbf297f5baf1e6507c3c`.
- Preserve the two existing untracked user files and original Core checkout.
- No production user data, credentials, or update pointer changes during validation.
- Do not call compilation or Host readiness full Renderer or installed-update acceptance.

## Task 1: Reproducible plugin Profile

Files: `scripts/prepare-bundled-profile.mjs`, `src/main/state/bundled-profile.ts`, `scripts/patch-bundled-market.mjs`, profile/market tests, and checked-in Profile dependency lock.

- [x] Reproduce whether existing Market policy applies to the exact 1.46.1 tarball; verify protection via actual HTTP mutation routes.
- [x] Update bundled versions to Sidebar 0.19.1 and Market 1.46.1; advance Profile generation to 5 and retain migration from generation 4.
- [x] Build a new Profile from the selected Core using its supported CLI entry, with exact dependencies and a checked-in frozen dependency lock.
- [x] Verify two clean installations resolve the same packages, the retained archives still match hashes, and runtime peers come from selected Core rather than older installed copies.
- [x] Test generation-4 migration preserves customization and removal of optional community plugins (Market remains managed).

## Task 2: Client and business compatibility

Files: `scripts/smoke-packaged-harness.mjs`, test-only Electron fixtures and first-party integration sources as required by failures.

- [x] Run the actual candidate Host and Renderer; fail on client module load errors and boot failures.
- [x] Verify account footer, settingsDialog, single sidebar, editor and terminal surfaces using temporary data.
- [x] Run credential IPC success/expired/401/cancel tests against the candidate; exercise login/logout/account partitions and Safe Mode with a test identity, without production credentials.
- [ ] Inspect copied legacy-session migration, not the sole copy of user data.

## Task 3: Native Runtime and installer artifacts

Files: Core `.github/workflows/runtime-release.yml`, artifact scripts/tests only where required; Shell `core-runtime.lock.json` after native artifacts are validated.

- [x] Validate Core changes with owning tests, official build and required repository gates.
- [x] Build darwin-arm64, darwin-x64 and win32-x64 on native runners, collecting archives, checksums and metadata.
- [x] Verify exact Core identity and all target assets before updating the Shell lock.
- [ ] Build the candidate installer and exercise installed N→N+1 behavior on available native systems; explicitly record unavailable platform or account acceptance.

## Task 4: Candidate rollout

- [x] Produce an acceptance matrix with actual pass/fail/pending evidence and local commits.
- [ ] Use the existing signed candidate release path after the preceding gates pass; promote stable only after installed acceptance.
- [ ] Keep installation-level gray rollout pending an owned service API and minimum-version precedence; do not fabricate a service.

Progress and remaining platform/service gates: `docs/analysis/2026-09-14-core-upgrade-delivery.md`. Native CI succeeded at Core `5c7450d116d59f972b5df64efa3942220d363809`; runtime dependency prerelease is published.
