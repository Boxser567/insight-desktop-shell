# Local Composed Development Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `dev:shell` and a single-package `dev:core -- ui-settings-general` workflow so frequent Shell and Core UI changes can be verified without publishing a Runtime or building an installer.

**Architecture:** Treat `build/core-runtime` as an immutable base. A Node orchestrator performs cheap readiness checks, creates a disposable composition Runtime for the one allowed Core package, projects only validated package artifacts, and starts electron-vite plus the Core watcher. The Electron Main process accepts composition paths only while unpackaged and restarts Harness after a successful artifact generation.

**Tech Stack:** Node.js 22+ ESM, Electron 43, electron-vite 5, TypeScript 5.9, pnpm 11, tsdown, Vitest 4.

## Global Constraints

- Do not modify, symlink into, or install packages inside `build/core-runtime`.
- Do not update `core-runtime.lock.json`, create a Core Runtime tag, build an installer, or trigger GitHub Actions during daily development verification.
- Phase 1A accepts exactly one Core argument: `ui-settings-general`.
- Consume Core `package.json` and `lib/` artifacts only; never import Core `src/` from Shell.
- Do not add `npm link`, registry fallback, a new runtime dependency, or a general-purpose watcher framework.
- Preserve the existing `insight-desktop-dev` user data for `dev:shell`; Core compositions use isolated, stable user data.
- Packaged DEV and production applications must ignore all development-composition environment variables.
- Failed builds keep the last successful projected package and do not refresh Harness.
- `Ctrl+C` must stop electron-vite, the Core watcher, and every child started by the orchestrator.
- The approved design is `docs/plans/2026-08-30-local-composed-development-phase-1-design.md`.

## File map

- `scripts/lib/development-inputs.mjs`: inspect locked Runtime, runtime manifest, and bundled Profile readiness; return exact preparation actions.
- `scripts/lib/development-runtime.mjs`: resolve the allowed Core package, compare package manifests, derive a composition, and atomically project artifacts.
- `scripts/lib/child-supervisor.mjs`: own spawned children and terminate the process tree on signals.
- `scripts/dev-composed.mjs`: parse `shell`/`core`, prepare inputs, orchestrate watchers, print identity, and update the refresh generation.
- `src/main/state/development-composition.ts`: validate unpackaged-only environment input and resolve Runtime/userData paths.
- `src/main/runtime/development-refresh.ts`: observe generation changes and serialize refresh callbacks.
- `src/main/index.ts`: thin wiring for composition identity, Runtime selection, and Harness refresh.
- `test/development-inputs.test.mjs`, `test/development-runtime.test.mjs`, `test/child-supervisor.test.mjs`: script-layer behavior.
- `test/development-composition.test.ts`, `test/development-refresh.test.ts`: Electron Main helpers.
- `test/release.test.ts`: formal build isolation contract.
- `.gitignore`: derived composition artifacts.
- `package.json`: expose only the two approved commands.
- `docs/local-composed-development.md`, `docs/development.md`: mark the Phase 1A commands as implemented and preserve the larger staged roadmap.

---

### Task 1: Prepared-input readiness without repeated downloads

**Files:**
- Create: `scripts/lib/development-inputs.mjs`
- Create: `test/development-inputs.test.mjs`

**Interfaces:**
- Consumes: `selectCoreRuntime()` and `runtimeTarget()` from `scripts/prepare-core-runtime.mjs`, and `createRuntimeManifest()` from `scripts/prepare-runtime-manifest.mjs`.
- Produces:

```js
inspectDevelopmentInputs(projectRoot, { platform, arch })
// Promise<{
//   target: string,
//   runtimeReady: boolean,
//   manifestReady: boolean,
//   profileReady: boolean,
//   actions: Array<'core-runtime' | 'runtime-manifest' | 'bundled-profile'>,
//   reasons: string[]
// }>
```

- [ ] **Step 1: Write failing readiness tests**

