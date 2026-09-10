# Update Install Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a truthful, animated update window visible throughout local installation preparation and surface native updater failures without changing the signed update or platform installer contracts.

**Architecture:** Preserve the existing `UpdateManager → prepareToInstall → UpdateExecutor.quitAndInstall` sequence and continue stopping the workspace before either platform installer starts. Remove only the premature update-window close, render the existing `installing` state as indeterminate progress, and route asynchronous executor errors into the existing recoverable error state when installation is active.

**Tech Stack:** Electron 43, electron-updater 6.8.9, React 18, TypeScript, CSS, Vitest

## Global Constraints

- Keep `autoInstallOnAppQuit: false` and the existing explicit `安装并重启` action.
- Stop the workspace and bundled runtime before calling `quitAndInstall()` on macOS and Windows.
- Do not change OSS paths, signed Manifest verification, SHA-512 verification, blockmap handling, channels, artifact formats, application identity, storage, or keychain behavior.
- Use indeterminate motion only; do not invent installation percentages or timer-based stages.
- Use the existing `#315dfb` theme color and add no dependency.
- Disable decorative Logo motion when `prefers-reduced-motion: reduce` is active.
- Treat `docs/analysis/` as user-owned untracked content and do not add or edit it.

---

### Task 1: Surface asynchronous native updater failures during installation

**Files:**
- Modify: `test/update-manager.test.ts:495-526`
- Modify: `src/main/update/update-manager.ts:325-348`

**Interfaces:**
- Consumes: `ExecutorEvent` values delivered through `UpdateExecutor.on(...)`
- Produces: an `error` `UpdateStatus` with the active version, required/manual context, retry permission, and existing full-installer availability when an executor error arrives during `installing`

- [ ] **Step 1: Write the failing installation-error test**

Add the following test after the existing preparation failure test:

