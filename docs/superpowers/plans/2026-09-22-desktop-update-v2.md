# Desktop Update v2 Implementation Plan

> **2026-09-23 修订：** rc.18 已构建并投放，但其沙箱 About preload 在生产包中引用拆分
> 模块，内测入口不可用，因此不得作为恢复桥。本文后续出现的 rc.18 执行步骤属于原始计划
> 记录；当前操作一律以 `v1.0.0-rc.19` 和
> [Desktop Update v2 操作清单](../../releases/update-v2-operator-checklist.md) 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe, manual-only Candidate track whose exact per-platform artifacts can be promoted to Stable without rebuilding, while bridging `v1.0.0-rc.17` through `v1.0.0-rc.18`.

**Architecture:** Keep the existing v1 updater and workflows only for the rc.18 bridge. Add a parallel v2 protocol with signed rollout envelopes, channel-neutral per-target manifests, a signed complete release index, persisted Candidate opt-in, Stable-only background checks, and target-scoped build/publish workflows. Promote Stable by verifying and referencing the already accepted target bytes.

**Tech Stack:** Electron 44, TypeScript 5.9, React 18, electron-updater 6.8, Zod 4, Node.js ESM release scripts, Vitest 4, GitHub Actions, GitHub Releases Drafts, Aliyun OSS/CDN.

## Global Constraints

- `v1.0.0-rc.18` is the intended final v1 Candidate; freeze `desktop/candidate/current.json` only after three-platform bridge acceptance, and burn rc.18 for a higher legacy RC if it fails.
- New Candidate releases use unique final SemVer values; rejected versions are burned and never reused.
- New versions must be greater than Stable, the legacy Candidate bridge, and all three Candidate target pointers when first allocated.
- v2 packages use the same `com.insight-aigc.desktop` identity and Stable/neutral package metadata.
- Candidate is visible to all users as an explicit opt-in but never checks or notifies in the background.
- Candidate rollout policy is always optional.
- Stable promotion requires `darwin-arm64`, `darwin-x64`, and `win32-x64` accepted from the same Shell commit, Runtime lock, compatibility contract, and version.
- Stable promotion never rebuilds an accepted target.
- v2 Candidate must write a data schema readable by the recovery baseline: current Stable, or the validated bridge before the first Stable exists.
- GitHub Releases remain the build handoff; clients download only from `https://updates.insight-aigc.com`.
- Do not add a state-management, settings, animation, or update component library.

---

### Task 1: Define and verify the v2 trust contracts

**Files:**
- Create: `src/main/update/v2-release-contract.ts`
- Create: `scripts/update-v2-contract.mjs`
- Create: `test/update-v2-contract.test.ts`
- Modify: `src/shared/update-contracts.ts`

**Interfaces:**
- Produces: `UpdateTrack = 'stable' | 'candidate'`
- Produces: `UpdateTargetId = 'darwin-arm64' | 'darwin-x64' | 'win32-x64'`
- Produces: `verifyRolloutEnvelope(bytes, publicKeyPem): VerifiedRollout`
- Produces: `verifyTargetManifest(input): SignedTargetManifest`
- Produces: `verifyReleaseIndex(input): SignedReleaseIndex`
- Produces: ESM validators used by release scripts with the same schema names and target IDs.

- [ ] **Step 1: Write failing protocol tests**

Add table-driven tests that require canonical Base64, Ed25519 signatures, exact object keys, final SemVer, the fixed three target IDs, Candidate `optional` policy, matching referenced hashes, and a complete Stable index.

```ts
it('rejects a required Candidate rollout', () => {
  const envelope = signedRollout({
    track: 'candidate', target: 'darwin-arm64', version: '1.0.1',
    policy: { mode: 'required', minimumSupportedVersion: '1.0.0' }
  })
  expect(() => verifyRolloutEnvelope(envelope.bytes, envelope.publicKeyPem))
    .toThrow('Candidate rollout must be optional')
})

it('requires all three targets in a Stable release index', () => {
  const index = signedReleaseIndex({ targets: ['darwin-arm64', 'win32-x64'] })
  expect(() => verifyReleaseIndex(index)).toThrow('complete target set')
})
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run test/update-v2-contract.test.ts`