Use a temporary project fixture. Write exact tests for: all inputs valid returns no actions; missing Runtime schedules all three actions; a Runtime metadata mismatch schedules Runtime, manifest, and Profile; a missing/stale runtime manifest schedules only manifest; and a missing Better Sidebar, desktop integration package, or `.install-complete`-independent Profile artifact schedules Profile.

The ready fixture must contain these files:

```text
core-runtime.lock.json
build/core-runtime/runtime.json
build/core-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js
build/core-runtime/node_modules/node/bin/node
build/core-runtime/node_modules/pnpm/bin/pnpm.cjs
build/runtime-manifest.json
build/bundled-profile/web/package.json
build/bundled-profile/web/node_modules/dsh-better-sidebar/package.json
build/bundled-profile/web/node_modules/@insight-ai/desktop-integration/package.json
build/bundled-profile/web/packages/insight-desktop-integration/lib/client.js
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- test/development-inputs.test.mjs`

Expected: FAIL because `scripts/lib/development-inputs.mjs` does not exist.

- [ ] **Step 3: Implement the readiness inspector**

Implement the exported function with filesystem reads only. Build the expected desktop manifest through `createRuntimeManifest()` and compare parsed objects rather than file formatting. Derive actions with this rule:

```js
if (!runtimeReady) actions.push('core-runtime')
if (!runtimeReady || !manifestReady) actions.push('runtime-manifest')
if (!runtimeReady || !profileReady) actions.push('bundled-profile')
```

Check Profile identity against the existing constants: `dsh-better-sidebar@0.16.1`, `@insight-ai/desktop-integration@workspace:*`, bundle membership, and `defaultProfileVersion: 3`. Do not mutate or prepare anything from this module.

- [ ] **Step 4: Run the readiness tests**

Run: `npm test -- test/development-inputs.test.mjs`

Expected: all readiness cases PASS.

- [ ] **Step 5: Commit the readiness unit**

```bash
git add scripts/lib/development-inputs.mjs test/development-inputs.test.mjs
git commit -m "feat(dev): inspect prepared desktop inputs"
```

### Task 2: Shell-only fast development command

**Files:**
- Create: `scripts/dev-composed.mjs`
- Create: `test/dev-composed.test.mjs`
- Modify: `package.json`
- Modify: `test/release.test.ts`

**Interfaces:**
- Consumes: `inspectDevelopmentInputs()` from Task 1.
- Produces:

```js
parseDevelopmentCommand(argv)
// { mode: 'shell' } | { mode: 'core', packages: ['ui-settings-general'] }

preparationCommands(actions)
// Array<{ command: string, args: string[] }>
```

- [ ] **Step 1: Add failing CLI contract tests**

Assert these exact parses:

```js
expect(parseDevelopmentCommand(['shell'])).toEqual({ mode: 'shell' })
expect(parseDevelopmentCommand(['core', 'ui-settings-general'])).toEqual({
  mode: 'core', packages: ['ui-settings-general']
})
expect(() => parseDevelopmentCommand(['core'])).toThrow('one Core package')
expect(() => parseDevelopmentCommand(['core', 'ui-settings'])).toThrow('ui-settings-general')
expect(() => parseDevelopmentCommand(['plugin'])).toThrow('shell or core')
```

Assert `preparationCommands([])` is empty and these exact mappings are preserved:

```js
expect(preparationCommands(['core-runtime'])).toEqual([
  { command: process.execPath, args: ['scripts/prepare-core-runtime.mjs'] }
])
expect(preparationCommands(['runtime-manifest'])).toEqual([
  { command: process.execPath, args: ['scripts/prepare-runtime-manifest.mjs'] }
])
expect(preparationCommands(['bundled-profile'])).toEqual([
  { command: npmCommand, args: ['run', 'build:desktop-integration'] },
  { command: process.execPath, args: ['scripts/prepare-bundled-profile.mjs'] }
])
```