```ts
it('publishes a recoverable error when the native updater fails while installing', async () => {
  const result = await setup()
  await result.manager.start()
  await result.manager.check(true)
  const file = join(result.userData, 'app.zip')
  await writeFile(file, 'verified installer')
  result.executor.download.mockImplementation(async () => {
    result.executor.emit({ type: 'downloaded', version: '1.1.0', downloadedFile: file })
  })
  await result.manager.download()
  await result.manager.install()

  result.executor.emit({ type: 'error', message: 'native staging failed' })

  expect(result.manager.status()).toMatchObject({
    phase: 'error',
    availableVersion: '1.1.0',
    required: false,
    message: 'native staging failed',
    retryable: true,
    manualInstallerAvailable: true
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the silent-error regression**

Run: `npm test -- --run test/update-manager.test.ts`

Expected: FAIL because an executor error received after `downloadCompletion` is cleared leaves the manager in `installing`.

- [ ] **Step 3: Route only active installation errors into the state machine**

Change the executor error branch to preserve existing download behavior and explicitly fail active installation:

```ts
if (event.type === 'error') {
  const error = new Error(event.message)
  if (this.downloadCompletion) {
    this.downloadCompletion.reject(error)
  } else if (status.phase === 'installing') {
    this.fail(error, status)
  }
}
```

Do not publish errors for idle or completed states; a late event must not replace unrelated UI state.

- [ ] **Step 4: Run the focused update-manager tests**

Run: `npm test -- --run test/update-manager.test.ts`

Expected: PASS, including download errors, preparation errors, and the new asynchronous installation error.

- [ ] **Step 5: Commit the error handling change**

```bash
git add src/main/update/update-manager.ts test/update-manager.test.ts
git commit -m "fix(update): surface native install errors"
```

### Task 2: Keep the update window visible while the workspace stops

**Files:**
- Modify: `test/update-window.test.ts:44-63`
- Modify: `src/main/index.ts:1593-1599`

**Interfaces:**
- Consumes: `prepareForUpdateInstall(): Promise<void>` as supplied to `UpdateManager`
- Produces: the same workspace-first preparation sequence without closing `updateWindowController`; Electron/electron-updater remains responsible for closing the update window during actual application quit

- [ ] **Step 1: Write a focused lifecycle regression test**

Add this source-level assertion to `test/update-window.test.ts`, matching the repository's existing orchestration-test style:

```ts
it('keeps the update window visible while preparing the platform installer', async () => {
  const source = await readFile('src/main/index.ts', 'utf8')
  const preparation = source.match(
    /async function prepareForUpdateInstall\(\): Promise<void> \{(?<body>[\s\S]*?)\n\}/u
  )?.groups?.body

  expect(preparation).toContain('await workspaceLifecycle?.stop()')
  expect(preparation).not.toContain('updateWindowController?.close()')
  expect(preparation).toContain('aboutWindowController?.close()')
})
```

- [ ] **Step 2: Run the focused window test and verify it fails**

Run: `npm test -- --run test/update-window.test.ts`

Expected: FAIL because `prepareForUpdateInstall()` still calls `updateWindowController?.close()`.

- [ ] **Step 3: Remove only the premature update-window close**

Keep the preparation function otherwise unchanged:

```ts
async function prepareForUpdateInstall(): Promise<void> {
  await workspaceLifecycle?.stop()
  aboutWindowController?.close()
  if (pluginRecoveryWindow && !pluginRecoveryWindow.isDestroyed()) pluginRecoveryWindow.close()
  if (safeModeManagerWindow && !safeModeManagerWindow.isDestroyed()) safeModeManagerWindow.close()
}
```

Do not move `workspaceLifecycle?.stop()` after `quitAndInstall()`; doing so can reintroduce Windows runtime file-lock races.

- [ ] **Step 4: Run lifecycle and update-manager tests**

Run: `npm test -- --run test/update-window.test.ts test/update-manager.test.ts test/generic-update-flow.test.ts`

Expected: PASS. The existing manager test must continue proving preparation happens exactly once before `quitAndInstall()`.

- [ ] **Step 5: Commit the lifecycle change**

```bash
git add src/main/index.ts test/update-window.test.ts
git commit -m "fix(update): retain install transition window"
```

### Task 3: Render a truthful compact installation transition

**Files:**
- Modify: `test/update-window.test.ts:65-108`
- Modify: `src/renderer/src/update-view-model.ts:40-49`
- Modify: `src/renderer/src/UpdateApp.tsx:65-88`
- Modify: `src/renderer/src/update.css:30-45`

**Interfaces:**
- Consumes: the existing `UpdateStatus` phase `installing` and `UpdateViewModel.busy`
- Produces: approved Chinese installation copy, an indeterminate native progress element, and `.update-logo--busy` as the only decorative-motion hook

- [ ] **Step 1: Add failing copy and rendering assertions**

Extend the projection test with:

```ts
expect(updateViewModel({
  phase: 'installing',
  currentVersion: '1.0.0',
  availableVersion: '1.1.0',
  required: false,
  manual: true
})).toMatchObject({
  title: '正在准备安装…',
  detail: '正在安全关闭当前工作区并准备安装文件。完成后因赛AI 将自动退出并重新打开。',
  busy: true
})
```

Extend the renderer source assertions with:

```ts
expect(source).toContain("status.phase === 'checking' || status.phase === 'installing'")
expect(source).toContain("model.busy ? 'update-logo update-logo--busy' : 'update-logo'")
```

- [ ] **Step 2: Run the focused window test and confirm it fails**

Run: `npm test -- --run test/update-window.test.ts`

Expected: FAIL because the old copy has no ellipsis or restart expectation, `installing` renders no progress, and the Logo has no busy class.

- [ ] **Step 3: Update the installation view model**

Replace only the `installing` projection:

```ts
case 'installing':
  return {
    title: '正在准备安装…',
    detail: '正在安全关闭当前工作区并准备安装文件。完成后因赛AI 将自动退出并重新打开。',
    busy: true
  }
```

- [ ] **Step 4: Render installation progress and a busy Logo class**

Use the existing progress element for both truthful indeterminate phases:

```tsx
<span className={model.busy ? 'update-logo update-logo--busy' : 'update-logo'}>
  <img src={brandMark} alt="" />
