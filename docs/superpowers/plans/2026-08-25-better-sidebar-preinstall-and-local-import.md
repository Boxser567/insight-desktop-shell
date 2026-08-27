# Better Sidebar Preinstall and Local Plugin Import Implementation Plan

> **For Codex:** Execute this plan inline as authorized by the user; do not create a marketplace or remote plugin catalog.

**Goal:** Ship `dsh-better-sidebar@0.16.1` inside every packaged Insight build, initialize it once per Insight Harness profile without altering an existing profile, and let a user import a trusted local plugin directory or `.tgz` archive.

**Architecture:** A packaging script creates a fully resolved `web` profile template using the bundled DSH CLI and pnpm. Electron packages that template as an extra resource. Before the first Harness launch, the main process copies the template atomically into Insight's isolated `harness/profiles/web` directory; later launches retain the existing directory. A native application-menu command chooses a local package, runs `dsh plugin --profile web add <absolute-path>` while Harness is stopped, and restarts it after a successful import.

**Tech Stack:** Electron main process, Node.js filesystem APIs, bundled Node.js/pnpm/DSH CLI, pnpm profile management, Vitest.

---

### Task 1: Create a deterministic built-in web-profile template

**Files:**
- Create: `scripts/prepare-bundled-profile.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Test: `test/bundled-profile-template.test.ts`

1. Build a temporary DSH home, run `dsh plugin --profile web add --save-exact dsh-better-sidebar@0.16.1`, and copy the resulting profile directory into `build/bundled-profile/web`.
2. Add an explicit package script that runs before packaging and make release builds call it.
3. Include the generated template in `extraResources`; ensure the template contains its lockfile and resolved dependencies for the target platform.
4. Test the manifest and lockfile pin exactly `0.16.1` and reject a template that lacks the sidebar package.

### Task 2: Initialize the profile only when it does not exist

**Files:**
- Create: `src/main/state/bundled-profile.ts`
- Modify: `src/main/index.ts`
- Modify: `package.json`
- Test: `test/bundled-profile.test.ts`

1. Resolve the packaged template path for development and packaged builds.
2. Copy it to `<userData>/insight/harness/profiles/web` only when no profile manifest exists; do not overwrite an initialized profile.
3. Invoke initialization while Harness is stopped and before profile repair/start.
4. Test first-run materialization and second-run preservation.

### Task 3: Import arbitrary local plugin packages through the desktop menu

**Files:**
- Modify: `src/main/runtime/profile-plugin-command.ts`
- Modify: `src/main/index.ts`
- Create: `src/main/state/local-plugin-import.ts`
- Test: `test/profile-plugin-command.test.ts`
- Test: `test/local-plugin-import.test.ts`

1. Add a command builder/runner for `dsh plugin --profile web add --save-exact <absolute-path>`.
2. Accept only an existing directory containing `package.json` or an existing `.tgz` file; reject other selections before launching pnpm.
3. Add a `Plugins` menu item that explains local packages can execute code with the user's desktop permissions, opens the picker, stops Harness, installs the selected package, and restarts Harness only on success.
4. Surface concise success/failure dialogs and retain the existing recovery mechanism for failed plugin loads.
5. Test accepted/rejected input paths and generated CLI arguments.

### Task 4: Verify the package and operational paths

**Files:**
- Modify as needed: tests and release workflow from prior tasks only.

1. Run focused unit tests for template/init/import helpers.
2. Run `npm run typecheck` and `npm run build`.
3. Run the full `npm test` because these changes cross startup and profile recovery paths.
4. Package and manually verify a clean user-data run shows one Better Sidebar; relaunch does not duplicate it; import a local test package, restart, and use recovery if it fails to load.
