# Unified Brand Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every Shell-owned legacy whale visual with the approved 因赛AI mark and wordmark while preserving deterministic macOS and Windows packaging.

**Architecture:** Keep two editable SVG sources in `build/`: a pure mark and a horizontal wordmark. Generate the OS bitmap/container assets from the mark, consume the mark through normal Vite/esbuild asset imports, and remove unused legacy theme and loader files instead of preserving aliases.

**Tech Stack:** SVG, PNG, ICNS, ICO, Electron Builder, React, esbuild, Vitest, Node.js 22.

## Global Constraints

- Do not change the locked Core Runtime or rename `@deepseek-ai/*` packages.
- Do not fetch branding during development or packaging.
- Keep `build/brand-mark.svg` and `build/brand-wordmark.svg` as the only editable Logo sources.
- Keep existing account, login, sidebar, recovery, and packaging behavior unchanged apart from visible product branding.
- Do not trigger GitHub Actions before focused tests, the full Shell test suite, the prepared build, and manual DEV acceptance pass.

---

### Task 1: Canonical brand sources and package contract

**Files:**
- Create: `build/brand-mark.svg`
- Rename: `build/insight-logo.svg` to `build/brand-wordmark.svg`
- Delete: `build/dsh-loader.gif`
- Delete: `build/dsh-loader-dark.gif`
- Delete: `build/logo-light.png`
- Delete: `build/logo-dark.png`
- Delete: `build/logo-light.svg`
- Delete: `build/icon.png`
- Modify: `package.json`
- Modify: `build/splash.html`
- Modify: `test/release.test.ts`
- Create: `test/brand-assets.test.ts`

**Interfaces:**
- Consumes: `/Users/boxser.shi/Downloads/logo.svg` supplied by the user.
- Produces: committed `build/brand-mark.svg`, `build/brand-wordmark.svg`, and an Electron Builder resource named `brand-wordmark.svg`.

- [ ] **Step 1: Write the failing asset contract test**

Create `test/brand-assets.test.ts` with checks that `brand-mark.svg` has viewBox `0 0 36.954833984375 32.00146484375`, `brand-wordmark.svg` has viewBox `0 0 111.268310546875 28` and contains no external `<image>` reference, and every legacy file listed above is absent. Parse `package.json` and assert `extraResources` contains `build/brand-wordmark.svg -> brand-wordmark.svg` and contains no `dsh-loader` or `insight-logo` entries.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- test/brand-assets.test.ts test/release.test.ts`

Expected: FAIL because `brand-mark.svg` does not exist and legacy assets are still packaged.

- [ ] **Step 3: Install the canonical sources and remove aliases**

Copy the supplied SVG bytes into `build/brand-mark.svg`. Rename the current horizontal vector to `build/brand-wordmark.svg`. Remove the five legacy image/GIF files and old `build/icon.png`.

In `package.json`, remove both loader entries and replace:

```json
{
  "from": "build/insight-logo.svg",
  "to": "insight-logo.svg"
}
```

with:

```json
{
  "from": "build/brand-wordmark.svg",
  "to": "brand-wordmark.svg"
}
```

Change the splash image to:

```html
<img class="mark" src="brand-wordmark.svg" alt="因赛AI" />
```

Set `.mark` to `filter: brightness(0)` in the light theme and reset it to `filter: none` in the dark theme so the white source remains visible on both backgrounds.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- test/brand-assets.test.ts test/release.test.ts`

Expected: both test files PASS.

- [ ] **Step 5: Commit the source and packaging contract**

```bash
git add build package.json test/brand-assets.test.ts test/release.test.ts
git commit -m "feat: unify desktop brand sources"
```

### Task 2: Product surfaces and user-visible recovery branding

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/LoginView.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `packages/insight-desktop-integration/src/client/assets.d.ts`
- Modify: `packages/insight-desktop-integration/src/client/components.tsx`
- Modify: `packages/insight-desktop-integration/src/client/styles.tsx`
- Modify: `scripts/build-desktop-integration.mjs`
- Modify: `src/main/plugin-recovery-view.ts`
- Modify: `src/main/safe-mode.ts`
- Modify: `src/main/index.ts`
- Modify: `build/safe-mode.html`
- Modify: `test/plugin-recovery-view.test.ts`
- Modify: `test/safe-mode.test.ts`
- Modify: `test/authenticated-sidebar-contract.test.ts`

**Interfaces:**
- Consumes: `build/brand-mark.svg` as a Vite/esbuild data URL.
- Produces: visible 因赛AI branding in status, login, sidebar, plugin recovery, and safe mode surfaces.

