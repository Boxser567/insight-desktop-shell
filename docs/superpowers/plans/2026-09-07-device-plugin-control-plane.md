# Device Plugin Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Insight Desktop one manifest-driven plugin lifecycle in which factory and user plugins are reproducible, device-installed, enabled by default for every account, and removable from the whole device according to policy.

**Architecture:** Shell owns a repository manifest, vendored plugin artifacts and a device registry. DSH continues to install and execute packages in account Profiles; Shell captures deliberate Profile changes and reconciles every account against the device registry before that account starts. dshmarket remains a catalog and UI, while required-package protection and device scope come from Shell policy.

**Tech Stack:** Electron main process, TypeScript, Node.js ESM scripts, DSH CLI, pnpm Profile workspaces, JSON atomic files, SHA-256, Vitest.

## Global Constraints

- The governing design is `docs/plans/2026-09-07-device-plugin-control-plane-design.md`.
- Device-wide: plugin installation, version update, factory removal tombstone and uninstall.
- Account-wide: disable override, plugin configuration, credentials, cache, memory, conversations and business assets.
- Every imported plugin is enabled by default for every account; an account may explicitly disable its own activation.
- Required packages are `@insight-ai/desktop-integration@0.1.0` and `dsh-better-sidebar@0.16.1`.
- Bundled optional packages are `dshmarket@1.41.0`, `dsh-memory-evolve@0.1.0` from tag `v26082401`, `@changfenhuang/dsh-genui@0.9.8` from tag `v0.9.8`, and `dsh-prompt-enhance@0.1.9` from tag `v0.1.9`.
- Do not bundle `dsh-at-file@0.7.0`: locked Core commit `833f4246abaf3ce5fcf39c3f81a8be2499e7f434` already composes the official file-reference packages.
- Factory Profile composition consumes only repository-local artifacts; it never fetches GitHub or npm.
- A community package build script is denied unless its package name is explicitly approved in the manifest. Do not widen the existing `node-pty` allowance to every plugin.
- No plugin receives account tokens, Cookies, account IDs or arbitrary Electron IPC from its installation mode.
- Support macOS arm64/x64 and Windows x64. Do not add Linux packaging work.
- Stop at each manual checkpoint. Do not create a DMG or dispatch GitHub Actions until the preceding DEV and directory-app checks pass.

---

### Task 1: Define and validate the repository plugin manifest

**Files:**
- Create: `plugins/README.md`
- Create: `scripts/plugin-manifest.mjs`
- Create: `scripts/plugin-manifest.d.mts`
- Create: `test/plugin-manifest.test.ts`

**Interfaces:**
- Produces: `parseDesktopPluginManifest(value): DesktopPluginManifest`.
- Produces: `readDesktopPluginManifest(projectRoot): Promise<DesktopPluginManifest>`.
- Produces: `requiredPluginNames(manifest): string[]` and `bundledPluginEntries(manifest): DesktopPluginEntry[]`.

- [ ] **Step 1: Write failing manifest validation tests**

Create table-driven tests that accept the three install modes and reject a floating version, missing artifact, missing digest, `defaultEnabled: false`, duplicate package name, a `user` entry in the repository factory manifest, and a required package whose `updateOwner` is not `shell`.

```ts
it('rejects a floating factory version', () => {
  expect(() => parseDesktopPluginManifest({
    schemaVersion: 1,
    plugins: [{
      packageName: 'example',
      displayName: 'Example',
      version: '^1.2.3',
      installMode: 'bundled-optional',
      defaultEnabled: true,
      updateOwner: 'user',
      artifact: 'artifacts/example-1.2.3.tgz',
      sha256: 'a'.repeat(64)
    }]
  })).toThrow('exact version')
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run test/plugin-manifest.test.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement the manifest parser**

Use a closed install-mode union and validate all fields at the file boundary:

```ts
export interface DesktopPluginEntry {
  packageName: string
  displayName: string
  version: string
  installMode: 'required' | 'bundled-optional'
  defaultEnabled: true
  updateOwner: 'shell' | 'user'
  artifact: string
  sha256: string
  source: { type: 'npm' | 'git'; url: string; ref: string; commit?: string }
  allowedBuildPackages: string[]
}

