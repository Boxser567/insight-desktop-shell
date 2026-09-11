# Cross-Platform Window Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove menus from Windows secondary windows, expand the update window to `480 × 240`, and ensure the Windows main window shows only its native caption controls without changing macOS chrome.

**Architecture:** Keep the existing Electron window ownership and renderer layouts. Add explicit Windows-only menu suppression at secondary-window creation sites, make the native Windows title-bar overlay opaque per theme, and encode the Windows/macOS separation as a durable development constraint.

**Tech Stack:** Electron BrowserWindow, TypeScript, React/CSS, Vitest

## Global Constraints

- Windows uses native Electron caption controls; do not add custom minimize, maximize, restore, or close IPC.
- The update window is exactly `480 × 240` with matching minimum dimensions.
- `setMenu(null)`, `autoHideMenuBar`, `titleBarStyle`, and `titleBarOverlay` changes must be Windows-only.
- macOS keeps its global application menu, native traffic lights, and existing button placement.
- Do not change update discovery, download, signature verification, installation state, or theme color `#315dfb`.
- Do not change `asar`, Runtime/Profile packaging, or compression in this task.
- Preserve the existing Windows uninstall compatibility changes in `build/installer.nsh` and `test/release.test.ts`.
- Treat untracked `docs/analysis/` as user-owned content and do not add or edit it.

---

### Task 1: Lock Windows secondary-window menu isolation and update geometry

**Files:**
- Modify: `test/update-window.test.ts`
- Modify: `test/about-window.test.ts`
- Modify: `src/main/update/update-window.ts`
- Modify: `src/main/about-window.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `updateWindowOptions(...)`, `aboutWindowOptions(...)`, and existing BrowserWindow creation sites
- Produces: Windows-only `autoHideMenuBar: true`, per-window `setMenu(null)`, and update geometry `480 × 240`

- [ ] **Step 1: Add failing platform-isolation assertions**

Require Windows options to include `autoHideMenuBar: true`, Darwin options to omit it, update dimensions to equal `480 × 240`, and `src/main/index.ts` to call a Windows-guarded secondary-menu suppression helper for update, about, and plugin-recovery windows.

```ts
expect(updateWindowOptions({
  parent,
  preload: '/app/update.cjs',
  icon: '/app/icon.png',
  platform: 'win32'
})).toMatchObject({
  width: 480,
  height: 240,
  minWidth: 480,
  minHeight: 240,
  autoHideMenuBar: true
})
expect(updateWindowOptions({
  parent,
  preload: '/app/update.cjs',
  icon: '/app/icon.png',
  platform: 'darwin'
})).not.toHaveProperty('autoHideMenuBar')
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- test/update-window.test.ts test/about-window.test.ts test/windows-titlebar.test.ts`

Expected: FAIL on the old `200` height, absent Windows menu isolation, and transparent overlay expectations.

- [ ] **Step 3: Implement platform-specific window options**

Add optional `platform?: NodeJS.Platform` inputs used only for deterministic tests. Resolve `const platform = input.platform ?? process.platform`, then spread `autoHideMenuBar: true` only when `platform === 'win32'`. Change the update height and minimum height to `240`.

```ts
const platform = input.platform ?? process.platform
return {
  width: 480,
  height: 240,
  minWidth: 480,
  minHeight: 240,
  ...(platform === 'win32' ? { autoHideMenuBar: true } : {}),
  // existing options remain unchanged
}
```

- [ ] **Step 4: Suppress menus only on Windows secondary windows**

Add one local helper to `src/main/index.ts` and call it immediately after constructing update, about, and plugin-recovery BrowserWindows. Do not call it for the main window or on Darwin.

```ts
function suppressWindowsSecondaryMenu(window: BrowserWindow): void {
  if (process.platform === 'win32') window.setMenu(null)
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- test/update-window.test.ts test/about-window.test.ts test/windows-titlebar.test.ts`

Expected: PASS.

### Task 2: Make native Windows caption controls visually exclusive

**Files:**
- Modify: `test/windows-titlebar.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `windowsTitleBarOverlay(isDark)` and `applyWindowChromeTheme(...)`
- Produces: an opaque `#141416` dark overlay or `#ffffff` light overlay with the existing native symbol colors

- [ ] **Step 1: Replace the transparent-overlay assertion**

```ts
expect(main).toContain("color: isDark ? '#141416' : '#ffffff'")
expect(main).not.toContain("color: '#00000000'")
```

- [ ] **Step 2: Run the Windows title-bar test and confirm failure**

Run: `npm test -- test/windows-titlebar.test.ts`

Expected: FAIL because the overlay is currently transparent.

- [ ] **Step 3: Apply the theme-matched opaque overlay**

```ts
function windowsTitleBarOverlay(isDark: boolean): Electron.TitleBarOverlayOptions {
  return {
    color: isDark ? '#141416' : '#ffffff',
    symbolColor: isDark ? '#f3f4f6' : '#202124',
    height: WINDOWS_TITLEBAR_HEIGHT
  }
}
```

Keep the existing Windows-only construction branch and `setTitleBarOverlay(...)` theme synchronization unchanged.

- [ ] **Step 4: Run the focused title-bar tests**

Run: `npm test -- test/windows-titlebar.test.ts`

Expected: PASS.

### Task 3: Persist the cross-platform coding guardrail and verify

**Files:**
- Modify: `docs/development.md`

**Interfaces:**
- Consumes: the approved platform rules in `docs/plans/2026-09-11-cross-platform-window-chrome-design.md`
- Produces: a durable “窗口装饰与平台隔离” checklist for future changes

- [ ] **Step 1: Add the development checklist**

Document that Windows menu/title-bar options require `win32` guards, Darwin menu/traffic-light behavior must remain untouched, secondary Windows windows use both hidden menu options and `setMenu(null)`, transparent overlays require proof that no WebContents controls occupy the caption region, and both platform configurations need tests and manual screenshots.

- [ ] **Step 2: Run all static and behavioral verification**

Run: `npm run typecheck`

Expected: PASS.

Run: `env PATH="/Users/boxser.shi/.nvm/versions/node/v24.4.1/bin:/usr/bin:/bin:/usr/sbin:/sbin" npm test`

Expected: all test files and all tests PASS. The sanitized PATH avoids the known empty `/opt/homebrew/bin/python3` file.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 3: Perform platform acceptance before RC promotion**

On Windows, verify the update window has no menu after pressing Alt, its content and buttons do not overlap, the main window shows one caption-control set in light and dark themes, and the Shell menu button remains usable. On macOS, open the same update and about flows and verify the global menu and native traffic lights are unchanged.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/main/update/update-window.ts src/main/about-window.ts src/main/index.ts test/update-window.test.ts test/about-window.test.ts test/windows-titlebar.test.ts docs/development.md docs/superpowers/plans/2026-09-11-cross-platform-window-chrome.md
git commit -m "fix(ui): isolate cross-platform window chrome"
```