Extend `test/release.test.ts` to require:

```ts
expect(packageJson.scripts['dev:shell']).toBe('node scripts/dev-composed.mjs shell')
expect(packageJson.scripts['dev:core']).toBe('node scripts/dev-composed.mjs core')
```

- [ ] **Step 2: Run the CLI tests and verify they fail**

Run: `npm test -- test/dev-composed.test.mjs test/release.test.ts`

Expected: FAIL because the CLI and package scripts do not exist.

- [ ] **Step 3: Implement shell-mode orchestration**

Export parsing helpers without running the CLI when imported. Under the direct-entry guard:

1. inspect inputs;
2. print every reason and run only returned preparation actions;
3. inspect again and fail if any input remains unready;
4. print mode, Shell git identity, Runtime tag/commit, user data label `insight-desktop-dev`, and `Core local overrides: none`;
5. spawn `electron-vite dev` with inherited stdio and exit with its code.

Start electron-vite through the already installed package rather than `npx` or a registry-capable command:

```js
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const electronVite = join(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
spawn(process.execPath, [electronVite, 'dev'], { cwd: projectRoot, stdio: 'inherit' })
```

Do not call `npm run dev`, because that command deliberately performs the full preparation chain.

- [ ] **Step 4: Add the package commands and run focused checks**

Add only:

```json
"dev:shell": "node scripts/dev-composed.mjs shell",
"dev:core": "node scripts/dev-composed.mjs core"
```

Run: `npm test -- test/development-inputs.test.mjs test/dev-composed.test.mjs test/release.test.ts`

Expected: focused tests PASS. Do not start Electron in the automated test.

- [ ] **Step 5: Commit the Shell command**

```bash
git add package.json scripts/dev-composed.mjs test/dev-composed.test.mjs test/release.test.ts
git commit -m "feat(dev): add fast Shell development entry"
```

### Task 3: Core repository identity and package compatibility

**Files:**
- Create: `scripts/lib/development-runtime.mjs`
- Create: `test/development-runtime.test.mjs`

**Interfaces:**
- Consumes: Shell root, optional `INSIGHT_CORE_REPO`, Runtime metadata, and Core git identity.
- Produces:

```js
const CORE_TARGETS = new Map([
  ['ui-settings-general', {
    name: '@deepseek-ai/dsh-client-ui-settings-general',
    relativeRoot: 'packages/client/ui-settings-general'
  }]
])

resolveCoreRepository(shellRoot, environment)
// Promise<{ root: string, commit: string, dirty: boolean }>

comparePackageContracts(baseManifest, localManifest)
// { compatible: boolean, differences: Array<{ field: string, base: unknown, local: unknown }> }

developmentCompositionId({ target, releaseTag, packages })
// string
```

- [ ] **Step 1: Write failing identity and compatibility tests**

Cover the sibling default, explicit environment fallback, invalid Core root, unsupported package, and composition stability. Prove the composition ID changes when Runtime target/release or package set changes but does not change with the local Core commit.

For compatibility, compare only these fields after stable key sorting:

```js
[
  'dependencies',
  'peerDependencies',
  'exports',
  'dsh.client.inject',
  'main'
]
```

Versions may differ. An added or removed dependency name, added or changed export, changed inject list, missing `main`, or changed package name must produce a named difference and `compatible: false`.

For `dependencies` and `peerDependencies`, compare package-name sets rather than specifier text because Core source uses `workspace:^` while a released Runtime contains concrete semver ranges. Adding or removing a dependency name is incompatible. Compare `exports`, `dsh.client.inject`, `main`, and the package name by value.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- test/development-runtime.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact Core validation**

Default to `resolve(shellRoot, '..', 'insight-harness-core')`. Use `INSIGHT_CORE_REPO` only when the default root does not contain both the expected root package name `@deepseek-ai/dsh-root` and the allowed target manifest. Obtain identity with non-interactive `git -C <root> rev-parse HEAD` and `git -C <root> status --porcelain`; never mutate Core git state.