export interface DesktopPluginManifest {
  schemaVersion: 1
  catalogRevision: number
  plugins: DesktopPluginEntry[]
}
```

Require artifact paths to remain under `plugins/artifacts`, digests to match `/^[a-f0-9]{64}$/u`, versions to pass `semver.valid`, Git sources to use an immutable tag plus commit, and npm sources to equal `${packageName}@${version}`. Treat desktop integration as a workspace artifact entry with a local-source discriminant rather than pretending it came from npm.

- [ ] **Step 4: Document manifest ownership and generated values**

`plugins/README.md` states that `desktop-plugins.json` is created and modified by Task 2's CLI, artifact digests are never typed by hand, `build/bundled-profile` is generated and ignored, and `plugins/artifacts` is a reviewed source input rather than disposable build output.

- [ ] **Step 5: Run the focused tests**

Run: `npx vitest run test/plugin-manifest.test.ts`

Expected: parser tests pass against fixtures without requiring real artifacts.

- [ ] **Step 6: Commit the manifest foundation**

```bash
git add plugins/README.md scripts/plugin-manifest.mjs scripts/plugin-manifest.d.mts test/plugin-manifest.test.ts
git commit -m "feat(plugins): define desktop plugin manifest"
```

### Task 2: Vendor reproducible factory artifacts and record admission evidence

**Files:**
- Create: `plugins/desktop-plugins.json`
- Create: `scripts/plugin-manager.mjs`
- Create: `scripts/plugin-artifact.mjs`
- Create: `scripts/plugin-artifact.d.mts`
- Create: `test/plugin-artifact.test.ts`
- Create: `plugins/artifacts/*.tgz`
- Create: `plugins/licenses/*`
- Create: `plugins/THIRD_PARTY_NOTICES.md`
- Create: `docs/plugin-admission.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 manifest parser.
- Produces: `vendorNpmArtifact(specifier, destination)` and `vendorGitArtifact(repository, ref, expectedCommit, destination)`.
- Produces: `inspectPluginArtifact(path): Promise<PluginArtifactInspection>`.
- Produces: `npm run plugins -- vendor-npm ...`, `vendor-git ...`, and `doctor`.

- [ ] **Step 1: Write failing artifact inspection tests**

Cover a valid `.tgz`, package-name mismatch, package-version mismatch, path traversal member, missing `package.json`, missing `main` output, missing `dsh.bundle.patch`, unexpected lifecycle script and digest mismatch.

```ts
it('rejects an artifact whose runtime entry is absent', async () => {
  await expect(inspectPluginArtifact(archiveWithoutMain)).rejects.toThrow(
    'declared runtime entry lib/index.js is missing'
  )
})
```

- [ ] **Step 2: Implement staging, packing and SHA-256 calculation**

Every vendor operation must use `mkdtemp`, verify the checked-out commit, run the repository's declared check/build command with CI enabled, pack into staging, inspect the tar entries, calculate SHA-256, copy to `plugins/artifacts/<safe-name>-<version>.tgz`, then atomically update the manifest. Failure removes staging and leaves both the old artifact and manifest untouched.

Never invoke a package lifecycle script from the packed artifact. Building the cloned source and installing the packed artifact are separate steps.

- [ ] **Step 3: Add explicit build-script approval**

The manifest's `allowedBuildPackages` defaults to `[]`. The doctor rejects a package whose production dependency graph requests an install script unless that exact package appears in the entry's list. Keep `node-pty` only where the current DSH Profile needs it; do not add the four community root packages to the allowlist without evidence.

- [ ] **Step 4: Add the CLI entry and initialize the manifest**

Create `scripts/plugin-manager.mjs` with stable commands and exit codes, then add `"plugins": "node scripts/plugin-manager.mjs"` to `package.json`. `npm run plugins -- init` creates `plugins/desktop-plugins.json` with `schemaVersion: 1`, `catalogRevision: 1` and the desktop integration workspace entry. It refuses to overwrite an existing manifest.

- [ ] **Step 5: Vendor the existing required and market packages**

Run the new exact-version commands:

```bash
npm run plugins -- vendor-npm dsh-better-sidebar@0.16.1 --mode required
npm run plugins -- vendor-npm dshmarket@1.41.0 --mode bundled-optional
```

Expected: two tracked `.tgz` files, exact hashes in the manifest, and license records.

- [ ] **Step 6: Vendor and audit the three accepted community plugins one at a time**

Run:

```bash
npm run plugins -- vendor-git https://github.com/csyangwen/dsh-memory-evolve v26082401 --commit 21d2a8518bc608c2958b08733f5b5eaf6b514c9c --mode bundled-optional
npm run plugins -- vendor-git https://github.com/omdsh-dev/dsh-genui v0.9.8 --commit 680693eda677926942c11a499c476c55587d97c1 --mode bundled-optional
npm run plugins -- vendor-git https://github.com/rongxingda/dsh-prompt-enhance v0.1.9 --commit ed535fbdf0a10d777e43a1f3130d5ffb4b94a5c2 --mode bundled-optional
```

After each command, run `npm run plugins -- doctor <package-name>`. Stop before the next plugin if build, license, digest, entry or peer checks fail.

- [ ] **Step 7: Record the rejected At File candidate**

In `docs/plugin-admission.md`, record `dsh-at-file@0.7.0` as rejected for the locked Runtime. Cite the Runtime's `@deepseek-ai/dsh-file-reference-local` and `@deepseek-ai/dsh-client-ui-reference` bundle entries and the plugin maintainer's recommendation to prefer the official implementation. Do not add its archive to `plugins/artifacts` or its package to the manifest.

- [ ] **Step 8: Run artifact tests and complete notices**

Run:

```bash
npx vitest run test/plugin-artifact.test.ts test/plugin-manifest.test.ts
npm run plugins -- doctor
git diff --check
```

Expected: all five third-party shipped packages have exact artifact hashes and license entries; desktop integration remains a local workspace artifact.

- [ ] **Step 9: Commit artifacts and admission records**

```bash
git add scripts/plugin-manager.mjs scripts/plugin-artifact.mjs scripts/plugin-artifact.d.mts test/plugin-artifact.test.ts plugins docs/plugin-admission.md package.json
git commit -m "build(plugins): vendor factory plugin artifacts"
```

### Task 3: Compose the bundled Profile only from the manifest

**Files:**
- Modify: `scripts/prepare-bundled-profile.mjs`
- Modify: `scripts/patch-bundled-market.mjs`
- Modify: `scripts/patch-bundled-market.d.mts`
- Create: `scripts/prepare-plugin-manifest.mjs`
- Modify: `package.json`
- Modify: `test/bundled-profile.test.ts`
- Modify: `test/authenticated-sidebar-contract.test.ts`
- Modify: `test/release.test.ts`

**Interfaces:**
- Consumes: `bundledPluginEntries()` and local artifact paths.
- Produces: `build/bundled-profile/web` and `build/plugin-manifest.json` from the same source manifest.
- Produces: an installer resource named `plugin-manifest.json`.

- [ ] **Step 1: Replace hard-coded package assertions with manifest fixtures**

Add a test fixture containing required, bundled optional and workspace entries. Assert that every factory entry is an exact dependency and DSH bundle, its installed package version matches, and the normalized runtime manifest contains the same package, version and mode.

```ts
for (const entry of manifest.plugins) {
  expect(profile.dependencies[entry.packageName]).toBe(entry.installSpecifier)
  expect(profile.dsh.profile.bundles).toContain(entry.packageName)
}
```

- [ ] **Step 2: Run focused tests and confirm the hard-coded builder fails**

Run: `npx vitest run test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts test/release.test.ts`

Expected: FAIL because the builder knows only Sidebar, Market and desktop integration.

- [ ] **Step 3: Make Profile composition data-driven**

Remove `SIDEBAR_PACKAGE`, `MARKET_PACKAGE` and their version constants from `prepare-bundled-profile.mjs`. Copy each local artifact into the temporary Profile's `.insight-artifacts/` directory, loop over the validated manifest in stable order and pass its relative `.tgz` path to the existing DSH `plugin add --save-exact` command. The resulting Profile must retain `.insight-artifacts` so repair never points back to the Shell checkout. Add `--allow-build=<comma-separated exact allowlist>` only when the resolved entry has approved build packages.

Keep desktop integration's workspace copy path and bundle entry, but derive its policy classification from the manifest.

- [ ] **Step 4: Generate and package the runtime policy manifest**

`prepare-plugin-manifest.mjs` writes only package name, display name, version, install mode, default enabled flag, update owner and digest to `build/plugin-manifest.json`. Do not expose development repository paths. Add the file to `build.extraResources` in `package.json`.

- [ ] **Step 5: Preserve existing-account choices**

Do not replace an existing version-three Profile. New accounts copy the complete template. Existing account installation of newly introduced optional packages is handled by the device registry migration in Task 4, while an existing dshmarket absence is preserved as a removal tombstone.

- [ ] **Step 6: Verify the generated template without packaging**

Run:

```bash
npm run prepare:core-runtime
npm run prepare:bundled-profile
npm run plugins -- doctor
npx vitest run test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts test/release.test.ts
```

Expected: the generated Profile contains Sidebar, Market, Memory Evolve, GenUI, Prompt Enhance and desktop integration; it does not contain `dsh-at-file`.

- [ ] **Step 7: Commit manifest-driven composition**

```bash
git add scripts/prepare-bundled-profile.mjs scripts/patch-bundled-market.mjs scripts/patch-bundled-market.d.mts scripts/prepare-plugin-manifest.mjs package.json test/bundled-profile.test.ts test/authenticated-sidebar-contract.test.ts test/release.test.ts
git commit -m "feat(profile): compose factory plugins from manifest"
```

### Task 4: Add the atomic device plugin registry

**Files:**
- Create: `src/main/plugins/device-plugin-paths.ts`
- Create: `src/main/plugins/device-plugin-registry.ts`
- Create: `src/main/plugins/factory-plugin-seed.ts`
- Create: `test/device-plugin-registry.test.ts`
- Create: `test/factory-plugin-seed.test.ts`

**Interfaces:**
- Produces: `DevicePluginRecord`, `DevicePluginRegistrySnapshot` and `DevicePluginRegistry`.
- Produces: `seedFactoryPlugins(registry, packagedManifest, packagedArtifacts, activeProfile): Promise<SeedResult>`.

- [ ] **Step 1: Write registry transaction tests**

Cover first creation, import replacement, exact-version update, bundled optional tombstone, required removal rejection, corrupt registry backup, failed staging cleanup and path traversal rejection.

```ts
it('keeps a factory removal across a later seed', async () => {
  await registry.seed(factoryEntry)
  await registry.remove(factoryEntry.packageName)
  await registry.seed(factoryEntry)
  expect((await registry.read()).installed).not.toHaveProperty(factoryEntry.packageName)
  expect((await registry.read()).removedFactory).toContain(factoryEntry.packageName)
})
```

- [ ] **Step 2: Implement device-owned paths**

Use `<userData>/insight/plugins` with:

```text
registry.json
packages/<encoded-package-name>/<version>/package.tgz
staging/<random-uuid>/
backups/registry-<timestamp>.json
```

Resolve every child path and assert it remains inside the device plugin root. Never use package names directly as unchecked paths.

- [ ] **Step 3: Implement the registry record**

```ts
export interface DevicePluginRecord {
  packageName: string
  version: string
  origin: 'factory' | 'user-local' | 'market'
  installMode: 'required' | 'bundled-optional' | 'user'
  artifactRelativePath: string
  sha256: string
  installedAt: string
}

export interface DevicePluginRegistrySnapshot {
  schemaVersion: 1
  catalogRevision: number
  installed: Record<string, DevicePluginRecord>
  removedFactory: string[]
}
```

Writes use a temporary sibling plus rename. A corrupt registry is backed up and startup enters a recoverable registry error; it must not silently reseed removed plugins.

- [ ] **Step 4: Implement first seed and legacy migration**

On a truly new device registry, copy factory `.tgz` files into the device package store and add every factory package. When migrating an existing version-three Profile, preserve an absent `dshmarket` as `removedFactory`; add the three newly introduced optional packages because they have not previously been offered. Required entries always remain installed.

- [ ] **Step 5: Verify and commit the registry**

Run: `npx vitest run test/device-plugin-registry.test.ts test/factory-plugin-seed.test.ts`

Expected: PASS, including the no-restoration case.

```bash
git add src/main/plugins/device-plugin-paths.ts src/main/plugins/device-plugin-registry.ts src/main/plugins/factory-plugin-seed.ts test/device-plugin-registry.test.ts test/factory-plugin-seed.test.ts
git commit -m "feat(plugins): add device plugin registry"
```

### Task 5: Reconcile device plugins into every account Profile

**Files:**
- Create: `src/main/plugins/profile-plugin-inventory.ts`
- Create: `src/main/plugins/reconcile-device-plugins.ts`
- Create: `src/main/plugins/capture-profile-plugin-changes.ts`
- Modify: `src/main/workspace/harness-workspace-controller.ts`
- Modify: `src/main/index.ts`
- Create: `test/profile-plugin-inventory.test.ts`
- Create: `test/reconcile-device-plugins.test.ts`
- Create: `test/capture-profile-plugin-changes.test.ts`
- Modify: `test/workspace-lifecycle.test.ts`

**Interfaces:**
- Consumes: Device registry and existing `addProfilePluginWithDsh` / `removeProfilePluginWithDsh`.
- Produces: `reconcileDevicePlugins(options): Promise<ReconcileResult>`.
- Produces: `captureProfilePluginChanges(options): Promise<CaptureResult>`.

- [ ] **Step 1: Write two-account lifecycle tests**

Prove that one import installs in account A immediately, account B receives it before its next Runtime start, both default to enabled, disabling A does not disable B, and uninstalling from B prevents A from loading it on A's next start.

```ts
it('treats a manifest removal as a device uninstall', async () => {
  await captureProfilePluginChanges(optionsFor(accountBWithoutPlugin))
  expect((await registry.read()).installed).not.toHaveProperty('demo-plugin')
  await reconcileDevicePlugins(optionsFor(accountA))
  expect(remove).toHaveBeenCalledWith(expect.anything(), 'demo-plugin')
})
```

- [ ] **Step 2: Distinguish removal from damage**

Read both account Profile `package.json` and physical package presence. If the dependency remains but `node_modules/<package>` is missing, report damage and run repair. If the dependency and bundle entry were deliberately removed, capture a device uninstall. Never infer uninstall from a missing directory alone.

- [ ] **Step 3: Reconcile before Runtime start**

After bundled Profile initialization and store pinning, but before `runtime.start()`, install missing device records and remove tombstoned records. Use the local device `.tgz` as the add source. Process packages serially in manifest order so startup logs identify the exact failing package.

Account-specific `disabled: true` patch entries remain untouched. A new plugin has no disabled override, so every account enables it by default.

- [ ] **Step 4: Capture Market changes after Runtime stop**

When Workspace stops or switches account, stop Runtime first, then compare the Profile manifest with the previous device snapshot. Pack newly installed or updated package roots into device staging, inspect them and update registry. Convert deliberate removal of a removable package to a device tombstone. Reject any attempted change to a required package and restore it from the factory artifact.

- [ ] **Step 5: Keep inactive-account cleanup lazy but fail-closed**

Do not run multiple pnpm installs concurrently across every account directory. The registry change is immediate; each inactive account reconciles before its next Runtime start. Record pending account cleanup in logs, and ensure no Runtime starts between registry read and reconciliation completion.

- [ ] **Step 6: Run focused lifecycle tests and typecheck**

Run:

```bash
npx vitest run test/profile-plugin-inventory.test.ts test/reconcile-device-plugins.test.ts test/capture-profile-plugin-changes.test.ts test/workspace-lifecycle.test.ts
npm run typecheck
```

Expected: all lifecycle tests pass and no account-owned path appears in the device registry.

- [ ] **Step 7: Commit account reconciliation**

```bash
git add src/main/plugins src/main/workspace/harness-workspace-controller.ts src/main/index.ts test/profile-plugin-inventory.test.ts test/reconcile-device-plugins.test.ts test/capture-profile-plugin-changes.test.ts test/workspace-lifecycle.test.ts
git commit -m "feat(plugins): reconcile device plugins across accounts"
```

### Task 6: Route local import, uninstall and Safe Mode through device policy

**Files:**
- Modify: `src/main/state/local-plugin-import.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/safe-mode.ts`
- Modify: `src/main/state/plugin-recovery.ts`
- Modify: `src/main/state/installation-owned-bundles.ts`
- Modify: `test/local-plugin-import.test.ts`
- Modify: `test/safe-mode.test.ts`
- Modify: `test/plugin-recovery.test.ts`
- Modify: `test/runtime.test.ts`

**Interfaces:**
- Consumes: manifest policy and device registry.
- Produces: one device-wide import/remove path used by the picker, Safe Mode and recovery UI.

- [ ] **Step 1: Expand local-import validation tests**

Require package name, exact semver version, runtime entry, bundle patch and archive safety. Add a test that a selected source directory is removed after selection but the staged device artifact remains usable.

- [ ] **Step 2: Change import order to registry first, active Profile second**

Copy or pack the selected path into device staging, validate, commit the registry transaction, stop Runtime, reconcile the current Profile and restart. If Profile installation fails, retain the device record with a failed health state and show a recovery action; do not keep a permanent pointer to Downloads.

The success copy is: `已添加到此设备，并为所有账号默认启用。`

- [ ] **Step 3: Replace the two-name ownership helper with manifest policy**

`isInstallationOwnedBundle(packageName)` becomes a thin call to the loaded packaged manifest and returns true only for `required`. Tests must continue proving that Sidebar and desktop integration are protected and Market plus the three community packages are removable.

- [ ] **Step 4: Make Safe Mode removal device-wide**

Safe Mode lists only `bundled-optional` and `user` records. Removing one writes the device tombstone/registry transaction, cleans current Profile components and removes the current Profile dependency. Its confirmation text is `从此设备卸载` and states that every account is affected.

- [ ] **Step 5: Verify recovery behavior**

Run:

```bash
npx vitest run test/local-plugin-import.test.ts test/safe-mode.test.ts test/plugin-recovery.test.ts test/runtime.test.ts
npm run typecheck
```

Expected: required packages never become recovery removal targets; all other installed records can be removed device-wide.

- [ ] **Step 6: Commit device-scoped user actions**

```bash
git add src/main/state/local-plugin-import.ts src/main/index.ts src/main/safe-mode.ts src/main/state/plugin-recovery.ts src/main/state/installation-owned-bundles.ts test/local-plugin-import.test.ts test/safe-mode.test.ts test/plugin-recovery.test.ts test/runtime.test.ts
git commit -m "feat(plugins): make user plugin actions device scoped"
```

### Task 7: Remove required packages from Market inventory and updates

**Files:**
- Modify: `scripts/patch-bundled-market.mjs`
- Modify: `scripts/patch-bundled-market.d.mts`
- Modify: `test/bundled-market-policy.test.ts`

**Interfaces:**
- Consumes: required package names from the repository manifest.
- Produces: a fail-closed dshmarket adaptation for list, update and uninstall routes.

- [ ] **Step 1: Write response-filtering tests**

Build route fixtures for `/installed` and `/updates` containing Sidebar, desktop integration and dshmarket. After adaptation, evaluate the extracted filtering helper or assert injected source calls `isProtectedModule` before serialization. Keep idempotence coverage.

```ts
expect(filterInstalled([
  { name: 'dsh-better-sidebar' },
  { name: 'dshmarket' }
])).toEqual([{ name: 'dshmarket' }])
```

- [ ] **Step 2: Derive protection from the manifest**

Pass the required names into `patchBundledMarket(profileDirectory, requiredNames)`. Generate escaped exact-match patterns and reject an empty required set. Keep 403 guards on update and uninstall.

- [ ] **Step 3: Filter required packages from `/installed` and `/updates`**

Patch the pinned route source immediately before its JSON response is written. If the pinned source anchors differ, fail the Profile build with a message that names the missing route. Do not alter dshmarket client CSS, DOM, title, description or unrelated update rows.

- [ ] **Step 4: Verify the focused policy and generated Profile**

Run:

```bash
npx vitest run test/bundled-market-policy.test.ts
npm run prepare:bundled-profile
```

Expected: required packages are absent from installed/update responses; dshmarket and removable plugins remain visible.

- [ ] **Step 5: Commit the Market filter**

```bash
git add scripts/patch-bundled-market.mjs scripts/patch-bundled-market.d.mts test/bundled-market-policy.test.ts
git commit -m "fix(plugins): hide required packages from market"
```

### Task 8: Expose a developer inventory and read-only built-in component view

**Files:**
- Modify: `scripts/plugin-manager.mjs`
- Create: `src/shared/plugin-inventory-contract.ts`
- Create: `src/main/plugins/plugin-inventory.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/harness-account-api.ts`
- Modify: `src/preload/harness.ts`
- Modify: `packages/insight-desktop-integration/src/client/components.tsx`
- Modify: `packages/insight-desktop-integration/src/client/index.tsx`
- Create: `test/plugin-inventory.test.ts`
- Modify: `test/harness-account-ipc.test.ts`
- Modify: `test/desktop-integration-client.test.ts`

**Interfaces:**
- Produces: `PluginInventoryItem { packageName; displayName; version; installMode; origin; health; enabled }`.
- Produces: read-only `harnessAccount.getPluginInventory()`.
- Produces: `npm run plugins -- inventory`, `doctor`, `compose` and `smoke` with stable exit codes.

- [ ] **Step 1: Test inventory redaction and classification**

Assert that inventory contains package identity, mode, origin and health but excludes artifact absolute paths, account scope, tokens, configuration values and plugin-owned data.

- [ ] **Step 2: Add read-only IPC**

Only the trusted Harness frame can request inventory. Build the response from packaged policy, device registry and current Profile; do not expose a generic filesystem or plugin-command IPC.

- [ ] **Step 3: Render required components under Client settings**

Add a compact “内置组件” group showing required component name, version and health. It has no toggle, update or uninstall button. Leave removable plugins in dshmarket and existing plugin settings.

- [ ] **Step 4: Complete developer commands**

`doctor` runs manifest, artifact, license, peer and duplicate-capability checks. `compose` invokes the Profile preparation only after doctor passes. `smoke <package>` creates a disposable Profile containing Core base/web plus that package, starts the packaged smoke harness with a bounded timeout and removes the directory afterward.

Use exit codes: 0 success, 1 validation/load failure, 2 invalid command arguments.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run test/plugin-inventory.test.ts test/harness-account-ipc.test.ts test/desktop-integration-client.test.ts
npm run plugins -- inventory
npm run plugins -- doctor
```

Expected: required components are read-only and no sensitive field crosses IPC.

- [ ] **Step 6: Commit management surfaces**

```bash
git add scripts/plugin-manager.mjs src/shared/plugin-inventory-contract.ts src/main/plugins/plugin-inventory.ts src/main/index.ts src/shared/harness-account-api.ts src/preload/harness.ts packages/insight-desktop-integration/src/client/components.tsx packages/insight-desktop-integration/src/client/index.tsx test/plugin-inventory.test.ts test/harness-account-ipc.test.ts test/desktop-integration-client.test.ts
git commit -m "feat(plugins): expose controlled plugin inventory"
```

### Task 9: Verify plugins individually, then as one product

**Files:**
- Create: `docs/plugin-management.md`
- Modify: `docs/client-build-runbook.md`
- Modify: `docs/authenticated-client-baseline.md`
- Modify: `docs/plans/2026-09-07-device-plugin-control-plane-design.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a repeatable developer runbook and recorded manual acceptance.

- [ ] **Step 1: Document the exact operator flow**

`docs/plugin-management.md` must include inventory, vendor from exact npm version, vendor from exact Git tag/commit, local user import, doctor, single-plugin smoke, combined compose, device uninstall, restore factory plugin, registry paths, account reconciliation and recovery. Link the design instead of duplicating rationale.

- [ ] **Step 2: Run the low-cost automated curve**

Run:

```bash
npx vitest run test/plugin-manifest.test.ts test/plugin-artifact.test.ts test/device-plugin-registry.test.ts test/factory-plugin-seed.test.ts test/reconcile-device-plugins.test.ts test/capture-profile-plugin-changes.test.ts test/bundled-market-policy.test.ts
npm run plugins -- doctor
npm run typecheck
npm test
npm run build
npm run prepare:bundled-profile
```

Expected: all commands exit 0. Record only the commands actually run in the handoff.

- [ ] **Step 3: Run one disposable smoke per plugin**

Run in this order and stop at the first failure:

```bash
npm run plugins -- smoke dsh-memory-evolve
npm run plugins -- smoke @changfenhuang/dsh-genui
npm run plugins -- smoke dsh-prompt-enhance
npm run plugins -- smoke dshmarket
npm run plugins -- smoke dsh-better-sidebar
```

Expected: each Host reaches ready, its client entry loads without console errors, and the process exits cleanly.

- [ ] **Step 4: Perform DEV manual acceptance**

Use a fresh device registry and two test accounts:

1. Both accounts show Market, Memory Evolve, GenUI and Prompt Enhance enabled by default.
2. Sidebar opens Markdown and HTML.
3. GenUI renders one documented simple component.
4. Prompt Enhance opens preview and restores the draft on cancel.
5. Memory Evolve writes a harmless test memory in account A; account B cannot see it.
6. Disable Prompt Enhance in A; it remains enabled in B.
7. Uninstall GenUI in B; after switching back, A removes it before Runtime start.
8. Restart twice; GenUI stays removed and required components remain healthy.
9. Market no longer lists required packages or their updates.

Record pass/fail and exact Runtime tag. Do not package on any failure.

- [ ] **Step 5: Verify the unpacked local application**

Run: `npm run package:dev:dir`

Expected: the app under `dist-dev` starts, the packaged `plugin-manifest.json` matches the Profile, and the DEV acceptance subset passes. Wait for user confirmation.

- [ ] **Step 6: Verify local DMG, then stop for approval**

Run: `npm run package:dev:mac:arm64`

Expected: DMG installs after the documented development quarantine workaround, login and plugin acceptance pass. Do not trigger GitHub Actions until the user confirms.

- [ ] **Step 7: Update durable build knowledge and commit**

Append any new Profile, plugin, pnpm, macOS or Windows problem to `docs/client-build-runbook.md`. Create an incident document only for a distinct cause chain. Then run `git diff --check` and commit:

```bash
git add docs/plugin-management.md docs/client-build-runbook.md docs/authenticated-client-baseline.md docs/plans/2026-09-07-device-plugin-control-plane-design.md
git commit -m "docs: record desktop plugin operations"
```

## Plan self-review

- Spec coverage: device-wide installation/update/uninstall, all-account default enablement, account-isolated data, factory artifacts, developer commands, required protection, Market filtering, three admitted community plugins, At File conflict rejection and staged verification all have owning tasks.
- Scope split: signed server policy is intentionally excluded from this plan and specified in `2026-09-07-plugin-remote-policy.md`; Core process isolation is not implied.
- Consistency: every task uses the exact versions in Global Constraints and the same `required` / `bundled-optional` / `user` meanings.
- Safety: no step copies raw source into `node_modules`, accepts floating refs, enables arbitrary lifecycle scripts or dispatches packaging before manual checks.
