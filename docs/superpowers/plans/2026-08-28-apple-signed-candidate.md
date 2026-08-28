# Apple Signed Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-cost Apple credential preflight and a manual Apple Silicon signed candidate path without changing tag publication or unsupported platform behavior.

**Architecture:** Extend the existing `Release desktop installers` workflow with two explicit manual targets. A preflight job imports the P12 into a temporary Keychain and authenticates to Notary Service without installing dependencies; the existing Apple Silicon job reuses its production signing path when the signed-candidate target is selected, while release publication remains tag-only.

**Tech Stack:** GitHub Actions, macOS `security`, `xcrun notarytool`, Electron Builder, Vitest, Node.js 22.

## Global Constraints

- Do not create or push a `v*` tag during candidate validation.
- Do not expose secret values or persist signing material outside `$RUNNER_TEMP`.
- `apple-signing-preflight` must not install dependencies or build an application.
- `macos-arm64-signed` must not start Intel, Windows, Windows UKey signing, or `publish` jobs.
- Existing `macos`, `windows`, `all`, pull-request Windows validation, and `v*` release behavior remain unchanged.
- A downloaded candidate must pass Gatekeeper without `xattr` quarantine removal.

---

### Task 1: Lock the manual signing workflow contract

**Files:**
- Modify: `test/release.test.ts`

**Interfaces:**
- Consumes: `.github/workflows/release.yml` as text.
- Produces: regression assertions for the two manual targets, credential validation, cleanup, candidate isolation, and tag-only publication.

- [ ] **Step 1: Write the failing workflow assertions**

Add one test that expects `apple-signing-preflight` and `macos-arm64-signed` input choices, a `apple-signing-preflight` job on `macos-15`, `xcrun notarytool history`, a `Developer ID Application` and Team ID check, and an `if: always()` cleanup step. Add assertions that the Apple Silicon job accepts `inputs.target == 'macos-arm64-signed'`, that Intel and Windows do not, and that `publish` still contains `startsWith(github.ref, 'refs/tags/v')`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- test/release.test.ts`

Expected: FAIL because the two manual targets and preflight job do not exist.

- [ ] **Step 3: Commit only after Task 2 makes the test pass**

Task 1 and Task 2 form one reviewed workflow change; do not commit a permanently failing test to `main`.

### Task 2: Add preflight and Apple Silicon signed-candidate execution

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `docs/release-runbook.md`
- Modify: `docs/client-build-runbook.md`
- Modify: `test/release.test.ts`

**Interfaces:**
- Consumes: `DESKTOP_CSC_LINK`, `DESKTOP_CSC_KEY_PASSWORD`, `DESKTOP_APPLE_API_KEY`, `DESKTOP_APPLE_API_KEY_ID`, `DESKTOP_APPLE_API_ISSUER`, and `DESKTOP_APPLE_TEAM_ID` repository secrets.
- Produces: `apple-signing-preflight` validation and a `macos-apple-silicon-signed-candidate` artifact.

- [ ] **Step 1: Add the two dispatch choices**

Append `apple-signing-preflight` and `macos-arm64-signed` to `on.workflow_dispatch.inputs.target.options`. Keep the existing default and choices unchanged.

- [ ] **Step 2: Implement the preflight job**

Add a `apple-signing-preflight` job guarded by:

```yaml
if: github.event_name == 'workflow_dispatch' && inputs.target == 'apple-signing-preflight'
```

Use `macos-15`, checkout the repository, validate all six secrets, write the `.p8` file with mode `0600`, call `node scripts/prepare-macos-signing-keychain.mjs`, and assert the imported identity contains both `Developer ID Application` and `($APPLE_TEAM_ID)`. Authenticate with:

```bash
xcrun notarytool history \
  --key "$APPLE_API_KEY" \
  --key-id "$APPLE_API_KEY_ID" \
  --issuer "$APPLE_API_ISSUER"
```

Restore the original Keychain list and delete the temporary Keychain, P12, Keychain-list file, and `.p8` in an `if: always()` step.

- [ ] **Step 3: Route the signed candidate through the Apple Silicon production path**

Extend the Apple Silicon job condition and every tag-only signing/build/notarization/verification step with:

```yaml
github.event_name == 'workflow_dispatch' && inputs.target == 'macos-arm64-signed'
```

Keep `Set app version from release tag` tag-only. Keep the DEV build and DEV artifact steps disabled for the signed-candidate target. Add an upload step named `macos-apple-silicon-signed-candidate` for the production DMG and zip. Do not extend Intel, Windows, `sign-windows`, or `publish` conditions.

- [ ] **Step 4: Document the candidate lane**

Document the preflight-first stop rule, the candidate target, its non-release status, the mandatory Gatekeeper checks, and the prohibition on `xattr`. State that Intel and Windows signing remain release gates but do not block this Apple Silicon candidate.

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `npm test -- test/release.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the workflow slice**

```bash
git add .github/workflows/release.yml test/release.test.ts docs/release-runbook.md docs/client-build-runbook.md
git commit -m "ci: add Apple signed candidate validation"
```

### Task 3: Run local release gates and push

**Files:**
- Verify only; no planned file changes.

**Interfaces:**
- Consumes: committed workflow slice.
- Produces: a clean `main` commit eligible for the remote preflight.

- [ ] **Step 1: Run the full Shell checks**

Run:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Confirm the repository is clean and push**

Run:

```bash
git status --short --branch
git push origin main
```

Expected: local `main` and `origin/main` point to the same commit and no worktree files are listed.

### Task 4: Prove credentials before building the candidate

**Files:**
- Remote Actions execution only.

**Interfaces:**
- Consumes: configured repository secrets.
- Produces: a successful `apple-signing-preflight` run URL or an exact credential failure.

- [ ] **Step 1: Dispatch the preflight**

Run:

```bash
gh workflow run release.yml --repo Boxser567/insight-desktop-shell --ref main -f target=apple-signing-preflight
```

- [ ] **Step 2: Wait for and inspect the exact run**

Use `gh run list` to resolve the run ID, then `gh run watch <run-id> --exit-status`. On failure, read only `gh run view <run-id> --log-failed`; do not start an installer build.

- [ ] **Step 3: Dispatch the signed Apple Silicon candidate after preflight passes**

Run:

```bash
gh workflow run release.yml --repo Boxser567/insight-desktop-shell --ref main -f target=macos-arm64-signed
```

Wait for completion and verify the only material build job is Apple Silicon and the uploaded artifact is `macos-apple-silicon-signed-candidate`.

- [ ] **Step 4: Hand off the exact DMG for manual Gatekeeper and product acceptance**

Record the Shell commit, Core Runtime lock, run URL, artifact name, size, and SHA-256. The user validates clean and overwrite installation, login restoration, logout, unified sidebar, settings, Markdown/HTML Better Sidebar routing, recovery behavior, and branding without removing quarantine.