</span>
```

```tsx
{(status.phase === 'checking' || status.phase === 'installing') && (
  <progress
    className="update-progress update-progress--checking"
    aria-label={status.phase === 'installing' ? '正在准备安装' : '正在检查更新'}
  />
)}
```

Downloading remains determinate and continues showing `status.percent`.

- [ ] **Step 5: Add restrained motion with accessibility fallback**

Append the following focused CSS without changing layout geometry:

```css
@keyframes update-logo-breathe {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.035); filter: brightness(1.08); }
}

.update-logo--busy { animation: update-logo-breathe 1.8s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .update-logo--busy { animation: none; }
}
```

- [ ] **Step 6: Run focused tests and static checks**

Run: `npm test -- --run test/update-window.test.ts test/update-manager.test.ts test/open-update-window.test.ts test/generic-update-flow.test.ts`

Expected: all selected tests PASS.

Run: `npm run typecheck`

Expected: both TypeScript projects PASS.

- [ ] **Step 7: Build the renderer and inspect the compact DEV state**

Run: `npm run build:prepared`

Expected: desktop integration checks and Electron renderer build PASS.

Run: `npm run dev`

In the update window, verify that checking uses the existing indeterminate progress, the `480 × 200` frame does not clip the longer installation copy, the Logo motion is subtle, and downloading still uses determinate progress. Development builds remain unsupported for a real install, so installation-state lifecycle verification must use tests and the next signed RC upgrade.

- [ ] **Step 8: Commit the transition presentation**

```bash
git add src/renderer/src/update-view-model.ts src/renderer/src/UpdateApp.tsx src/renderer/src/update.css test/update-window.test.ts
git commit -m "feat(update): show install transition progress"
```

### Task 4: Review the complete change and run release-grade verification

**Files:**
- Review: `src/main/index.ts`
- Review: `src/main/update/update-manager.ts`
- Review: `src/renderer/src/update-view-model.ts`
- Review: `src/renderer/src/UpdateApp.tsx`
- Review: `src/renderer/src/update.css`
- Review: `test/update-manager.test.ts`
- Review: `test/update-window.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3
- Produces: a reviewed, test-verified change ready for a signed RC build; no release, tag, push, promotion, or OSS mutation is part of this task

- [ ] **Step 1: Inspect the scoped diff**

Run: `git diff HEAD~3 -- src/main/index.ts src/main/update/update-manager.ts src/renderer/src/update-view-model.ts src/renderer/src/UpdateApp.tsx src/renderer/src/update.css test/update-manager.test.ts test/update-window.test.ts`

Confirm every changed line maps to one of these requirements: keep the transition visible, render truthful busy state, respect reduced motion, or surface installation errors.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test -- --run`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: both TypeScript projects PASS.

Run: `npm run build:prepared`

Expected: the production renderer and main-process bundles build successfully.

- [ ] **Step 3: Verify repository scope**

Run: `git status --short`

Expected: only intentionally created plan/design documents and scoped implementation files are changed or committed; `docs/analysis/` remains untracked and untouched.

- [ ] **Step 4: Record signed-RC manual acceptance criteria**

For the next signed macOS and Windows RC upgrade, require all of the following before promotion:

1. Clicking `安装并重启` keeps the update window visible until the app process actually exits.
2. The visible window shows the approved copy and continuous indeterminate motion without fake percentages.
3. The main application does not expose a standalone blank host during local staging.
4. The application restarts into the target version with login and workspace data preserved.
5. A simulated native updater error produces a recoverable error state instead of an infinite installing state.
6. Windows still terminates the bundled runtime before NSIS starts.

- [ ] **Step 5: Commit any plan checkbox updates only if the project normally tracks them**

If execution progress is intentionally recorded in this document, stage only this plan file and commit it separately:

```bash
git add docs/superpowers/plans/2026-09-10-update-install-transition.md
git commit -m "docs(update): record install transition implementation"
```
