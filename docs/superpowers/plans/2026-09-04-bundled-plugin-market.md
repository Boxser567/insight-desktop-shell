# Bundled Plugin Market Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `dshmarket@1.41.0` in the initial Insight Desktop Profile while keeping it user-removable and retaining Sidebar and desktop-integration as required capabilities.

**Architecture:** The Shell builder creates one Profile template containing Sidebar, the pinned market, and the desktop integration. New accounts copy that template once. Existing Profiles retain their choices, while the recovery classifier treats the market as a removable third-party root bundle.

**Tech Stack:** Electron main process, Node.js scripts, DSH CLI, pnpm Profile workspace, Vitest.

## Global Constraints

- Pin `dshmarket` to `1.41.0`; never fetch it during first application launch.
- `dsh-better-sidebar@0.16.1` and `@insight-ai/desktop-integration` remain non-removable.
- Do not change Core Runtime, `core-runtime.lock.json`, authentication, account isolation, UI layout, or release workflows.
- Existing version-three Profiles that lack or removed the market must not receive it from an application update.
- The market and other non-first-party plugins gain no token, Cookie, account ID, path, filesystem, or arbitrary Electron IPC access.
- Run focused tests before broader checks. Do not package before DEV manual acceptance.

---

### Task 1: Create a complete pinned Profile template

**Files:**
- Modify: `scripts/prepare-bundled-profile.mjs:8-55,150-170`
- Modify: `test/bundled-profile.test.ts:8-245`
- Modify: `test/authenticated-sidebar-contract.test.ts:35-75`

**Interfaces:**
- Consumes: `dsh plugin --profile web add --save-exact --allow-build=node-pty <package>` and locked Runtime Node/pnpm binaries.
- Produces: `build/bundled-profile/web` with Sidebar, `dshmarket@1.41.0`, and desktop integration in its manifest, lockfile and `node_modules`.

- [ ] **Step 1: Write failing template assertions**

Update the complete-template fixture to include exact `dshmarket: '1.41.0'` in `dependencies` and `'dshmarket'` in `dsh.profile.bundles`. Add one test that a new `dshHome` copied from the template contains the market. Add another where an existing version-three Profile has no market: after `initializeBundledProfile()` it must still have no market, but must refresh the desktop integration.

- [ ] **Step 2: Verify the tests fail before the build-script change**

Run:

```bash
npx vitest run test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts
```

Expected: the new dependency and physical package assertions fail because the builder only prepares Sidebar.

- [ ] **Step 3: Add the pinned market to the builder**

In `scripts/prepare-bundled-profile.mjs`, declare:

```js
const MARKET_PACKAGE = 'dshmarket'
const MARKET_VERSION = '1.41.0'
```

Rename `hasPinnedSidebar()` to a readiness predicate that also requires the exact market dependency. Extend `templateIsReady()` to require `node_modules/dshmarket/package.json`. In the fresh temporary Profile path, run the existing DSH `plugin add` form for Sidebar and then `${MARKET_PACKAGE}@${MARKET_VERSION}`, using `--save-exact --allow-build=node-pty` for both, before the existing final `plugin install`.

Do not raise `DEFAULT_PROFILE_VERSION`: its version-three path deliberately refreshes only installation-owned code for existing accounts; adding the market there would silently undo a user choice.

- [ ] **Step 4: Extend generated-template contract coverage**

Make `test/authenticated-sidebar-contract.test.ts` check exact Sidebar and market versions, membership of both bundles, and physical `node_modules/dshmarket/package.json`. Keep the desktop integration build-byte equality assertion.

- [ ] **Step 5: Verify the generated template**

Run:

```bash
npx vitest run test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts
npm run prepare:bundled-profile
node -e "const j=require('./build/bundled-profile/web/package.json'); if (j.dependencies.dshmarket !== '1.41.0' || !j.dsh.profile.bundles.includes('dshmarket')) process.exit(1)"
test -f build/bundled-profile/web/node_modules/dshmarket/package.json
```

Expected: tests pass and the template contains the exact market package.

- [ ] **Step 6: Commit the Profile change**

```bash
git add scripts/prepare-bundled-profile.mjs test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts
git commit -m "feat(profile): bundle the plugin market"
```

### Task 2: Treat the market as removable and required packages as protected

**Files:**
- Modify: `src/main/state/installation-owned-bundles.ts:1-10`
- Modify: `src/main/state/plugin-recovery.ts:62-90,495-520`
- Modify: `src/main/runtime/harness-runtime.ts:573-592`
- Modify: `test/plugin-recovery.test.ts:50-80,220-245`
- Modify: `test/runtime.test.ts:437-505`

**Interfaces:**
- Consumes: `isThirdPartyPackageName()`, `listInstalledProfilePlugins()` and `extractOffendingPlugins()`.
- Produces: the market is visible to recovery/Safe Mode and can be uninstalled; `@deepseek-ai/*`, desktop integration, base and web-app remain ineligible.

- [ ] **Step 1: Write failing ownership tests**

Change Safe Mode's configured-root expectation to include `dshmarket` before ordinary user plugins. Change `isThirdPartyPackageName('dshmarket')` to expect `true`. Add an uninstall fixture that removes only `dshmarket` from dependency, bundle and lockfile importer entries while leaving Sidebar and desktop integration untouched. Add a runtime failure line for `dshmarket` and expect it from `extractOffendingPlugins()`, with an adjacent assertion that desktop integration is not actionable.

- [ ] **Step 2: Verify the existing core classification fails the new tests**

Run:

