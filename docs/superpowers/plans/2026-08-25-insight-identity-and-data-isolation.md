# Insight Identity and Data Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an Insight-branded desktop host named 因赛AI whose data is isolated from DSH Desktop.

**Architecture:** Set the Electron product identity independently for production and development builds, then place all mutable Harness data under an `insight/harness` subtree of each build's `userData` directory. Reuse the supplied white Insight SVG wordmark on dark launch and recovery surfaces; derive the square platform icon from the same mark on a dark background until a dedicated icon is supplied.

**Tech Stack:** Electron, electron-builder, TypeScript, HTML/CSS, SVG/PNG/ICNS/ICO assets, Vitest.

## Global Constraints

- Production display name and installer name: `因赛AI`.
- Production App ID: `com.insight.desktop`; development App ID: `com.insight.desktop.dev`.
- Production and development data must not read or modify `dsh-desktop` or `dsh-desktop-dev` directories.
- Mutable Harness state lives at `<Electron userData>/insight/harness/`; the launch root lives at `<Electron userData>/insight/launch-root`.
- Preserve the Harness Runtime, loopback-only binding, BrowserWindow security settings, profile recovery, and packaging targets.
- Do not add authentication, permissions, a marketplace, an updater, or a new Shell renderer.

---

### Task 1: Define Insight packaging and process identity

**Files:**
- Modify: `package.json`, `electron-builder.dev.cjs`, `src/main/index.ts`, `test/release.test.ts`

- [ ] Change production metadata to `insight-desktop`, `因赛AI`, `com.insight.desktop`, and `insight-${os}-${arch}.${ext}`.
- [ ] Change development metadata to an isolated `因赛AI Dev`, `com.insight.desktop.dev`, and `insight-dev-${os}-${arch}.${ext}` channel.
- [ ] Make `configureAppIdentity()` select `insight-desktop` and `insight-desktop-dev` user-data directories before any settings or runtime paths are read.
- [ ] Update packaging assertions for the new values.

### Task 2: Isolate mutable Harness paths

**Files:**
- Modify: `src/main/index.ts`, `src/main/state/launch-root.ts`, `test/launch-root.test.ts`, `test/runtime.test.ts`

- [ ] Add a single `insightDataPath(userDataPath)` helper returning `join(userDataPath, 'insight')`.
- [ ] Pass `<userData>/insight/launch-root` to `ensureLaunchRoot()`.
- [ ] Pass `<userData>/insight/harness` to the Runtime, profile repair, recovery, locale, and theme paths.
- [ ] Assert the production and development directory names do not contain `dsh-desktop`.

### Task 3: Apply supplied Insight branding assets

**Files:**
- Create: `build/insight-logo.svg`
- Modify: `build/splash.html`, `build/plugin-recovery.html`, `package.json`, `test/release.test.ts`
- Regenerate: `build/app-icon.png`, `build/icon.icns`, `build/icon.ico`

- [ ] Store the supplied SVG locally and include it in Electron extra resources as `insight-logo.svg`.
- [ ] Use the wordmark on the dark splash and plugin-recovery surfaces, with the slogan `一站搞掂电商生意` in the splash.
- [ ] Regenerate square platform icon files from the supplied mark placed on a dark background.
- [ ] Assert that packaged startup resources use Insight asset names and Insight copy.

### Task 4: Verify the isolated Insight host

- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Start `npm run dev`; confirm 因赛AI is shown in native metadata and the splash surface.
- [ ] Confirm newly created data is under the Insight-only location and existing DSH Desktop data is untouched.