Generate the composition ID from canonical JSON and the first 12 hex characters of SHA-256:

```js
const identity = JSON.stringify({ target, releaseTag, packages: [...packages].sort() })
return `core-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`
```

- [ ] **Step 4: Run the compatibility tests**

Run: `npm test -- test/development-runtime.test.mjs`

Expected: all Core identity and manifest cases PASS.

- [ ] **Step 5: Commit Core compatibility inspection**

```bash
git add scripts/lib/development-runtime.mjs test/development-runtime.test.mjs
git commit -m "feat(dev): validate local Core package compatibility"
```

### Task 4: Disposable Runtime derivation and atomic package projection

**Files:**
- Modify: `scripts/lib/development-runtime.mjs`
- Modify: `test/development-runtime.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces:

```js
ensureDerivedRuntime({ baseRoot, compositionRoot, identity })
// Promise<{ runtimeRoot: string, reused: boolean }>

projectCorePackage({ sourceRoot, runtimeRoot, packageName, generation })
// Promise<{ packageRoot: string, generation: string }>
```

- [ ] **Step 1: Add failing derivation and projection tests**

Create small temporary Runtime/package fixtures. Test: first derivation copies files; a matching identity reuses the directory; changed Runtime identity rebuilds it; base bytes remain unchanged; a successful projection replaces `package.json` and the complete `lib/`; source `src/`, tests, `.git`, `.DS_Store`, caches, and absolute symlinks are rejected or absent; a validation failure leaves the previous package byte-for-byte unchanged.

The state file is:

```json
{
  "schemaVersion": 1,
  "identity": "<canonical runtime composition identity>",
  "generation": "<last successful package digest>"
}
```

- [ ] **Step 2: Run the projection tests and verify they fail**

Run: `npm test -- test/development-runtime.test.mjs`

Expected: FAIL on missing derivation/projection exports.

- [ ] **Step 3: Implement safe derivation**

Create `build/dev-compositions/<composition-id>` through a sibling temporary directory, recursively copy the base using `COPYFILE_FICLONE` where supported, write state, then rename into place. If identity differs, build a fresh sibling and replace only the named composition directory. Never delete `build/core-runtime`, `build/bundled-profile`, user data, or another composition.

Add to `.gitignore`:

```gitignore
build/dev-compositions/
```

- [ ] **Step 4: Implement staging validation and atomic replacement**

Copy only `package.json` and `lib/` into `<composition>/staging/<package-name>-<generation>`. Validate package name, required exports, `lib/index.js`, `lib/client.js`, and `lib/invariant.js`; walk the staging tree and reject absolute symlinks. Rename the live package to `.previous`, rename staging into the live path, update state through a temporary JSON file, then remove `.previous`. If either rename fails, restore `.previous` before rethrowing.

- [ ] **Step 5: Run projection tests and diff checks**

Run:

```bash
npm test -- test/development-runtime.test.mjs
git diff --check
```

Expected: all temporary-directory cases PASS and no derived Runtime is tracked.

- [ ] **Step 6: Commit the disposable Runtime unit**

```bash
git add .gitignore scripts/lib/development-runtime.mjs test/development-runtime.test.mjs
git commit -m "feat(dev): project Core artifacts into derived Runtime"
```

### Task 5: Unpackaged-only composition selection in Electron Main

**Files:**
- Create: `src/main/state/development-composition.ts`
- Create: `test/development-composition.test.ts`
- Modify: `src/main/index.ts:382-427`

**Interfaces:**
- Produces:

```ts
export interface DevelopmentComposition {
  id: string
  runtimeRoot: string
  refreshMarkerPath: string
  userDataPath: string
}