```bash
npx vitest run test/plugin-recovery.test.ts test/runtime.test.ts
```

Expected: failures show `dshmarket` is still included in both `CORE_BUNDLES` definitions.

- [ ] **Step 3: Remove only the false market classification**

In `src/main/state/installation-owned-bundles.ts`, add `dsh-better-sidebar` to the packages protected by `isInstallationOwnedBundle()`. In `src/main/state/plugin-recovery.ts`, make `CORE_BUNDLES` contain only `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`. Delete the no-target reset branch that manually puts `dshmarket` into `safeBundles`; otherwise reset would retain a bundle but delete its dependency. Apply the same two-package `CORE_BUNDLES` list in `src/main/runtime/harness-runtime.ts`. Do not weaken `@deepseek-ai/` or installation-owned protections.

- [ ] **Step 4: Verify recovery behavior**

Run:

```bash
npx vitest run test/plugin-recovery.test.ts test/runtime.test.ts
npm run typecheck
```

Expected: market is removable/actionable, required plugins remain protected, and TypeScript passes.

- [ ] **Step 5: Commit the ownership change**

```bash
git add src/main/state/installation-owned-bundles.ts src/main/state/plugin-recovery.ts src/main/runtime/harness-runtime.ts test/plugin-recovery.test.ts test/runtime.test.ts
git commit -m "fix(plugins): treat bundled market as removable"
```

### Task 3: Restore local import and document the verification curve

**Files:**
- Modify: `src/main/runtime/profile-plugin-command.ts:58-76`
- Modify: `test/profile-plugin-command.test.ts:55-86`
- Modify: `docs/client-build-runbook.md:24-58,165-220`
- Modify: `docs/authenticated-client-baseline.md:39-45,190-220`

**Interfaces:**
- Consumes: `buildProfilePluginAddArguments(dshEntryPath, packagePath)` and the Profile pnpm workspace.
- Produces: local import and recovery removal execute at the workspace root; add explicitly permits only runtime-required `node-pty` during profile package changes.

- [ ] **Step 1: Write the local-import regression assertion**

Set the expected add argv in `test/profile-plugin-command.test.ts` to:

```ts
[
  '/app/dsh/bin.js', 'plugin', '--profile', 'web', 'add',
  '--workspace-root', '--save-exact', '--allow-build=node-pty',
  '/Users/me/plugin.tgz'
]
```

This preserves the two conditions found in the temporary communication-plugin demonstration: pnpm must accept the Profile workspace root, and its runtime-required `node-pty` build must not be rejected. It does not approve arbitrary plugin postinstall scripts.

Change the remove argv expectation to `['plugin', '--profile', 'web', 'remove', '--workspace-root', '@example/plugin']`, because recovery removes from the same pnpm workspace root.

- [ ] **Step 2: Verify the regression fails, then make the command-only fix**

Run:

```bash
npx vitest run test/profile-plugin-command.test.ts
```

Expected: both argv checks mismatch. Change `buildProfilePluginRemoveArguments()` to insert `--workspace-root` after `remove`, then change `buildProfilePluginAddArguments()` to return:

```ts
[
  dshEntryPath, 'plugin', '--profile', PROFILE, 'add',
  '--workspace-root', '--save-exact', '--allow-build=node-pty', packagePath
]
```

- [ ] **Step 3: Record operating guidance**

In `docs/client-build-runbook.md`, add default-Profile checks for Sidebar, `dshmarket`, desktop integration and the generated lockfile before packaging. Add DEV acceptance: fresh account sees Plugin Market; uninstall it; restart; it remains absent; Markdown/HTML still use Sidebar.

In `docs/authenticated-client-baseline.md`, briefly record the preinstalled optional market, link `plans/2026-09-04-bundled-plugin-market-design.md`, and mark final manual evidence `not-yet-verified` until performed. Do not duplicate the design policy.

- [ ] **Step 4: Run automated pre-package checks**

Run:

```bash
npx vitest run test/profile-plugin-command.test.ts test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts test/plugin-recovery.test.ts test/runtime.test.ts
npm run typecheck
npm test
npm run build
npm run prepare:bundled-profile
```

Expected: all checks pass and `build/bundled-profile/web/node_modules/dshmarket/package.json` exists. Do not package or dispatch GitHub Actions yet.

- [ ] **Step 5: Perform DEV manual acceptance**

With a freshly prepared DEV application and new account scope, confirm:

1. Settings shows Plugin Market and it opens.
2. Local import can add one minimal valid plugin.
3. Markdown and HTML still open through Better Sidebar.
4. Uninstall `dshmarket`, restart the same app, and confirm it stays absent while login, settings, logout and Sidebar work.
5. A new account scope receives the market on first initialization.

Record application path, Core Runtime tag/commit, account scopes and results. On a failure, stop, preserve exact Profile manifest/lockfile/runtime logs/recovery view, and do not package.

- [ ] **Step 6: Commit the import fix and operating docs**

```bash
git add src/main/runtime/profile-plugin-command.ts test/profile-plugin-command.test.ts docs/client-build-runbook.md docs/authenticated-client-baseline.md
git commit -m "fix(plugins): support local profile package imports"
```

## Plan self-review

- Coverage: pinned build input, fresh Profile initialization, upgrade non-restoration, market removal, required-plugin protection, local import, documentation, automated checks and manual acceptance are all assigned.
- Exclusions: Core changes, market fork, Runtime upgrade, layout work, marketplace-policy changes and installer builds are deliberately out of scope.
- Consistency: every task uses `dshmarket@1.41.0`; no task changes `DEFAULT_PROFILE_VERSION`.