Expected: FAIL because the v2 verifier modules do not exist.

- [ ] **Step 3: Implement exact v2 schemas and signature verification**

Use these public types:

```ts
export type UpdateTrack = 'stable' | 'candidate'
export type UpdateTargetId = 'darwin-arm64' | 'darwin-x64' | 'win32-x64'

export interface RolloutPayload {
  schema: 'insight-desktop-rollout/v2'
  track: UpdateTrack
  version: string
  target?: UpdateTargetId
  referencedSha512: string
  policy: { mode: 'optional' | 'required'; minimumSupportedVersion: string }
  publishedAt: string
}
```

`verifyRolloutEnvelope` must decode the canonical payload, verify its signature with the existing public key, validate the track/target combination, and reject a required Candidate. Target Manifest and Release Index verifiers must verify signature, hash, version, target set, artifact uniqueness, Shell commit, Runtime identity and data compatibility.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run test/update-v2-contract.test.ts test/update-manifest.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/update-contracts.ts src/main/update/v2-release-contract.ts scripts/update-v2-contract.mjs test/update-v2-contract.test.ts
git commit -m "feat(update): define signed v2 release contracts"
```

---

### Task 2: Persist Candidate opt-in and migrate rc.18 users

**Files:**
- Create: `src/main/update/update-preferences.ts`
- Create: `test/update-preferences.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces: `readUpdatePreferences(path): Promise<{ candidateOptIn: boolean }>`
- Produces: `writeCandidateOptIn(path, value): Promise<void>`
- Produces: `migrateLegacyCandidatePreference(input): Promise<boolean>`
- Stores: `<userData>/updates/preferences.json`, schema 1, mode `0600`, atomic rename.

- [ ] **Step 1: Write failing preference tests**

```ts
it('defaults clean Stable installs to opted out', async () => {
  await expect(readUpdatePreferences(path)).resolves.toEqual({ candidateOptIn: false })
})

it('opts rc.18 users in once without overriding an explicit choice', async () => {
  await expect(migrateLegacyCandidatePreference({
    path, packagedChannel: 'candidate', currentVersion: '1.0.0-rc.18'
  })).resolves.toBe(true)
  await writeCandidateOptIn(path, false)
  await expect(migrateLegacyCandidatePreference({
    path, packagedChannel: 'candidate', currentVersion: '1.0.0-rc.18'
  })).resolves.toBe(false)
})
```

Also test malformed JSON, unknown keys, atomic temp cleanup and canonical file permissions.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run test/update-preferences.test.ts`

Expected: FAIL because the preference store does not exist.

- [ ] **Step 3: Implement the atomic preference store**

Match the existing skipped-version atomic-write pattern. Record migration by writing the file; file absence is the only signal that migration has not run. Malformed files must be quarantined by ignoring them and returning `candidateOptIn: false`, without logging their contents.

- [ ] **Step 4: Wire migration before update initialization**

In `initializeUpdates`, compute the preference path from `app.getPath('userData')`, migrate only the exact rc.18 packaged Candidate, and inject a preference service into the update manager and About IPC.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run test/update-preferences.test.ts test/runtime.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/update/update-preferences.ts src/main/index.ts test/update-preferences.test.ts
git commit -m "feat(update): persist candidate opt-in"
```

---

### Task 3: Resolve signed v2 Stable and Candidate releases

**Files:**
- Create: `src/main/update/v2-release-source.ts`
- Create: `test/v2-release-source.test.ts`
- Modify: `src/main/update/update-environment.ts`
- Modify: `src/main/update/update-source.ts`
- Modify: `src/main/update/required-update-policy.ts`
- Modify: `test/required-update-policy.test.ts`

**Interfaces:**
- Produces: `V2ReleaseSource.resolve(track, target): Promise<ResolvedRelease>`
- Produces: target-specific Candidate URL and Stable URL helpers.
- Produces: required-policy cache schema 2 containing rollout, index and target trust-chain bytes.
- Consumes: Task 1 verifiers and the existing product public key.