export function resolveDevelopmentComposition(input: {
  packaged: boolean
  appDataPath: string
  environment: NodeJS.ProcessEnv
}): DevelopmentComposition | undefined
```

Environment names are fixed:

```text
INSIGHT_DEV_COMPOSITION_ID
INSIGHT_DEV_RUNTIME_ROOT
INSIGHT_DEV_REFRESH_MARKER
```

- [ ] **Step 1: Write failing Main-boundary tests**

Assert: packaged applications always return `undefined`; no variables returns `undefined`; a complete unpackaged environment returns normalized absolute paths and userData under `appData/insight-desktop-dev-compositions/<id>`; partial variables fail; ID must match `^[a-z0-9][a-z0-9-]{0,63}$`; Runtime and marker paths must be absolute.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- test/development-composition.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement and wire composition selection**

Resolve the composition once before `configureAppIdentity()`. Keep the current Shell behavior when it is absent:

```ts
app.setPath('userData', join(app.getPath('appData'), 'insight-desktop-dev'))
```

When present, use its `userDataPath`. In `coreRuntime()`, resolve the explicit Runtime root by passing its parent and basename to the existing `resolveCoreRuntime()`; all packaged branches remain unchanged. Add one startup log containing the ID and Runtime root, without logging account data.

- [ ] **Step 4: Add release-isolation assertions**

In `test/release.test.ts`, assert Main passes `app.isPackaged` to `resolveDevelopmentComposition`, package `extraResources` contains no `dev-compositions`, and every package script continues through existing `build` paths rather than `dev:core` or `dev:shell`.

- [ ] **Step 5: Run Main and release tests**

Run:

```bash
npm test -- test/development-composition.test.ts test/core-runtime.test.ts test/release.test.ts
npm run typecheck
```

Expected: tests and typecheck PASS.

- [ ] **Step 6: Commit unpackaged-only Runtime selection**

```bash
git add src/main/state/development-composition.ts src/main/index.ts test/development-composition.test.ts test/release.test.ts
git commit -m "feat(dev): select isolated Core compositions"
```

### Task 6: Serialized Harness refresh generation

**Files:**
- Create: `src/main/runtime/development-refresh.ts`
- Create: `test/development-refresh.test.ts`
- Modify: `src/main/index.ts:768-834,1506-1581,1722-1727`

**Interfaces:**
- Produces:

```ts
export interface DevelopmentRefreshWatcher {
  close(): void
}

export function watchDevelopmentRefresh(
  markerPath: string,
  refresh: () => Promise<void>,
  operations?: {
    readGeneration(path: string): Promise<string | undefined>
    watch(path: string, listener: () => void): () => void
  }
): DevelopmentRefreshWatcher
```

- [ ] **Step 1: Write failing refresh tests**

With injected operations, prove: the initial generation does not refresh; a new generation refreshes once; duplicate notifications for the same generation do nothing; two changes during an active refresh coalesce into one later refresh using the newest generation; read/refresh failures do not stop later generations; `close()` detaches and prevents new work.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- test/development-refresh.test.ts`

Expected: FAIL because the watcher does not exist.

- [ ] **Step 3: Implement the serialized watcher**

Use a `running` promise and `pending` boolean, not concurrent callbacks. The default watch operation uses `watchFile()` with a short development-only interval and returns an `unwatchFile()` disposer. Read a UTF-8 generation string; ignore empty or unchanged values. Catch one failed generation, report through the caller, and remain active.

- [ ] **Step 4: Wire refresh into bootstrap and shutdown**

Only create the watcher when a development composition exists. Its callback must:

```ts
if (authManager?.current().kind !== 'authenticated') return
if (harnessLaunchOperation) await harnessLaunchOperation
if (authManager.current().kind === 'authenticated') await restartHarness()
```

Store the disposer beside other Main-owned lifecycle state and close it before stopping the workspace in `before-quit`. Route callback errors through `showUnexpectedError` and the Harness log. Do not add Renderer IPC or production file watchers.

- [ ] **Step 5: Run lifecycle regression checks**

Run:

