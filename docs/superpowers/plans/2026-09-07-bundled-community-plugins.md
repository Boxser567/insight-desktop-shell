# Bundled Community Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three fixed community plugins to the first-run desktop Profile as default-enabled, user-removable plugins while retaining dsh-market as the only user-facing plugin manager.

**Architecture:** Shell keeps three reviewed `.tgz` files as build inputs and installs them through the existing DSH CLI while preparing `bundled-profile`. Runtime enable/disable and uninstall continue to operate through the active account's dsh-market/Profile; updates are available only when dsh-market can match the local artifact to a supported online source. No device registry, management CLI, remote policy client or new plugin settings UI is introduced.

**Tech Stack:** Node.js ESM build scripts, DSH CLI, pnpm Profile workspace, Electron/Vitest, existing dshmarket adapter.

## Global Constraints

- Governing design: `docs/plans/2026-09-04-bundled-plugin-market-design.md`.
- Add `dsh-memory-evolve@0.1.0` from tag `v26082401`, commit `21d2a8518bc608c2958b08733f5b5eaf6b514c9c`.
- Add `@changfenhuang/dsh-genui@0.9.8` from stable tag `v0.9.8`, commit `680693eda677926942c11a499c476c55587d97c1`.
- Add `dsh-prompt-enhance@0.1.9` from tag `v0.1.9`, commit `ed535fbdf0a10d777e43a1f3130d5ffb4b94a5c2`.
- Do not add `dsh-at-file@0.7.0`; locked Core commit `833f4246abaf3ce5fcf39c3f81a8be2499e7f434` already provides file references.
- Keep the currently locked `dshmarket@1.44.0` removable.
- Keep `dsh-better-sidebar@0.16.1` and `@insight-ai/desktop-integration@0.1.0` non-removable and non-updatable from Market.
- dsh-market operations continue to affect only the active account Profile during this phase.
- New account Profiles receive all factory plugins enabled by default. Existing Profiles retain their current plugin selection.
- Memory, configuration, cache, session and business data remain account-scoped. Memory Evolve's default `~/.agents/skills` library is the explicit device-scoped exception and is shared by all local accounts.
- A fixed archive and digest provide reproducibility, not a Host permission sandbox. Record a source capability review before accepting each default-enabled third-party package.
- Do not modify Core Runtime, authentication, account storage, plugin IPC, updater or release workflows.
- Build output must not contain absolute paths to Downloads, `/private/tmp` or a developer clone.
- Verify macOS locally before dispatching macOS or Windows GitHub Actions. Linux is out of scope.

---

### Task 1: Produce reviewed fixed-version plugin packages

**Files:**
- Create: `vendor/plugins/dsh-memory-evolve-0.1.0.tgz`
- Create: `vendor/plugins/changfenhuang-dsh-genui-0.9.8.tgz`
- Create: `vendor/plugins/dsh-prompt-enhance-0.1.9.tgz`
- Create: `vendor/plugins/bundled-community-plugins.json`
- Create: `vendor/plugins/licenses/dsh-memory-evolve-LICENSE`
- Create: `vendor/plugins/licenses/dsh-genui-LICENSE`
- Create: `vendor/plugins/licenses/dsh-prompt-enhance-LICENSE`
- Create: `vendor/plugins/README.md`

**Interfaces:**
- Produces: three repository-local npm archives and one build-only descriptor consumed by Task 2.
- Produces: `BundledCommunityPlugin { packageName; version; artifact; sha256; sourceRepository; sourceRef; sourceCommit }` records.

- [ ] **Step 1: Check out and verify Memory Evolve**

Clone tag `v26082401` into a temporary directory and verify `git rev-parse HEAD` equals `21d2a8518bc608c2958b08733f5b5eaf6b514c9c`. Run `DSH_SOURCE=<shell-root> npm run build`, then use the locked Core Runtime Node with an isolated `DSH_HOME` to run `node --test tests/*.test.js`. Do not use the upstream `npm test` script: the pinned package quotes the glob and Node receives `tests/*.test.js` literally. Run the tests outside a restricted sandbox because the suite binds loopback ports. Stage the upstream `package.json`, license and readmes plus `cordis.patch.yml`, built `lib`, packaged skills, `vendor/mermaid.min.js` and `scripts/sync-worker.mjs`, then run `npm pack --ignore-scripts` from that staging directory. Rename the generated archive to `dsh-memory-evolve-0.1.0.tgz` only if its packed `package/package.json` names `dsh-memory-evolve@0.1.0` and contains `lib/index.js`, `lib/client.js` and `cordis.patch.yml`.

Expected: source build exits 0 and all 776 tests pass under the locked Node 24.9.0. The staged files remain byte-for-byte identical to the reviewed checkout, while source, tests, TypeScript configuration and upstream developer-machine paths are excluded from the archive. Reject `.git`, `node_modules`, `.DS_Store` and developer checkout paths. Record compressed and unpacked sizes before accepting the package. Its `private: true` flag is acceptable for local packing but confirms that the Shell cannot rely on npm publication.

