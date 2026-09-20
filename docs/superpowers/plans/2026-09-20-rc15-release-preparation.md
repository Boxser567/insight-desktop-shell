# RC15 Full-Platform Release Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one traceable `1.0.0-rc.15` release branch from the latest `origin/main` that contains every accepted Shell, Core Runtime, Skill, plugin, theme, update, Windows installer, and production-service change developed through 2026-09-20.

**Architecture:** Preserve the accepted work on `codex/rc12-client-polish-20260920`, verify it as one integration snapshot, then create `codex/rc15-release-20260920` from `origin/main` and merge the snapshot. Keep the release identity change separate from feature integration so the RC15 tag points to a reviewable production configuration and all three native builders consume the same commit.

**Tech Stack:** Electron 44, electron-vite, TypeScript, React, Vitest, electron-builder, GitHub Actions, signed Core Runtime `0.1.6-alpha.2-insight.1`, OSS/CDN update distribution.

## Global Constraints

- Candidate version is exactly `1.0.0-rc.15`; release tag is exactly `v1.0.0-rc.15`.
- Local `npm run dev` uses the test service environment; every packaged build uses the production service environment.
- Core Runtime remains locked to `insight-runtime-v0.1.6-alpha.2-insight.1`, Core commit `fbbcc26c251a800929cd5414a23940974ad3453b`, for `darwin-arm64`, `darwin-x64`, and `win32-x64`.
- Candidate/Stable identity remains `com.insight-aigc.desktop`, product name `因赛AI`, and user-data directory `insight-desktop`.
- Do not restore bundled `dsh-genui` or `dsh-market`; retain the accepted `dsh-memory-evolve` and `dsh-prompt-enhance` packages.
- Treat every `dzm/` branch and every commit authored or committed by `duzhimeng` as a read-only product Demo; never merge, cherry-pick, rebase, squash, patch, or copy its code into this project.
- Do not move an existing tag or overwrite a published immutable release directory.
- Preserve user worktrees and unrelated files; do not delete old branches during RC15 preparation.

---

### Task 1: Establish the branch and worktree inventory

**Files:**
- Create: `docs/superpowers/plans/2026-09-20-rc15-release-preparation.md`

**Interfaces:**
- Consumes: local refs, fetched `origin/*` refs, `git worktree list`, and current working-tree state.
- Produces: an evidence-backed decision about the RC15 integration source and missing branches.

- [x] **Step 1: Fetch all remotes without mutating worktrees**

Run: `git fetch --all --prune`

Expected: `origin/main` and remote feature refs are current.

- [x] **Step 2: Compare every local branch with the current candidate and `origin/main`**

Run: `git for-each-ref refs/heads`, `git rev-list --left-right --count`, and `git cherry` against `codex/rc12-client-polish-20260920`.

Expected: all historical internal integration branches are ancestors or patch-equivalent; old Web Search capability is independently present in RC15; every `dzm/` Demo ref remains outside RC15 ancestry and no `duzhimeng` author or committer identity appears in RC15 history.

- [x] **Step 3: Audit every registered worktree and stash**

Run: `git worktree list --porcelain`, `git -C <worktree> status --short`, and `git stash list`.

Expected: only the active integration worktree contains product changes; the Windows candidate worktree contains only an untracked `node_modules` directory; no stash contains release work.

### Task 2: Verify and commit the accepted integration snapshot

**Files:**
- Modify: the currently changed Skill, plugin, environment, theme, updater, documentation, and test files reported by `git status --short`.
- Test: `test/**/*.test.ts` and `test/**/*.test.mjs`.

**Interfaces:**
- Consumes: the manually accepted working tree on `codex/rc12-client-polish-20260920`.
- Produces: one immutable integration commit containing the accepted RC15 feature set before release metadata changes.

- [x] **Step 1: Run static and unit verification**

Run:

```bash
npm run typecheck
npm run typecheck:desktop-integration
npm test
git diff --check
```

Expected: all product tests and type checks pass; any host-only test failure must be isolated, reproduced, and documented before proceeding.

- [x] **Step 2: Build the prepared application**

Run: `npm run build:prepared`

Expected: main, preload, renderer, and desktop integration bundles build successfully; `out/preload/update.cjs` remains self-contained.

- [x] **Step 3: Review the complete staged change**

Run: `git diff --stat`, `git diff --check`, and focused diffs for service environment, bundled plugins, updater, theme synchronization, and Skill presentation.

Expected: no generated local artifact, secret, test-only endpoint in packaged configuration, or unrelated file is staged.

- [x] **Step 4: Commit the accepted snapshot**

Run:

```bash
git add --all
git commit -m "feat: consolidate rc15 desktop capabilities"
```

Expected: the current branch is clean and the commit contains only the already-developed and manually accepted product work.

### Task 3: Create the RC15 branch from the latest main line

**Files:**
- No direct file changes; Git history only.

**Interfaces:**
- Consumes: clean `origin/main` and the Task 2 integration commit.
- Produces: `codex/rc15-release-20260920`, rooted in the current main line and containing the full candidate history.

- [x] **Step 1: Create the release branch from main**

Run: `git switch -c codex/rc15-release-20260920 origin/main`

Expected: `HEAD` starts at the latest fetched `origin/main`.

- [x] **Step 2: Merge the verified integration snapshot**

Run: `git merge --no-ff codex/rc12-client-polish-20260920 -m "merge: integrate rc15 desktop capabilities"`