- [ ] **Step 1: Add failing product-brand assertions**

Assert that the renderer and desktop integration import `brand-mark.svg`, that the integration build config has `loader: { '.svg': 'dataurl' }`, and that recovery/safe-mode view models return `brand: '因赛AI'`, `quitLabel: '退出因赛AI'` or `Quit 因赛AI`. Assert the user-facing unexpected-error title is `因赛AI encountered an error`.

- [ ] **Step 2: Run the focused surface tests and verify they fail**

Run: `npm test -- test/authenticated-sidebar-contract.test.ts test/plugin-recovery-view.test.ts test/safe-mode.test.ts`

Expected: FAIL on the old `app-icon.png` import and `DSH Desktop` labels.

- [ ] **Step 3: Replace placeholder and legacy marks**

Import the mark in `App.tsx` and `LoginView.tsx`:

```tsx
import brandMark from '../../../build/brand-mark.svg'
```

Render it inside existing `.brand-mark` containers:

```tsx
<div className="brand-mark" aria-hidden="true"><img src={brandMark} alt="" /></div>
```

Update `.brand-mark` so its image occupies about 68% of the tile with `object-fit: contain`; remove the letter-specific font styles.

Change the integration asset declaration from `*.png` to `*.svg`, import `brand-mark.svg`, and render a styled wrapper containing the SVG. Add `'.svg': 'dataurl'` to the esbuild loader and use the existing brand-blue rounded tile for light/dark visibility.

Change Shell-owned recovery/safe-mode brands and quit labels from `DSH Desktop` to `因赛AI`, including the safe-mode HTML fallback and the unexpected-error dialog title. Do not rewrite Runtime package names or diagnostic log text.

- [ ] **Step 4: Run focused tests and build the integration package**

Run:

```bash
npm test -- test/authenticated-sidebar-contract.test.ts test/plugin-recovery-view.test.ts test/safe-mode.test.ts
npm run build:desktop-integration
```

Expected: focused tests PASS and `packages/insight-desktop-integration/lib/client.js` builds with an SVG data URL.

- [ ] **Step 5: Commit product-surface branding**

```bash
git add src packages/insight-desktop-integration scripts/build-desktop-integration.mjs build/safe-mode.html test
git commit -m "feat: apply insight brand across desktop surfaces"
```

### Task 3: System icon generation and staged validation

**Files:**
- Replace: `build/app-icon.png`
- Regenerate: `build/icon.icns`
- Regenerate: `build/icon.ico`
- Modify: `scripts/generate-app-icons.mjs`
- Modify: `test/brand-assets.test.ts`

**Interfaces:**
- Consumes: the approved pure mark and a 1024×1024 brand-blue icon composition.
- Produces: the packaged macOS and Windows system icon containers.

- [ ] **Step 1: Extend the asset test for system formats**

Read the PNG IHDR and assert width and height are 1024. Assert `icon.icns` starts with `icns`, and parse the ICO header to assert type `1` with at least seven image entries. Add a source check that `generate-app-icons.mjs` rejects a non-1024 PNG before running platform tools.

- [ ] **Step 2: Run the asset test and verify it fails on the legacy image**

Run: `npm test -- test/brand-assets.test.ts`

Expected: FAIL because the generator has no explicit dimension guard and the test records the approved new icon digest after generation.

- [ ] **Step 3: Generate and validate the new system image**

Create a 1024×1024 PNG with a transparent outer canvas, a rounded `#315EFB` tile, and the white pure mark centered with approximately 22% safe margin. Update `generate-app-icons.mjs` to read the PNG IHDR and throw unless both dimensions equal 1024, then run:

```bash
npm run icons:generate
```

Expected: `build/icon.icns` and `build/icon.ico` are recreated from the new PNG.

- [ ] **Step 4: Run the complete automatic validation curve**

Run:

```bash
npm test
npm run build:prepared
git diff --check
```

Expected: 0 failed tests, prepared build succeeds, and the diff has no whitespace errors.

- [ ] **Step 5: Commit generated icons and generator guard**

```bash
git add build/app-icon.png build/icon.icns build/icon.ico scripts/generate-app-icons.mjs test/brand-assets.test.ts
git commit -m "feat: regenerate insight application icons"
```

- [ ] **Step 6: Start DEV and hand off manual acceptance**

Run `npm run dev` and ask the user to verify the approved checklist: startup/status page, SMS/password login page, restored login, expanded/collapsed sidebar, light/dark display, plugin recovery/safe mode when intentionally invoked, and absence of the whale icon. Do not build a DMG until the user reports this gate passed.
