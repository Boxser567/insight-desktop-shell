# Compact Update Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized desktop update window with the approved `480 × 200` compact layout while preserving every existing update action and state transition.

**Architecture:** Keep `UpdateManager`, `updateViewModel`, preload IPC, and action dispatch unchanged. Adjust the BrowserWindow geometry, reorganize only the React presentation into a logo/content row plus action footer, and restyle the existing elements with the current color tokens.

**Tech Stack:** Electron BrowserWindow, React, TypeScript, CSS, Vitest

## Global Constraints

- Window width and height are exactly `480 × 200`.
- The primary color remains `#315dfb`.
- Keep the two-stage `下载更新 → 安装并重启` flow.
- Keep every real update state and authorized action; do not change update discovery, signatures, URLs, channels, downloads, or installation behavior.
- Treat `docs/analysis/` as user-owned untracked content and do not add or edit it.

---

### Task 1: Lock the compact BrowserWindow dimensions

**Files:**
- Modify: `test/update-window.test.ts:25-43`
- Modify: `src/main/update/update-window.ts:11-36`

**Interfaces:**
- Consumes: `updateWindowOptions({ parent, preload, icon }): BrowserWindowConstructorOptions`
- Produces: a non-resizable-below-design window whose width, height, minWidth, and minHeight are `480`, `200`, `480`, and `200` respectively

- [ ] **Step 1: Write the failing geometry assertions**

Update the existing options assertion to include the approved dimensions:

```ts
expect(options).toMatchObject({
  width: 480,
  height: 200,
  minWidth: 480,
  minHeight: 200,
  show: false,
  parent,
  modal: false
})
```

- [ ] **Step 2: Run the focused test and confirm the old dimensions fail**

Run: `npm test -- --run test/update-window.test.ts`

Expected: FAIL because the implementation still returns `560 × 360` with different minimum dimensions.

- [ ] **Step 3: Apply the approved dimensions**

Change only the four geometry properties in `updateWindowOptions`:

```ts
width: 480,
height: 200,
minWidth: 480,
minHeight: 200,
```

- [ ] **Step 4: Run the focused test**

Run: `npm test -- --run test/update-window.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the geometry change**

```bash
git add src/main/update/update-window.ts test/update-window.test.ts
git commit -m "feat(ui): compact update window frame"
```

### Task 2: Reflow every update state into the compact panel

**Files:**
- Modify: `test/update-window.test.ts:86-99`
- Modify: `src/renderer/src/UpdateApp.tsx:37-109`
- Modify: `src/renderer/src/update.css:26-45`

**Interfaces:**
- Consumes: the unchanged `UpdateViewModel` fields `title`, `detail`, `primary`, `secondary`, `recovery`, and existing `runAction(...)`
- Produces: `.update-summary`, `.update-logo`, `.update-content`, `.update-recovery`, and `.update-actions` presentation hooks

- [ ] **Step 1: Add structural regression assertions**

Extend the renderer source test so it requires the compact presentation hooks and preserves the two-stage labels:

```ts
expect(source).toContain('className="update-summary"')
expect(source).toContain('className="update-logo"')
expect(source).toContain('className="update-content"')
expect(source).toContain('className="update-recovery"')
expect(source).toContain("download: '下载更新'")
expect(source).toContain("install: '安装并重启'")
```

- [ ] **Step 2: Run the focused test and confirm the missing hooks fail**

Run: `npm test -- --run test/update-window.test.ts`

Expected: FAIL because the current page uses `.update-brand` and `.update-copy`.

- [ ] **Step 3: Reorganize the renderer without changing action dispatch**

Replace the current header/copy split with this hierarchy:

```tsx
<main className="update-page">
  <section className="update-summary" aria-live="polite">
    <span className="update-logo"><img src={brandMark} alt="" /></span>
    <div className="update-content">
      <h1>{model.title}</h1>
      <p>{model.detail}</p>
      {commandError && <p className="update-error">{commandError}</p>}
      {model.recovery && (
        <button type="button" className="update-recovery" onClick={() => execute(model.recovery!)}>
          {actionLabels[model.recovery]}
        </button>
      )}
      {status.phase === 'checking' && (
        <progress
          className="update-progress update-progress--checking"
          aria-label="正在检查更新"
        />
      )}
      {status.phase === 'downloading' && (
        <progress className="update-progress" max="100" value={status.percent}>
          {status.percent}%
        </progress>
      )}
    </div>
  </section>
  <footer className="update-actions">
    {model.secondary && (
      <button type="button" className="secondary" onClick={() => execute(model.secondary!)}>
        {actionLabels[model.secondary]}
      </button>
    )}
    <span />
    {status.phase === 'available' && !status.required && (
      <button type="button" className="secondary" onClick={() => window.close()}>稍后提醒我</button>
    )}
    {model.primary && (
      <button type="button" className="primary" onClick={() => execute(model.primary!)}>
        {actionLabels[model.primary]}
      </button>
    )}
  </footer>
</main>
```

Rendering `model.secondary` on the left preserves optional `skip` and required-error `quit`; rendering `model.recovery` as a content link keeps the verified full-installer fallback available without crowding the footer.

- [ ] **Step 4: Implement the compact CSS using existing tokens**

Replace the old brand/copy layout rules with compact dimensions and reusable button treatment:

```css
.update-page { display: grid; grid-template-rows: 1fr auto; gap: 18px; width: 100%; height: 100%; padding: 26px 24px 22px; }
.update-summary { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 18px; align-items: start; min-height: 0; }
.update-logo { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 15px; background: linear-gradient(145deg, var(--insight-primary), #6481ff); }
.update-logo img { width: 68%; height: 68%; object-fit: contain; }
.update-content { min-width: 0; padding-top: 2px; }
.update-content h1 { margin: 0 0 8px; font-size: 19px; line-height: 1.35; }
.update-content p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.update-content .update-error { margin-top: 6px; color: var(--danger); }
.update-recovery { margin-top: 8px; padding: 0; border: 0; color: var(--muted); background: transparent; font-size: 13px; text-decoration: underline; cursor: pointer; }
.update-progress { width: 100%; height: 6px; margin-top: 14px; accent-color: var(--insight-primary); }
.update-actions { display: flex; align-items: center; gap: 10px; min-width: 0; }
.update-actions > span { flex: 1; }
.update-actions button { min-height: 34px; padding: 0 15px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.update-actions .secondary { border: 1px solid var(--border); background: var(--surface); }
.update-actions .primary { min-width: 104px; border: 0; color: #fff; background: var(--accent); font-weight: 650; }
```

Keep root light/dark tokens and global sandbox-friendly CSS unchanged. Do not add animation, dependencies, or platform-specific branches.

- [ ] **Step 5: Run the focused update tests**

Run: `npm test -- --run test/update-window.test.ts test/open-update-window.test.ts test/update-manager.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 6: Run static and renderer build verification**

Run: `npm run typecheck`

Expected: both TypeScript projects PASS.

Run: `npm run build:prepared`

Expected: desktop integration checks and Electron renderer build PASS.

- [ ] **Step 7: Inspect the local DEV window**

Run: `npm run dev`

Open “检查更新…” and confirm the `480 × 200` window displays all current content without clipping in dark mode. Confirm “检查更新” still starts a real manual check, the primary button remains `#315dfb`, and no fake update state is introduced.

- [ ] **Step 8: Commit the renderer change**

```bash
git add src/renderer/src/UpdateApp.tsx src/renderer/src/update.css test/update-window.test.ts
git commit -m "feat(ui): redesign compact update panel"
```