- [ ] **Step 1: Write failing source tests**

Cover Stable envelope → Release Index → target Manifest, Candidate target envelope → target Manifest, wrong target, hash mismatch, signature mismatch, redirect, timeout, incomplete Stable index and Candidate required policy.

```ts
it('resolves only the current platform Candidate pointer', async () => {
  await source.resolve('candidate', { platform: 'darwin', arch: 'x64' })
  expect(fetch).toHaveBeenCalledWith(
    new URL('desktop/candidate-v2/darwin-x64/current.json', origin),
    expect.anything()
  )
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run test/v2-release-source.test.ts test/required-update-policy.test.ts`

Expected: FAIL because v2 source and cache schema 2 are absent.

- [ ] **Step 3: Implement v2 URL derivation and trust-chain resolution**

Derive all URLs from the fixed HTTPS origin and validated version/target values. Fetch each envelope or immutable object with the existing 30-second deadline, reject redirects, verify each signature and SHA-512 reference, then expose only the verified target directory to electron-updater.

- [ ] **Step 4: Upgrade required-policy persistence**

Write schema 2 only for Stable required rollouts:

```ts
interface CachedRequiredPolicyV2 {
  schema: 2
  rolloutEnvelopeBase64: string
  releaseIndexBase64: string
  releaseIndexSignatureBase64: string
  targetManifestBase64: string
  targetManifestSignatureBase64: string
}
```

Keep schema 1 reading for rc.18 compatibility. On restore, verify the entire chain before showing a required update.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run test/v2-release-source.test.ts test/required-update-policy.test.ts test/generic-release-source.test.ts`

Expected: PASS for v1 and v2.

- [ ] **Step 6: Commit**

```bash
git add src/main/update/v2-release-source.ts src/main/update/update-environment.ts src/main/update/update-source.ts src/main/update/required-update-policy.ts test/v2-release-source.test.ts test/required-update-policy.test.ts
git commit -m "feat(update): verify v2 rollout trust chains"
```

---

### Task 4: Make Stable automatic and Candidate manual-only

**Files:**
- Modify: `src/main/update/update-manager.ts`
- Modify: `src/main/update/update-policy.ts`
- Modify: `src/main/update/update-executor.ts`
- Modify: `src/main/update/update-ipc.ts`
- Modify: `src/main/update/open-update-window.ts`
- Modify: `src/shared/update-api.ts`
- Modify: `src/shared/update-contracts.ts`
- Modify: `src/preload/update.ts`
- Modify: `src/renderer/src/UpdateBadge.tsx`
- Modify: `test/update-manager.test.ts`
- Modify: `test/update-policy.test.ts`
- Modify: `test/update-api-contract.test.ts`
- Modify: `test/open-update-window.test.ts`

**Interfaces:**
- Produces: `manager.check(track: UpdateTrack, manual: boolean)`
- Produces: `UpdateStatus` variants with `track` on active/check results.
- Produces: `updates:check-stable` and `updates:check-candidate` IPC commands.
- Consumes: Candidate preference service and Task 3 source.

- [ ] **Step 1: Write failing scheduling and IPC tests**

```ts
it('schedules Stable checks only and never schedules Candidate', async () => {
  await manager.start()
  timers.runStartup()
  expect(source.resolve).toHaveBeenCalledWith('stable', target)
  expect(source.resolve).not.toHaveBeenCalledWith('candidate', target)
})

it('rejects a manual Candidate check while opted out', async () => {
  await expect(manager.check('candidate', true)).rejects.toThrow('加入内测')
})
```

Test that Candidate results never satisfy `shouldShowUpdateEntry`, while Stable results retain the existing Badge behavior.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run test/update-manager.test.ts test/update-policy.test.ts test/update-api-contract.test.ts test/open-update-window.test.ts`

Expected: FAIL on the new track-aware API.

- [ ] **Step 3: Implement track-aware checks**

Keep one serialized operation and one active verified release, but pass the chosen track explicitly. `start()` must configure timers for `check('stable', false)` only. Candidate checks must require `manual=true` and an enabled preference. Configure electron-updater prerelease acceptance from the installed current version so rc.18 can install final `1.0.0`; do not infer rollout Track from package metadata.