```bash
npm test -- test/development-refresh.test.ts test/workspace-lifecycle.test.ts test/harness-workspace-controller.test.ts test/runtime.test.ts
npm run typecheck
```

Expected: refresh serialization and existing account lifecycle tests PASS.

- [ ] **Step 6: Commit DEV-only Harness refresh**

```bash
git add src/main/runtime/development-refresh.ts src/main/index.ts test/development-refresh.test.ts
git commit -m "feat(dev): refresh Harness after Core projection"
```

### Task 7: Core watcher orchestration and child cleanup

**Files:**
- Create: `scripts/lib/child-supervisor.mjs`
- Create: `test/child-supervisor.test.mjs`
- Modify: `scripts/dev-composed.mjs`
- Modify: `test/dev-composed.test.mjs`

**Interfaces:**
- Produces:

```js
createChildSupervisor({ spawn, platform })
// {
//   start(label, command, args, options): ChildProcess,
//   stopAll(signal = 'SIGTERM'): Promise<void>,
//   waitForRequiredExit(): Promise<number>
// }

writeRefreshGeneration(markerPath, generation)
// Promise<void>
```

- [ ] **Step 1: Write failing supervisor and Core flow tests**

Use fake child processes to prove: all children receive termination; one unexpected required-child exit stops siblings; repeated SIGINT calls are idempotent; Windows command names use `.cmd`; successful projection writes a generation only after completion; failed projection does not change the marker.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- test/child-supervisor.test.mjs test/dev-composed.test.mjs`

Expected: FAIL on missing supervisor/Core orchestration.

- [ ] **Step 3: Implement child ownership**

Track only children started in the current run. On POSIX, start each child in its own process group and send the selected signal to `-pid`; wait up to five seconds before `SIGKILL`. On Windows, first call `child.kill()`, then use `taskkill /pid <pid> /T /F` only for a still-running owned PID. Never enumerate or kill unrelated Electron, Node, pnpm, or Harness processes.

- [ ] **Step 4: Implement `core` mode**

After prepared-input inspection:

1. resolve and print Core repository identity;
2. compare the local target manifest against the Runtime package manifest and fail with field-by-field differences;
3. derive or reuse the composition Runtime;
4. run `pnpm --dir <core-root> --filter @deepseek-ai/dsh-client-ui-settings-general run bundle`;
5. digest `package.json` and `lib/`, project them, then atomically write the digest plus newline to the refresh marker;
6. spawn `pnpm --dir <core-root> --filter @deepseek-ai/dsh-client-ui-settings-general run watch`;
7. observe the package `lib` directory and `package.json` with debounced `fs.watch`; after each stable change, digest and project only if different;
8. spawn electron-vite with the three composition environment variables;
9. install SIGINT/SIGTERM handlers and wait for a required child exit.

When a post-start build is invalid, print `DEGRADED`, retain the previous generation, and keep both watcher and client alive. The next valid build must project and refresh normally.

- [ ] **Step 5: Run script tests and a syntax check**

Run:

```bash
npm test -- test/development-inputs.test.mjs test/development-runtime.test.mjs test/child-supervisor.test.mjs test/dev-composed.test.mjs
node --check scripts/dev-composed.mjs
```

Expected: all script tests PASS and Node reports no syntax error.

- [ ] **Step 6: Commit Core orchestration**

```bash
git add scripts/dev-composed.mjs scripts/lib/child-supervisor.mjs test/dev-composed.test.mjs test/child-supervisor.test.mjs
git commit -m "feat(dev): orchestrate one Core UI package"
```

### Task 8: Documentation status and complete automatic gate

**Files:**
- Modify: `docs/local-composed-development.md`
- Modify: `docs/development.md`
- Modify: `test/release.test.ts`

**Interfaces:**
- Consumes: the two implemented commands and their verified limitations.
- Produces: truthful command documentation and a formal-build isolation regression gate.

- [ ] **Step 1: Update command status without overstating the roadmap**

Change the top status of `docs/local-composed-development.md` to state that Phase 1A implements `dev:shell` and `dev:core -- ui-settings-general`; retain explicit “not implemented” labels for `dev:plugin`, multi-package Core, `dev:reset`, `verify:release`, and first-party integration watch.

In `docs/development.md`, add a short “快速本地验证” section with only:

```bash
npm run dev:shell
npm run dev:core -- ui-settings-general
```

Explain when to use each, where Core is discovered, how to set `INSIGHT_CORE_REPO` only when the sibling default is unavailable, and that installers remain a stage-completion gate.

- [ ] **Step 2: Complete the release isolation test**

Assert all `extraResources[].from` values and all package scripts beginning with `package:` contain neither `dev-compositions` nor `INSIGHT_DEV_`. Assert `.gitignore` includes `build/dev-compositions/`.

- [ ] **Step 3: Run the complete automatic verification curve**

Run:

```bash
npm test
npm run typecheck
git diff --check
git status --short
```

Expected: the full Shell test suite and typecheck PASS; only intended source, tests, and docs are modified; no Runtime/Profile/composition output is staged.

- [ ] **Step 4: Commit documentation and gates**

```bash
git add docs/local-composed-development.md docs/development.md test/release.test.ts
git commit -m "docs: publish composed development Phase 1A"
```

### Task 9: Local functional proof and manual acceptance

**Files:**
- Temporarily modify and restore: `src/renderer/src/LoginView.tsx:102-103`
- Temporarily modify and restore: sibling Core `packages/client/ui-settings-general/src/client/locales.ts:10`
- Inspect only: `core-runtime.lock.json`, `build/core-runtime`, `build/dev-compositions`

**Interfaces:**
- Produces: timing and behavior evidence; no permanent test-marker source edits.

- [ ] **Step 1: Record immutable baselines**

Record:

```bash
git status --short
shasum -a 256 core-runtime.lock.json build/core-runtime/runtime.json
git -C ../insight-harness-core status --short
```

Also record the current process list filtered to this Shell/Core workspace so shutdown can be compared without killing unrelated processes.

- [ ] **Step 2: Verify the Shell feedback loop**

Run `npm run dev:shell`, record startup time and confirm the summary reports no Core override. Change `欢迎登录` to `欢迎登录（本地验证）`, confirm Vite HMR updates the visible login page without Runtime preparation or packaging, then restore the source text and confirm it reverts.

Stop with `Ctrl+C`, run `npm run dev:shell` again, and confirm logs contain no Runtime download and no Profile install. Record second-start time.

- [ ] **Step 3: Verify the Core feedback loop**

Run `npm run dev:core -- ui-settings-general`. Confirm a distinct composition/userData path is printed and sign in once if needed. Change `general.nav` from `通用设置` to `通用设置（本地验证）`; confirm only the target package rebuilds and the setting appears after automatic Harness restart. Restore `通用设置` and confirm the setting reverts.

Insert a temporary syntax error into the same Core file. Confirm the watcher reports `DEGRADED`, the refresh marker does not change, and the last successful settings page remains usable. Remove the syntax error and confirm the next successful build refreshes Harness.

- [ ] **Step 4: Verify isolation and cleanup**

Stop with `Ctrl+C`. Confirm no child process started by the command remains. Re-run the baseline hashes and verify both are unchanged. Confirm neither repository has a temporary visible-text edit, and `git status --short` contains no derived Runtime files.

- [ ] **Step 5: Hand off the human checklist**

Ask the user to confirm:

- Shell login UI changed and reverted through HMR;
- Core settings text changed and reverted without Runtime release or installer build;
- the forced Core compile failure preserved the last working UI;
- Shell and Core compositions did not reuse the wrong account/session data;
- stopping the command closed the corresponding DEV client.

Do not implement Phase 1B or trigger any installer workflow until the user reports this gate passed.