- [ ] **Step 2: Check out and verify GenUI**

Clone tag `v0.9.8`, verify commit `680693eda677926942c11a499c476c55587d97c1`, run `pnpm install --frozen-lockfile` and `pnpm run check`, then pack. Accept only package `@changfenhuang/dsh-genui@0.9.8` containing `lib/index.js`, `lib/client.js`, `lib/invariant.js`, `cordis.patch.yml` and the declared browser assets.

Expected: preview tag `v0.9.9-preview.1` is not checked out or recorded.

- [ ] **Step 3: Check out and verify Prompt Enhance**

Clone tag `v0.1.9`, verify commit `ed535fbdf0a10d777e43a1f3130d5ffb4b94a5c2`, run `npm ci`, `npm test`, `npm run typecheck` and `npm run build`, then pack. Accept only package `dsh-prompt-enhance@0.1.9` containing `lib/index.js`, `lib/client.js` and `cordis.patch.yml`.

- [ ] **Step 4: Save license and source records**

Copy each checked-out LICENSE into `vendor/plugins/licenses`. Write `vendor/plugins/README.md` with package name, version, repository, tag, commit, license and the exact commands run. For each package, record its Host and browser capabilities: injected Harness services, file read/write locations, network access, subprocess use, startup side effects and raw HTML rendering. Record Memory Evolve's device-wide `~/.agents/skills` exception explicitly. State that this directory is a reviewed Shell build input, not a plugin registry or runtime manager, and that a digest does not restrict runtime permissions.

- [ ] **Step 5: Generate the build-only descriptor with real hashes**

Calculate each archive using `shasum -a 256`. Write `bundled-community-plugins.json` with `schemaVersion: 1` and exactly three records. Use repository-relative artifact paths and the measured lowercase hashes; never write a placeholder or floating source ref.

Each record must contain `packageName`, `version`, repository-relative `artifact`, the measured 64-character lowercase `sha256`, `sourceRepository`, exact `sourceRef` and exact `sourceCommit`. Create the descriptor only after all three archives and hashes exist; a placeholder hash is invalid input and must fail verification.

- [ ] **Step 6: Inspect all archives and commit build inputs**

Run `tar -tzf` for each archive, `shasum -a 256 -c` against the descriptor values, inspect `npm pack --dry-run --json` size/file-count output, and run `git diff --check`.

Expected: no `.git`, `node_modules`, `.DS_Store`, source checkout path or unbuilt entry is present. Record each archive's compressed size, unpacked size and file count in `vendor/plugins/README.md` so installer-size changes remain visible.

```bash
git add vendor/plugins
git commit -m "build(plugins): vendor community plugin packages"
```

### Task 2: Add one-package disposable Profile verification

**Files:**
- Create: `scripts/verify-bundled-community-plugin.mjs`
- Create: `scripts/verify-bundled-community-plugin.d.mts`
- Create: `test/verify-bundled-community-plugin.test.ts`

**Interfaces:**
- Consumes: one descriptor record, locked Core Runtime Node, DSH entry, pnpm entry and the existing packaged-Harness readiness probe.
- Produces: `verifyBundledCommunityPlugin(projectRoot, packageName): Promise<void>`.

- [ ] **Step 1: Write failing validation and cleanup tests**

Test unknown package, digest mismatch, packed name/version mismatch, missing runtime/client entry, DSH add failure, Harness boot/load failure and temporary-directory cleanup after failure.