- [ ] **Step 4: Split trusted IPC commands**

Only the update window may initiate `updates:check-candidate`; About opens the update window through a constrained Main command added in Task 5. Validate every sender main frame and never accept a renderer-provided URL or target.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run test/update-manager.test.ts test/update-policy.test.ts test/update-api-contract.test.ts test/open-update-window.test.ts test/generic-update-flow.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/update src/shared/update-api.ts src/shared/update-contracts.ts src/preload/update.ts src/renderer/src/UpdateBadge.tsx test/update-manager.test.ts test/update-policy.test.ts test/update-api-contract.test.ts test/open-update-window.test.ts test/generic-update-flow.test.ts
git commit -m "feat(update): make candidate checks manual only"
```

---

### Task 5: Add the themed Candidate opt-in experience

**Files:**
- Create: `src/shared/about-update-api.ts`
- Create: `src/preload/about.ts`
- Modify: `electron.vite.config.ts`
- Modify: `src/main/about-window.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/AboutApp.tsx`
- Modify: `src/renderer/src/about.css`
- Modify: `src/renderer/src/UpdateApp.tsx`
- Modify: `src/renderer/src/update.css`
- Modify: `src/renderer/src/update-view-model.ts`
- Modify: `test/about-window.test.ts`
- Modify: `test/update-window.test.ts`
- Modify: `test/update-view-model.test.ts`

**Interfaces:**
- Produces: `window.insightAboutUpdates.preference()`
- Produces: `window.insightAboutUpdates.setCandidateOptIn(value)`
- Produces: `window.insightAboutUpdates.openCandidateCheck()`
- Consumes: preference service from Task 2 and manager/window flow from Task 4.

- [ ] **Step 1: Write failing About and update-view tests**

```tsx
it('shows the opt-in control for every packaged user', () => {
  render(<AboutApp model={model} updatePreference={{ candidateOptIn: false }} />)
  expect(screen.getByRole('checkbox', { name: '接收内测更新' })).not.toBeChecked()
})

it('labels Candidate without changing the standard update actions', () => {
  expect(updateViewModel(candidateAvailable)).toMatchObject({
    badge: '内测版本', primary: 'download', secondary: 'skip'
  })
})
```

Test light/dark token presence, one-time risk confirmation, disabled Candidate button while opted out, IPC sender validation and the larger non-resizable About window dimensions.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run test/about-window.test.ts test/update-window.test.ts test/update-view-model.test.ts`

Expected: FAIL because About is read-only and update status has no Track.

- [ ] **Step 3: Add a dedicated About preload and constrained IPC**

The preload imports the existing secondary theme mount and exposes only preference read/write plus `openCandidateCheck`. Main owns the confirmation result and preference file; renderer code never receives filesystem paths.

- [ ] **Step 4: Implement the UI**

Reuse the current update window structure. Add theme tokens `--candidate-badge`, `--warning-surface`, and `--warning-border`; define values for both `data-insight-theme="light"` and `dark`. Do not add animation beyond the existing progress behavior. Candidate confirmation text must state instability, no automatic downgrade, and the Stable recovery option.

- [ ] **Step 5: Run focused tests and renderer build**

Run: `npx vitest run test/about-window.test.ts test/update-window.test.ts test/update-view-model.test.ts test/update-api-contract.test.ts`

