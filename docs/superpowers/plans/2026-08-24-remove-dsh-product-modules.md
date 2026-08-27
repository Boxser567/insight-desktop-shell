# Remove DSH Product Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove DSH Desktop's market, mobile pairing, updater, preset-transfer, and sidebar-branding product modules while preserving the Harness host lifecycle and security controls.

**Architecture:** Delete self-contained modules rather than retaining disabled code paths. Keep the shared profile repair runner by moving it from the market package into the existing runtime module that consumes it; retain the HMR fallback and native directory-picker patches because they support the host baseline.

**Tech Stack:** Electron, TypeScript, Vitest, npm, patch-package.

## Global Constraints

- Preserve `HarnessRuntime`, loopback-only hosting, BrowserWindow security settings, profile recovery, and packaging foundations.
- Do not implement Insight identity, data migration, authentication, permissions, a marketplace, or automatic updates.
- Retain the user's existing `package-lock.json` baseline changes except for required dependency removals.

---

### Task 1: Remove non-host product modules and their registrations

**Files:**
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/shared/contracts.ts`, `src/shared/desktop-menu.ts`, `src/preload/windows-titlebar.ts`, `build/dsh-desktop.patch.yml`
- Delete: `src/main/mobile/`, `src/main/update/`, `src/preload/update-view.ts`

- [ ] Remove mobile and updater imports, IPC handlers, menus, startup/shutdown paths, and preload UI.
- [ ] Remove updater state types and menu command variants.
- [ ] Keep profile repair by resolving the packaged pnpm executable directly.
- [ ] Remove market composition rows while retaining the HMR fallback row.

### Task 2: Remove DSH-owned dependencies and UI patches

**Files:**
- Modify: `package.json`, `patches/@deepseek-ai+dsh+0.1.1-rc.1.patch`
- Delete: `packages/dsh-desktop-market-installer/`, `patches/@deepseek-ai+dsh-client-ui-agent-preset+0.1.1-rc.1.patch`, `patches/@deepseek-ai+dsh-client-ui-sidebar+0.1.1-rc.1.patch`, `patches/@deepseek-ai+dsh-host-apiproxy+0.1.1-rc.1.patch`, `scripts/install-brand-assets.mjs`, `docs/preset-packages.md`, `docs/preset-square-mvp.md`

- [ ] Remove the market installer and updater packages from production dependencies.
- [ ] Remove the postinstall brand-asset hook and the now-unused patch entries.
- [ ] Preserve patches that provide the generic host directory-picker and HMR behavior.

### Task 3: Align tests and public documentation

**Files:**
- Modify: `README.md`, `README.zh.md`, `test/release.test.ts`, `test/runtime.test.ts`, `test/windows-titlebar.test.ts`, `test/profile-plugin-command.test.ts`
- Delete: market, mobile, updater, preset-transfer, and sidebar-branding tests

- [ ] Delete tests whose units were removed and update surviving host tests to assert the retained behavior.
- [ ] Remove market, mobile, updater, preset-transfer, and sidebar-branding claims from both READMEs.

### Task 4: Verify the stripped host

- [ ] Run `npm test` and repair only failures caused by this removal.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Search for removed module names in runtime source, dependency metadata, and test paths; allow only historical handoff and non-product packaging references.