```ts
await expect(verifyBundledCommunityPlugin(root, 'missing-plugin')).rejects.toThrow(
  'missing-plugin is not a bundled community plugin'
)
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run test/verify-bundled-community-plugin.test.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the disposable Profile verifier**

Reuse the same locked Node, DSH entry, pnpm entry, constrained environment and pnpm shim settings used by `prepare-bundled-profile.mjs`. For one selected record:

1. Verify archive SHA-256.
2. Create a temporary DSH home.
3. Run `dsh plugin --profile web add --save-exact --allow-build=node-pty <artifact>`.
4. Run `dsh plugin --profile web install --no-frozen-lockfile`.
5. Verify the Profile dependency, bundle entry and installed package version.
6. Start Harness from the disposable Profile with the same process lifecycle and RPC-readiness rules as `smoke-packaged-harness.mjs`; fail on plugin load errors, early exit or readiness timeout, then terminate the process cleanly.
7. Remove the temporary DSH home in `finally`.

Extract and reuse the existing smoke process helper instead of maintaining a second readiness protocol. The script prints the package name before each phase and accepts exactly one package-name argument. It is a build verifier, not a general plugin manager.

- [ ] **Step 4: Verify each plugin separately**

Run in this order and stop at the first failure:

```bash
node scripts/verify-bundled-community-plugin.mjs dsh-memory-evolve
node scripts/verify-bundled-community-plugin.mjs @changfenhuang/dsh-genui
node scripts/verify-bundled-community-plugin.mjs dsh-prompt-enhance
```

Expected: all three disposable Profile installations and Host boots succeed without changing `build/bundled-profile` or user data. Browser-client behavior is verified later in the combined fresh-account DEV run.

- [ ] **Step 5: Commit the focused verifier**

```bash
git add scripts/verify-bundled-community-plugin.mjs scripts/verify-bundled-community-plugin.d.mts test/verify-bundled-community-plugin.test.ts
git commit -m "test(plugins): verify bundled packages independently"
```

### Task 3: Install the three archives into the bundled Profile

**Files:**
- Modify: `scripts/prepare-bundled-profile.mjs`
- Modify: `test/bundled-profile.test.ts`
- Modify: `test/authenticated-sidebar-contract.test.ts`
- Modify: `test/release.test.ts`

**Interfaces:**
- Consumes: `vendor/plugins/bundled-community-plugins.json` and the three archives.
- Produces: `build/bundled-profile/web` containing the three new packages and repair-local archives.

- [ ] **Step 1: Write failing generated-Profile assertions**

Assert exact dependencies and bundle entries for the three packages, matching physical `node_modules/<package>/package.json` versions, and absence of `dsh-at-file`. Assert every community dependency spec is relative and does not contain the repository root, Downloads or `/private/tmp`.

```ts
expect(manifest.dsh.profile.bundles).toEqual(expect.arrayContaining([
  'dsh-memory-evolve',
  '@changfenhuang/dsh-genui',
  'dsh-prompt-enhance'
]))
expect(manifest.dependencies).not.toHaveProperty('dsh-at-file')
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npx vitest run test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts test/release.test.ts`

Expected: FAIL because the builder still installs only Sidebar and Market.

- [ ] **Step 3: Validate the descriptor and copy archives into the Profile**

Read and strictly validate schema version, exact package/version strings, repository-relative paths and SHA-256 before running DSH. After Sidebar and Market create the temporary Profile, copy the three archives to `<temporary-profile>/.insight-bundled-plugins/`.

Reject descriptor mismatch with a package-specific build error. Do not add a runtime policy service or generic manifest abstraction.

- [ ] **Step 4: Install archives in descriptor order**

Call the existing `runDsh` once per archive with a Profile-relative `file:.insight-bundled-plugins/<archive>.tgz` specifier, then perform the existing final Profile install and dshmarket patch. Preserve `.insight-bundled-plugins` when copying the template so later Profile repair does not depend on the Shell checkout.

Bump `DEFAULT_PROFILE_VERSION` to `4`. Replace only an exact, untouched version-three Profile created before dsh-market was bundled; a market state directory, retained plugin archive directory or explicit market-uninstall marker makes the Profile user-owned and prevents replacement. Migrate every other version-three Profile without adding removed plugins or changing the user's plugin selection. Version-four Profiles keep that selection on every later launch.

- [ ] **Step 5: Extend readiness checks**

`templateIsReady()` must require all three exact dependency versions, bundle entries, physical package manifests, retained local archives and matching hashes. A previous three-plugin template must rebuild once because it fails the new readiness predicate.

- [ ] **Step 6: Verify the complete Profile and commit**

Run:

```bash
npm run prepare:core-runtime
npm run prepare:bundled-profile
npx vitest run test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts test/release.test.ts
```

Expected: all checks pass; generated Profile contains the three additions and no absolute build-machine path.

```bash
git add scripts/prepare-bundled-profile.mjs test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts test/release.test.ts
git commit -m "feat(profile): bundle optional community plugins"
```

### Task 4: Hide required components from dsh-market actions

**Files:**
- Modify: `scripts/patch-bundled-market.mjs`
- Modify: `scripts/patch-bundled-market.d.mts`
- Modify: `src/main/state/bundled-profile.ts`
- Modify: `test/bundled-market-policy.test.ts`
- Modify: `test/bundled-profile.test.ts`

**Interfaces:**
- Consumes: the existing hard-coded required package patterns for Sidebar and desktop integration.
- Produces: required packages absent from dsh-market installed/update lists while mutation routes remain protected.

- [ ] **Step 1: Add failing list-filter assertions**

Extend the pinned route fixture with `/dsh-market/installed` and `/dsh-market/updates`. Assert the patched responses filter `dsh-better-sidebar` and `@insight-ai/desktop-integration`, while keeping dshmarket and all three removable factory packages.

- [ ] **Step 2: Patch only the pinned host response paths**

Use the existing `isProtectedModule(name)` helper immediately before installed/update JSON serialization. Missing source anchors must fail `prepare:bundled-profile`. Do not patch dsh-market React, CSS, headings, community links or log buttons.

- [ ] **Step 3: Keep mutation guards and verify idempotence**

Run `patchBundledMarket()` twice in the test. Assert exactly one filter marker per list route and exactly one 403 guard per update/uninstall route.

- [ ] **Step 4: Run and commit the market adjustment**

```bash
npx vitest run test/bundled-market-policy.test.ts
npm run prepare:bundled-profile
git add scripts/patch-bundled-market.mjs scripts/patch-bundled-market.d.mts test/bundled-market-policy.test.ts
git commit -m "fix(plugins): hide required market actions"
```

- [ ] **Step 5: Refresh the policy in compatible existing Profiles**

Real DEV inspection must use an account Profile that predates this task. When that Profile still contains the same `dshmarket` version as the bundled template, refresh only its patched `lib/patch.js` and `lib/routes.js` before Harness starts. Do not add a removed market, backfill community plugins, change the Profile manifest, or overwrite a user-updated market version. Cover matching, absent and different-version paths in `bundled-profile.test.ts`.

### Task 5: Follow the staged client verification curve

**Files:**
- Modify: `docs/client-build-runbook.md`
- Modify: `docs/plans/2026-09-04-bundled-plugin-market-design.md`

**Interfaces:**
- Consumes: the completed Profile and market changes.
- Produces: recorded automated and manual evidence before installer CI.

- [ ] **Step 1: Run focused checks before starting the app**

```bash
npx vitest run test/verify-bundled-community-plugin.test.ts test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts test/bundled-market-policy.test.ts test/release.test.ts
npm run typecheck
npm test
npm run build
npm run prepare:bundled-profile
node scripts/verify-bundled-community-plugin.mjs dsh-memory-evolve
node scripts/verify-bundled-community-plugin.mjs @changfenhuang/dsh-genui
node scripts/verify-bundled-community-plugin.mjs dsh-prompt-enhance
```

Expected: every command exits 0. Stop on the first failure.

- [ ] **Step 2: Perform a fresh-account DEV check**

Use a separate DEV user-data/account scope rather than deleting the normal profile. Confirm:

1. dsh-market opens and lists the three new packages as installed and enabled.
2. All three show disable and uninstall controls; an update control is optional and must appear only when dsh-market resolves a supported online source.
3. Sidebar and desktop integration do not show actionable update/uninstall controls.
4. Memory Evolve opens its settings and performs one harmless memory action.
5. GenUI renders one minimal example from its documented demo.
6. Prompt Enhance rewrites one draft, supports cancel and restores the original draft.
7. Markdown and HTML still open in Better Sidebar.

Wait for user confirmation before continuing.

- [ ] **Step 3: Perform removal and account-isolation checks**

In the DEV account, uninstall one new factory plugin, restart and confirm it stays absent for that account. Sign into a second test account and confirm its fresh Profile still contains the factory plugin. Write a harmless Memory Evolve record in one account and confirm the other account cannot see it. Create or select a harmless test skill through Memory Evolve and confirm both accounts see the same device-level skill library; remove test residue afterward.

This verifies the accepted temporary behavior: dsh-market actions are Profile-scoped, while the skill library is intentionally device-scoped.

- [ ] **Step 4: Verify the unpacked local application**

Run: `npm run package:dev:dir`

Expected: the app in `dist-dev` starts with all plugins, login works and the DEV acceptance subset passes. Compare the unpacked application size with the last accepted build and record the plugin-related delta. Wait for user confirmation.

- [ ] **Step 5: Verify a local DMG**

Run: `npm run package:dev:mac:arm64`

Expected: the DMG installs and passes login, Market, three plugin core paths and Sidebar checks. Use the documented development quarantine workaround only if macOS blocks the unsigned app. Wait for user confirmation before GitHub Actions.

- [ ] **Step 6: Update durable build notes and commit**

Append any new plugin, Profile, pnpm or packaging issue to `docs/client-build-runbook.md`; create an incident document only when the issue has a distinct cause chain. Record exact Core Runtime tag and manual results in the design document.

```bash
git add docs/client-build-runbook.md docs/plans/2026-09-04-bundled-plugin-market-design.md
git commit -m "docs: record bundled plugin verification"
```

## Plan self-review

- Scope: only three factory plugins, build inputs, focused verification and required-package Market filtering are implemented.
- Explicit deferrals: device-wide account synchronization, external management platform, server policy, generic plugin CLI and new management UI are absent.
- Version consistency: every task uses Memory Evolve `0.1.0`, GenUI `0.9.8` and Prompt Enhance `0.1.9`; At File is excluded everywhere.
- User behavior: dsh-market remains the control surface and operations continue to affect the active Profile only.
- Verification: individual package checks precede combined DEV, directory app, DMG and GitHub Actions.