Run: `npm run typecheck`

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add electron.vite.config.ts src/shared/about-update-api.ts src/preload/about.ts src/main/about-window.ts src/main/index.ts src/renderer/src/AboutApp.tsx src/renderer/src/about.css src/renderer/src/UpdateApp.tsx src/renderer/src/update.css src/renderer/src/update-view-model.ts test/about-window.test.ts test/update-window.test.ts test/update-view-model.test.ts test/update-api-contract.test.ts
git commit -m "feat(update): add candidate opt-in experience"
```

---

### Task 6: Build channel-neutral target artifacts and release indexes

**Files:**
- Create: `scripts/build-update-v2-target.mjs`
- Create: `scripts/build-update-v2-index.mjs`
- Create: `scripts/build-update-v2-rollout.mjs`
- Create: `scripts/verify-update-v2-assets.mjs`
- Create: `test/build-update-v2.test.ts`
- Modify: `package.json`
- Modify: `electron-builder.candidate.cjs`

**Interfaces:**
- Produces: one signed Target Manifest per target.
- Produces: one signed Release Index for exactly three matching targets.
- Produces: a single-file signed rollout envelope.
- Keeps: `electron-builder.candidate.cjs` only for rc.18 legacy packaging.
- Uses: normal Stable package configuration for every v2 target.

- [ ] **Step 1: Write failing builder tests**

Use release fixtures to prove a single target succeeds, a complete index succeeds, and the following fail: wrong updater version, duplicate artifact, mismatched Shell commits, mismatched Runtime, mismatched compatibility, missing target, Candidate required policy and non-canonical envelope.

```ts
it('refuses to index targets from different commits', async () => {
  const result = runIndex({
    arm64Commit: commitA, x64Commit: commitA, windowsCommit: commitB
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('same Shell commit')
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run test/build-update-v2.test.ts`

Expected: FAIL because v2 builders do not exist.

- [ ] **Step 3: Implement target, index and rollout builders**

Each script accepts an explicit target/version/input directory and an out-of-repository private key path. Sort artifacts deterministically. Sign the exact bytes written. The rollout builder reads all current pointer files supplied by the publisher and enforces the global version floor.

- [ ] **Step 4: Preserve the rc.18 legacy builder boundary**

Add explicit package scripts named `package:bridge:*` that use `electron-builder.candidate.cjs`. Rename v2 target scripts to `package:release:*` and ensure they use the Stable metadata in `package.json`. Add a contract test that v2 packages contain `insightDesktopChannel: stable` and the same app ID/product name as Stable.

- [ ] **Step 5: Run focused verification**

Run: `npx vitest run test/build-update-v2.test.ts test/build-update-release.test.ts test/runtime.test.ts`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-update-v2-target.mjs scripts/build-update-v2-index.mjs scripts/build-update-v2-rollout.mjs scripts/verify-update-v2-assets.mjs test/build-update-v2.test.ts package.json electron-builder.candidate.cjs
git commit -m "feat(release): build immutable v2 target artifacts"
```

---

### Task 7: Add resumable per-target GitHub build aggregation

**Files:**
- Create: `.github/workflows/release-v2.yml`
- Create: `scripts/prepare-update-v2-draft.mjs`
- Create: `scripts/upload-update-v2-target.mjs`
- Create: `scripts/verify-release-v2-workflow.mjs`
- Create: `test/release-v2-workflow.test.ts`

**Interfaces:**
- Workflow inputs: `version`, `target`.
- Targets: `darwin-arm64`, `darwin-x64`, `win32-x64`.
- Produces: immutable `vX.Y.Z` Tag on the first run and an append-only Draft Release.
- Consumes: Task 6 builders and existing signing/notarization secrets.

- [ ] **Step 1: Write failing workflow contract tests**

Require per-version concurrency, fixed target choices, tag pinning, Stable package scripts, existing Draft verification, no `--clobber`, target-specific asset names, signing/certification gates, and no OSS credentials.

```ts
expect(workflow).toContain('group: desktop-release-v2-${{ inputs.version }}')
expect(workflow).toContain('ref: refs/tags/v${{ inputs.version }}')
expect(workflow).not.toContain('--clobber')
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run test/release-v2-workflow.test.ts`

Expected: FAIL because the workflow is absent.

- [ ] **Step 3: Implement release initialization**

On the first run, require the version to exceed all authoritative Stable/Candidate pointers, verify `package.json`, create and push the immutable Tag at the selected main commit, and create a Draft Release. On later runs, require the existing Tag and Draft to identify the same commit and version.

- [ ] **Step 4: Implement target-specific builds and append-only upload**

Checkout the immutable Tag. Build only the requested target. Name GitHub assets with the target prefix, including its Manifest and signature. Before upload, compare every existing target asset by size and SHA-512; upload only missing files and reject conflicts.

- [ ] **Step 5: Run workflow contract and legacy tests**

Run: `npx vitest run test/release-v2-workflow.test.ts test/release.test.ts`

Run: `node scripts/verify-release-v2-workflow.mjs .github/workflows/release-v2.yml`

Expected: PASS; legacy rc.18 workflow remains valid.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release-v2.yml scripts/prepare-update-v2-draft.mjs scripts/upload-update-v2-target.mjs scripts/verify-release-v2-workflow.mjs test/release-v2-workflow.test.ts
git commit -m "feat(release): aggregate v2 targets without rebuilding"
```

---

### Task 8: Stage targets, publish Candidate, record acceptance and promote Stable

**Files:**
- Create: `.github/workflows/publish-update-v2.yml`
- Create: `scripts/publish-update-v2-to-oss.mjs`
- Create: `scripts/verify-publish-v2-workflow.mjs`
- Create: `test/publish-update-v2.test.ts`
- Modify: `scripts/github-oss-client.mjs`

**Interfaces:**
- Commands: `stage-target`, `publish-candidate`, `accept-target`, `promote-stable`, `reject-version`.
- Inputs: exact `version`, and `target` for target commands.
- Produces: target-scoped immutable OSS directories, Candidate rollout envelopes, acceptance records, signed Release Index, Stable rollout envelope and redacted reports.

- [ ] **Step 1: Write failing publisher tests**

Cover all commands, all targets, global version floor, idempotent target stage, conflicting bytes, pointer compare-and-check, Candidate optional policy, acceptance digest mismatch, incomplete Stable set, inconsistent commits, failed CDN verification and interrupted promotion replay.

```ts
it('promotes only three accepted manifests with identical identity', async () => {
  await expect(promoteStable(fixtureWithAcceptedTargets())).resolves.toMatchObject({
    pointerAfter: { track: 'stable', version: '1.0.1' }
  })
  expect(oss.putObject).toHaveBeenLastCalledWith(
    'desktop/stable/current.json', expect.anything(), expect.anything()
  )
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run test/publish-update-v2.test.ts`

Expected: FAIL because the v2 publisher is absent.

- [ ] **Step 3: Implement immutable target staging**

Download the Draft target assets, verify signatures and hashes, upload under the target directory with forbid-overwrite headers, download them again, and compare SHA-512. `stage-target` never changes a client pointer.

- [ ] **Step 4: Implement Candidate publication and acceptance**

`publish-candidate` signs an optional target rollout and updates only that target pointer after authoritative compare-and-check. `accept-target` runs behind the `desktop-release` Environment, re-verifies CDN bytes, and adds an append-only acceptance record containing actor, workflow run, version, target and Target Manifest digest.

- [ ] **Step 5: Implement Stable promotion**

Require all three Candidate pointers and acceptance records to reference the same version and manifests. Re-download all objects, build/sign/upload the immutable Release Index, publish the GitHub Draft as a normal Release, re-read authoritative pointers, and write the Stable rollout envelope last. Re-running the exact operation must converge without replacing assets.

- [ ] **Step 6: Implement rejection**

`reject-version` records the rejection in the publisher report and Draft title without deleting immutable assets or rolling back any pointer. The next Candidate must use a globally higher version.

- [ ] **Step 7: Run focused and workflow tests**

Run: `npx vitest run test/publish-update-v2.test.ts test/github-oss-client.test.ts test/publish-update-to-oss.test.ts`

Run: `node scripts/verify-publish-v2-workflow.mjs .github/workflows/publish-update-v2.yml`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/publish-update-v2.yml scripts/publish-update-v2-to-oss.mjs scripts/verify-publish-v2-workflow.mjs scripts/github-oss-client.mjs test/publish-update-v2.test.ts
git commit -m "feat(release): promote accepted v2 artifacts"
```

---

### Task 9: Enforce Candidate recovery compatibility

**Files:**
- Modify: `build/update-compatibility.json`
- Modify: `src/main/update/v2-release-contract.ts`
- Modify: `scripts/update-v2-contract.mjs`
- Modify: `src/main/update/update-manager.ts`
- Create: `test/candidate-recovery-policy.test.ts`
- Modify: `docs/release-runbook.md`

**Interfaces:**
- Produces: `readsDataSchema.minimum`, `readsDataSchema.maximum`, and `writesDataSchema` checks.
- Requires: Candidate `writesDataSchema` to be readable by the active recovery baseline compatibility range.
- Exposes: a fixed public recovery-download action sourced from the verified Stable rollout, or from the validated legacy bridge before first Stable promotion.

- [ ] **Step 1: Write failing recovery tests**

```ts
it('blocks a Candidate whose writes are unreadable by current Stable', () => {
  expect(() => assertCandidateRecoveryCompatible({
    stableReads: { minimum: 1, maximum: 1 }, candidateWrites: 2
  })).toThrow('cannot be recovered by the current Stable')
})
```

Test that the verified Stable full installer remains available while a Candidate is installed and that recovery never deletes userData.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run test/candidate-recovery-policy.test.ts`

Expected: FAIL because write-schema recovery checks are absent.

- [ ] **Step 3: Implement publisher and client recovery gates**

Reject an incompatible Candidate before its pointer can move. Re-check compatibility client-side before download. Add a recovery action that opens only the full installer URL from the verified Stable rollout; before the first Stable pointer exists, use the verified legacy bridge release. Do not accept renderer URLs and do not enable electron-updater downgrades.

- [ ] **Step 4: Document operator recovery procedure**

Document macOS overwrite installation and Windows NSIS repair/overwrite verification while preserving userData. Include a stop condition if either installer requires data deletion.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run test/candidate-recovery-policy.test.ts test/update-manager.test.ts test/update-api-contract.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add build/update-compatibility.json src/main/update/v2-release-contract.ts scripts/update-v2-contract.mjs src/main/update/update-manager.ts test/candidate-recovery-policy.test.ts docs/release-runbook.md
git commit -m "feat(update): enforce candidate recovery compatibility"
```

---

### Task 10: Complete automated verification and documentation

**Files:**
- Modify: `docs/release-runbook.md`
- Create: `docs/releases/update-v2-operator-checklist.md`
- Create: `test/update-v2-bridge.test.ts`
- Modify: `scripts/verify-release-workflow.mjs`
- Modify: `scripts/verify-publish-workflow.mjs`

**Interfaces:**
- Produces: a checked operator sequence for bridge, target Candidate, acceptance and Stable promotion.
- Produces: an in-process rc.18 → final-version integration fixture.

- [ ] **Step 1: Add bridge and promotion integration tests**

The fixture must prove:

```text
rc.17 --legacy Candidate v1--> rc.18
rc.18 --manual Candidate v2--> 1.0.0
1.0.0 Candidate --same signed bytes--> 1.0.0 Stable
```

Also assert that rc.18 creates no Candidate timers, a clean 1.0.0 install is opted out, a Candidate result does not show the global Badge, and Stable required policy survives restart.

- [ ] **Step 2: Run the integration test and verify failure before final wiring**

Run: `npx vitest run test/update-v2-bridge.test.ts`

Expected: FAIL until Tasks 1–9 are fully connected.

- [ ] **Step 3: Update the runbook and operator checklist**

Write exact commands/workflow inputs, expected reports, pointer URLs, CDN checks, rejection behavior, version-burning rule, target acceptance fields and recovery steps. Mark the old Candidate workflow as bridge-only after rc.18.

- [ ] **Step 4: Run the complete local gate**

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run build:prepared`

Run: `node scripts/verify-release-workflow.mjs .github/workflows/release.yml package.json`

Run: `node scripts/verify-publish-workflow.mjs .github/workflows/publish-update.yml scripts/github-oss-client.mjs`

Run: `node scripts/verify-release-v2-workflow.mjs .github/workflows/release-v2.yml`

Run: `node scripts/verify-publish-v2-workflow.mjs .github/workflows/publish-update-v2.yml`

Expected: all PASS and `git diff --check` produces no output.

- [ ] **Step 5: Commit**

```bash
git add docs/release-runbook.md docs/releases/update-v2-operator-checklist.md test/update-v2-bridge.test.ts scripts/verify-release-workflow.mjs scripts/verify-publish-workflow.mjs
git commit -m "docs(update): complete v2 release verification"
```

---

### Task 11: Publish and validate the rc.18 bridge

**Files:**
- Modify on a short-lived release branch: `package.json`
- Modify on the same branch: `package-lock.json`
- Modify on the same branch: `build/update-release-policy.json`
- Create: `docs/releases/1.0.0-rc.18.md`

**Interfaces:**
- Uses: legacy `.github/workflows/release.yml` and `.github/workflows/publish-update.yml`.
- Produces: the validated v1 bridge, expected to be `v1.0.0-rc.18`, and leaves the legacy Candidate pointer fixed on that validated bridge.

- [ ] **Step 1: Create the bridge release branch from reviewed v2 code**

```bash
git switch -c codex/release-v1.0.0-rc.18
```

Set package and policy versions to `1.0.0-rc.18`, channel to `candidate`, mode to `optional`, and retain the validated Runtime lock.

- [ ] **Step 2: Run local bridge gates**

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run build:prepared`

Run the existing release preflight for tag `v1.0.0-rc.18` and expected channel `candidate`.

Expected: all PASS.

- [ ] **Step 3: Build, stage and promote all three bridge targets**

Use the legacy Candidate workflow with target `all`, then `stage` and `promote` with exact version confirmation. Do not change `desktop/candidate/current.json` after it reaches rc.18.

- [ ] **Step 4: Execute real bridge acceptance**

On macOS arm64, macOS x64 and Windows x64, start from installed rc.17 with existing userData. Verify automatic discovery, download, installation, restart, Candidate opt-in migration, absence of future Candidate timers, and manual v2 check UI. Record installer hashes and workflow run URLs.

- [ ] **Step 5: Stop on any bridge failure**

If any platform cannot upgrade from rc.17, publish a higher legacy RC instead of moving or replacing rc.18 assets. Do not start Stable publication.

---

### Task 12: Candidate-test and promote the first v2 Stable

**Files:**
- No source edits are permitted after the release Tag is created.
- Record evidence in: `docs/releases/1.0.0.md`

**Interfaces:**
- Uses: `release-v2.yml` and `publish-update-v2.yml`.
- Produces: exact same `1.0.0` bytes for Candidate acceptance and Stable users.

- [ ] **Step 1: Initialize `1.0.0` from the reviewed main commit**

Run the v2 release workflow for the first required target. The workflow creates immutable `v1.0.0`; any later source change burns `1.0.0` and moves the release to a higher final version.

- [ ] **Step 2: Build only the targets needed for current validation**

For each target, run `stage-target`, then `publish-candidate`. Candidate testers enable the visible opt-in and click “检查内测更新”. Do not build unrelated targets until the current target passes.

- [ ] **Step 3: Accept every final target**

For each of `darwin-arm64`, `darwin-x64`, and `win32-x64`, verify clean install, coverage install, update from the previous accepted version, three restarts, userData continuity, theme-correct update UI, full-installer recovery and exact Target Manifest digest. Run `accept-target` only after evidence is recorded.

- [ ] **Step 4: Promote Stable without rebuilding**

Run `promote-stable` for the exact accepted version. Confirm the public GitHub Release, signed Release Index, Stable rollout envelope, 60-second CDN convergence, HEAD/Range support and remote asset hashes.

- [ ] **Step 5: Verify both user populations**

Confirm a Stable client discovers the new version through its automatic schedule. Confirm a Candidate tester already on the same version shows “当前版本已转为正式版” and does not download again. Confirm rc.17 still reaches rc.18 through the frozen legacy pointer.

- [ ] **Step 6: Close the release**

Append exact workflow URLs, target hashes, acceptance actors, timestamps, pointer responses and recovery results to `docs/releases/1.0.0.md`. Only then remove obsolete Drafts or releases that are not referenced by either legacy or v2 update paths.
