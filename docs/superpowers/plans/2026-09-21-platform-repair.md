# Platform Repair Implementation Plan

> **For agentic workers:** Execute inline in the current task; user has authorized implementation. The optional superpowers execution skills are unavailable in this session.

**Goal:** Deliver reviewable fixes for retired plugins, login recovery, macOS update compatibility and Windows console creation.

**Architecture:** Keep Electron 44 and the existing signed v1 release format. Repair each subsystem at its current owner; keep Core changes on the released Runtime baseline.

**Tech Stack:** Electron 44, TypeScript, React, Vitest, NSIS, Node.js, Win32/Koffi.

## Global Constraints

- macOS 13.0 / Darwin 22.0.0 minimum; Electron 44.0.0.
- No direct dzm/ or duzhimeng code merges.
- No production promotion until platform acceptance.

### Task 1: Managed profile migration

Files: `src/main/state/bundled-profile.ts`, `scripts/prepare-bundled-profile.mjs`, `test/bundled-profile.test.ts`.

- [ ] Update profile generation to 8 and include generation 7 in migration selection.
- [ ] Remove GenUI and Market by exact package identity regardless of dependency version; invalidate locks and install marker before modifying profile.
- [ ] Exercise normalized dependency specs, missing package files, old generations, repeated invocation and unrelated plugin preservation.
- [ ] Run `npx vitest run test/bundled-profile.test.ts`.

### Task 2: Local authentication recovery

Files: `src/main/auth/{auth-session-manager,auth-api-client,electron-auth,auth-ipc}.ts`, `src/main/index.ts`, `src/shared/shell-api.ts`, `src/preload/shell.ts`, `src/renderer/src/App.tsx`, corresponding auth tests.

- [ ] Add local reset, guarded by session revision; invalidate in-flight restore/login results.
- [ ] Connect Electron authentication partition cleanup and a retryable renderer action.
- [ ] Add sanitized transport diagnostics, testing that secrets in error messages never reach logs.
- [ ] Run focused authentication tests and `npm run typecheck`.

### Task 3: macOS update requirements

Files: `package.json`, `scripts/{finalize-mac-release,merge-mac-update-metadata}.mjs`, `src/main/update/{generic-release-source,update-source,update-manager}.ts`, release and update tests.

- [ ] Add minimumSystemVersion 13.0 to build.mac, and Darwin 22.0.0 to macOS updater YAML.
- [ ] Preserve and validate requirements when merging architecture metadata.
- [ ] Verify updater metadata against the signed manifest before using its system requirement; return unsupported before activating an update.
- [ ] Test mismatched metadata, insufficient OS, and unaffected supported OS.

### Task 4: Windows creation path

Files: Core `packages/subprocess/subprocess-local`, `packages/subprocess/win32-process`, relevant native tests and package documentation.

- [ ] Trace runner and target console ownership, compare ordinary and restricted token behavior with the shipped baseline.
- [ ] Implement the smallest supported console fix without changing restricted-target flags that previously caused DLL initialization failure.
- [ ] Run focused unit checks and prepare repeatable native Windows acceptance commands; record unverified platform behavior explicitly.

### Task 5: Review and handoff

- [ ] Review NSIS old-runtime removal and whether additional residue handling is needed.
- [ ] Run `git diff --check`, focused tests and type checks; commit only task files.
- [ ] Record commit IDs, concrete test results and remaining Windows/macOS installation acceptance.