Expected: the patch-equivalent Windows publishing commit does not duplicate behavior; the merged tree contains all accepted features.

- [x] **Step 3: Re-run targeted merge verification**

Run: `npm run typecheck`, `npm run typecheck:desktop-integration`, and targeted release/theme/Skill/plugin tests.

Expected: no merge regression and no unexpected tree difference from the verified integration snapshot beyond `origin/main` metadata/history.

### Task 4: Set the RC15 release identity

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `build/update-release-policy.json`
- Create: `docs/releases/1.0.0-rc.15.md`
- Test: `test/about-window.test.ts`
- Test: `test/prepare-windows-candidate.test.ts`

**Interfaces:**
- Consumes: release version `1.0.0-rc.15`, candidate channel, production service configuration, and the existing runtime lock.
- Produces: metadata accepted by `verify-release-preflight.mjs` and all native workflows.

- [x] **Step 1: Change the package and policy versions**

Set the root package, root lockfile package entries, and `releaseVersion` to `1.0.0-rc.15`. Keep `insightReleaseDate` at `2026-09-20`, channel `candidate`, mode `optional`, and minimum supported version `1.0.0-rc.1`.

- [x] **Step 2: Update version-specific fixture data**

Change the Windows candidate fixture from `1.0.0-rc.14`/`v1.0.0-rc.14` to `1.0.0-rc.15`/`v1.0.0-rc.15`. Keep historical RC14 acceptance documents unchanged.

- [x] **Step 3: Add RC15 release notes**

Document the included Core upgrade, enterprise Web Search, Skill proxy and presentation, plugin bundle changes, production service split, live theme synchronization, automatic install transition, Windows upgrade hardening, and manual acceptance gates.

- [x] **Step 4: Commit release identity separately**

Run:

```bash
git add package.json package-lock.json build/update-release-policy.json docs/releases/1.0.0-rc.15.md test/prepare-windows-candidate.test.ts
git commit -m "chore(release): prepare 1.0.0-rc.15"
```

Expected: release metadata is independently reviewable from feature integration.

### Task 5: Execute RC15 release gates

**Files:**
- Verify: `package.json`
- Verify: `build/update-release-policy.json`
- Verify: `build/client-service-environment.json`
- Verify: `core-runtime.lock.json`
- Verify: `.github/workflows/release.yml`
- Verify: `.github/workflows/publish-update.yml`

**Interfaces:**
- Consumes: the RC15 release branch and locked production metadata.
- Produces: local evidence that GitHub's three-platform workflow can start from one commit.

- [x] **Step 1: Run the exact candidate preflight**

Run:

```bash
node scripts/verify-release-preflight.mjs \
  --tag v1.0.0-rc.15 \
  --expected-channel candidate \
  --package package.json \
  --policy build/update-release-policy.json \
  --runtime-lock core-runtime.lock.json \
  --service-environment build/client-service-environment.json
```

Expected: JSON reports version `1.0.0-rc.15`, channel `candidate`, service environment `production`, and all three locked targets.

- [x] **Step 2: Run all local quality gates**

Run:

```bash
npm run typecheck
npm run typecheck:desktop-integration
npm test
npm run build
```

Expected: every gate passes from a clean checkout-equivalent state.

- [x] **Step 3: Verify release and publishing workflow contracts**

Run:

```bash
node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json
node scripts/verify-publish-workflow.mjs .github/workflows/publish-update.yml scripts/github-oss-client.mjs
node scripts/verify-release-preflight.mjs --tag v1.0.0-rc.15 --expected-channel candidate --package package.json --policy build/update-release-policy.json --runtime-lock core-runtime.lock.json --service-environment build/client-service-environment.json
```

Expected: workflow contracts and the release identity pass without network credentials.

### Task 6: Build and promote the full-platform candidate

**Files:**
- No source edits unless a gate finds a release-blocking defect.

**Interfaces:**
- Consumes: one pushed RC15 release commit approved for remote build.
- Produces: signed/notarized macOS ARM64 and x64 artifacts, Windows x64 installer, signed release manifest, Draft Release, and staged OSS version directory.

- [ ] **Step 1: Push the reviewed release branch and merge it into `main`**

Expected: GitHub `main` resolves to the exact locally verified RC15 commit; Candidate is not built from an unmerged side branch.

- [ ] **Step 2: Trigger `Release desktop installers`**

Use `candidate_tag=v1.0.0-rc.15` and `target=all` from `main`.

Expected: macOS ARM64, macOS x64, Windows x64, manifest, signing, notarization, and Draft creation jobs all pass.

- [ ] **Step 3: Stage the exact Draft assets to OSS**

Run `Publish desktop updates` with `command=stage`, `tag=v1.0.0-rc.15`, `scope=all`, and empty `confirm_version`.

Expected: GitHub Draft, OSS immutable version directory, and CDN bytes have matching files, sizes, and SHA-256 values; the candidate pointer is unchanged.

- [ ] **Step 4: Perform installation and N→N+1 acceptance**

Verify clean install and overwrite install on macOS ARM64, macOS x64, and Windows x64; then verify the promoted Candidate update path, login, sessions, workspace data, Skills, plugins, themes, updater transition, and Windows legacy upgrade behavior.

Expected: all manual gates pass before `promote`; failures produce a higher RC rather than overwriting RC15.
