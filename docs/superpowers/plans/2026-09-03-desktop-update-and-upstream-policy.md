# Desktop Update and Upstream Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Insight Desktop an independently maintained product fork and add authenticated whole-client updates for signed macOS and unsigned Windows releases hosted on GitHub Releases.

**Architecture:** The Shell main process owns update scheduling, GitHub release discovery, Ed25519 manifest verification, `electron-updater`, downloaded-artifact verification, and installation shutdown. A dedicated child update window and narrow preload APIs expose status before login, during recovery, and over the authenticated Harness surface; required first-party plugins and the locked Core Runtime update only with the complete application.

**Tech Stack:** Electron 43, electron-builder/electron-updater 26.15/6.x, TypeScript 5.9, React 18, Node crypto Ed25519, Zod, semver, Vitest 4, GitHub Actions, GitHub Releases, NSIS, Apple Developer ID and Notary Service.

## Global Constraints

- `dataelement/dsh-desktop` is a reference upstream; do not merge its main branch, package manifest, lockfile, vendored Harness packages, dshmarket tree, brand assets, or workflow wholesale.
- `core-runtime.lock.json` remains the sole Shell authority for the embedded Core Runtime.
- Required first-party plugins, Better Sidebar, the default Profile and Core Runtime update only as one complete desktop release.
- Stable production artifacts use App ID `com.insight.desktop`; development and candidate builds use separate App IDs and user-data roots.
- Stable and candidate macOS packages are Developer ID signed, notarized and stapled.
- Windows NSIS packages remain unsigned and may trigger SmartScreen; update installation still requires an Ed25519-authenticated manifest and matching artifact SHA512.
- Development packages never contact or install from candidate or stable update sources.
- Initial update hosting is the public `Boxser567/insight-desktop-shell` GitHub Releases feed.
- Stable tags use `v<major>.<minor>.<patch>` and candidate tags use `v<major>.<minor>.<patch>-rc.<number>`; drafts are never visible to installed clients.
- Stable and candidate channels never discover each other's releases.
- A signed manifest may require an update only when the installed version is below its `minimumSupportedVersion`; a required update cannot be skipped and a cached verified policy gates login/Core on later launches.
- Linux, dshmarket integration, independent required-plugin updates, historical-version installation and data downgrade migrations are outside this plan.
- An update must preserve all product `userData`, account-scoped Harness homes, sessions, workspaces, settings, future canvas assets and user-imported plugins.
- Do not trigger a GitHub installer build until focused tests, local build, fixture UI validation and the corresponding local packaged smoke pass.

---

## File Map

### Product and policy

- Modify `README.md` — identify this repository and replace periodic full upstream merge instructions.
- Modify `package.json` and `package-lock.json` — correct repository identity, add updater dependencies and publish metadata.
- Modify `docs/client-build-runbook.md` — define reference-upstream intake and updater validation gates.
- Modify `docs/plans/2026-08-28-authenticated-sidebar-integration-design.md` — replace full Shell upstream merge assumptions.
- Create `docs/upstream-intake.md` — repeatable audit ledger and selective-adoption template.

### Shared contracts and verification

- Create `src/shared/update-contracts.ts` — renderer-safe status union, commands, manifest fields and platform/channel names.
- Create `src/shared/update-api.ts` — narrow renderer API shared by Shell, Harness and update-window preloads.
- Create `src/main/update/release-manifest.ts` — strict manifest parsing, Ed25519 verification and target selection.
- Create `src/main/update/update-source.ts` — source-neutral release-resolution interface.
- Create `src/main/update/github-release-source.ts` — public GitHub Releases implementation.
- Create `build/update-compatibility.json` — release data-compatibility numbers.
- Create `build/update-signing-public.pem` — production update-signing public key.

### Update lifecycle

- Create `src/main/update/update-policy.ts` — channel, schedule and support policy.
- Create `src/main/update/update-state.ts` — pure state reducer.
- Create `src/main/update/skipped-version.ts` — atomic skipped-version persistence.
- Create `src/main/update/required-update-policy.ts` — cache only an authenticated minimum-version gate.
- Create `src/main/update/update-executor.ts` — testable adapter around `electron-updater`.
- Create `src/main/update/update-manager.ts` — serialization, scheduling, source authentication, download verification and installation.
- Create `src/main/update/update-window.ts` — dedicated child window lifecycle.
- Modify `src/main/workspace/workspace-lifecycle.ts` — serialized explicit stop before installation.
- Modify `src/main/index.ts` — composition only: create manager, register IPC/menu and stop it during shutdown.

### Renderer and preload

- Create `src/preload/update.ts` — update-window bridge.
- Modify `src/preload/shell.ts` and `src/preload/harness.ts` — expose the same status/open/check projection.
- Modify `src/shared/shell-api.ts`, `src/renderer/src/global.d.ts` and `packages/insight-desktop-integration/src/client/global.d.ts` — type the bridges.
- Create `src/renderer/update.html`, `src/renderer/src/update-main.tsx`, `src/renderer/src/UpdateWindow.tsx` and `src/renderer/src/update.css` — dedicated update UI.
- Create `src/renderer/src/UpdateBadge.tsx` — update entry on unauthenticated Shell surfaces.
- Modify `src/renderer/src/App.tsx` — render the pre-login update entry.
- Modify `packages/insight-desktop-integration/src/client/components.tsx`, `index.tsx`, `styles.tsx` and locale files — render authenticated footer badge without changing upstream Harness DOM.
- Modify `electron.vite.config.ts` — build Shell and update renderers plus the update preload.
- Modify `src/shared/desktop-menu.ts`, `src/preload/windows-menu.ts` and `src/main/index.ts` — add native/custom menu update commands.

### Release tooling and CI

- Create `scripts/generate-update-signing-keypair.mjs` — generate local Ed25519 PEM files without committing the private key.
- Create `scripts/build-update-release.mjs` — inventory assets, write canonical manifest and signature.
- Create `scripts/merge-mac-update-metadata.mjs` — merge arm64/x64 updater metadata.
- Create `scripts/verify-release-assets.mjs` — enforce the complete signed release set.
- Modify `scripts/finalize-windows-release.mjs` — remove signed-installer wording and validate unsigned NSIS metadata.
- Create `electron-builder.candidate.cjs` — isolated candidate identity and output.
- Modify `electron-builder.dev.cjs` — rename the channel metadata field and keep publishing disabled.
- Modify `.github/workflows/release.yml` — candidate/stable builds, unsigned Windows publication, metadata signing and publication gates.

### Tests

- Create `test/update-manifest.test.ts`, `test/github-release-source.test.ts`, `test/update-policy.test.ts`, `test/update-state.test.ts`, `test/skipped-version.test.ts`, `test/required-update-policy.test.ts`, `test/update-manager.test.ts`, `test/update-window.test.ts`, `test/update-api-contract.test.ts`, `test/build-update-release.test.ts`, `test/merge-mac-update-metadata.test.ts` and `test/verify-release-assets.test.ts`.
- Modify `test/workspace-lifecycle.test.ts`, `test/release.test.ts`, `test/shell-preload-contract.test.ts`, `test/desktop-integration-client.test.ts`, `test/windows-titlebar.test.ts` and `test/readme-parity.test.ts`.

---

### Task 1: Establish the product-fork policy and repository identity

**Files:**
- Modify: `README.md:1-40`
- Modify: `package.json:1-20`
- Modify: `package-lock.json`
- Modify: `docs/client-build-runbook.md:20-38`
- Modify: `docs/plans/2026-08-28-authenticated-sidebar-integration-design.md:108-137`
- Create: `docs/upstream-intake.md`
- Modify: `test/release.test.ts`
- Modify: `test/readme-parity.test.ts`

**Interfaces:**
- Consumes: approved design `docs/plans/2026-09-03-desktop-update-and-upstream-policy-design.md`.
- Produces: a reference-upstream policy used by every later task; correct GitHub repository metadata used by the updater and workflow.

- [ ] **Step 1: Change the release contract test to require Insight ownership**

Add a test that reads `package.json` and asserts:

```ts
expect(packageJson.repository.url).toBe(
  'git+https://github.com/Boxser567/insight-desktop-shell.git'
)
expect(packageJson.bugs.url).toBe(
  'https://github.com/Boxser567/insight-desktop-shell/issues'
)
expect(packageJson.homepage).toBe(
  'https://github.com/Boxser567/insight-desktop-shell#readme'
)
```

Change the upstream documentation assertions so they require the phrases `reference upstream`, `selective adoption`, `upstream commit range`, and reject `periodically merges`.

- [ ] **Step 2: Run the focused tests and verify the old policy fails**

Run: `npx vitest run test/release.test.ts test/readme-parity.test.ts`

Expected: FAIL because repository metadata still points to `dataelement/dsh-desktop` and README still promises periodic merges.

- [ ] **Step 3: Update repository metadata and policy documents**

Set the three `package.json` URLs to the tested Insight repository values. Update the lockfile root package metadata through `npm install --package-lock-only --ignore-scripts` rather than hand-editing dependency resolution.

Replace README's upstream section with:

```markdown
## Reference upstream

`dataelement/dsh-desktop` is retained as a reference upstream. This product branch does not periodically merge upstream main. Each intake records the reviewed commit range and selectively adopts only relevant Electron, updater, recovery or compatibility fixes while preserving the locked Core Runtime, product identity, account isolation and first-party plugins.
```

Create `docs/upstream-intake.md` with the exact audit record fields:

```markdown
## Intake record

- Review date:
- Upstream range:
- Reviewed categories: Electron lifecycle / updater / recovery / Core compatibility / product-only
- Adopted commits and files:
- Rejected changes and reason:
- Local adaptations:
- Focused tests:
- Build Runbook stage reached:
```

Update the Runbook and sidebar design so the normal operation is a reference-upstream audit. Preserve a separate statement that a deliberately requested full merge happens only on an isolated integration branch and must pass every protected product constraint before reaching `main`.

- [ ] **Step 4: Run documentation and release contract tests**

Run: `npx vitest run test/release.test.ts test/readme-parity.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the policy change**

```bash
git add README.md package.json package-lock.json docs/client-build-runbook.md docs/plans/2026-08-28-authenticated-sidebar-integration-design.md docs/upstream-intake.md test/release.test.ts test/readme-parity.test.ts
git commit -m "docs: establish reference upstream policy"
```

---

### Task 2: Define and authenticate the release manifest

**Files:**
- Create: `src/shared/update-contracts.ts`
- Create: `src/main/update/release-manifest.ts`
- Create: `build/update-compatibility.json`
- Create: `test/update-manifest.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: raw UTF-8 manifest bytes, detached Ed25519 signature bytes, an SPKI public key and `{ channel, platform, arch }`.
- Produces: `verifyReleaseManifest(input: VerifyReleaseManifestInput): SignedReleaseManifest` and `selectTargetArtifacts(manifest, target): TargetArtifacts`.

- [ ] **Step 1: Add strict shared types and failing verifier tests**

Define:

```ts
export type UpdateChannel = 'development' | 'candidate' | 'stable'
export type ReleaseUpdateChannel = Exclude<UpdateChannel, 'development'>
export type UpdatePlatform = 'darwin' | 'win32'
export type UpdateArch = 'arm64' | 'x64'

export interface SignedReleaseManifest {
  schema: 'insight-desktop-update/v1'
  version: string
  channel: ReleaseUpdateChannel
  publishedAt: string
  shellCommit: string
  coreRuntime: { tag: string; commit: string }
  policy: {
    mode: 'optional' | 'required'
    minimumSupportedVersion: string
  }
  compatibility: {
    profileSchema: number
    accountStorageSchema: number
    minimumReadableDataSchema: number
    maximumReadableDataSchema: number
  }
  artifacts: ReleaseArtifact[]
}
```

The test generates an Ed25519 key pair with `generateKeyPairSync('ed25519')`, signs the exact `Buffer` returned by `JSON.stringify(value, null, 2) + '\n'`, and proves:

- valid bytes return the parsed manifest;
- changing one byte rejects the signature;
- a valid signature with an unknown field rejects strict schema validation;
- stable cannot accept a candidate manifest;
- darwin arm64 requires its ZIP, ZIP blockmap, DMG and updater metadata;
- win32 x64 requires its NSIS installer, blockmap and updater metadata;
- another platform or architecture is rejected;
- invalid semver, invalid ISO date, duplicate artifact name, negative size and malformed SHA512 are rejected.
- a required policy rejects an invalid minimum semver or a minimum newer than the release; optional and required policies parse distinctly.

- [ ] **Step 2: Run the verifier test and confirm missing modules fail**

Run: `npx vitest run test/update-manifest.test.ts`

Expected: FAIL because `update-contracts.ts` and `release-manifest.ts` do not exist.

- [ ] **Step 3: Install validation dependencies**

Run: `npm install zod semver && npm install --save-dev @types/semver`

Expected: `package.json` and `package-lock.json` record direct dependencies without changing the locked Core Runtime.

- [ ] **Step 4: Implement exact-byte signature and schema validation**

Use this verifier structure:

```ts
import { createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
import semver from 'semver'

export function verifyReleaseManifest(input: VerifyReleaseManifestInput): SignedReleaseManifest {
  const key = createPublicKey(input.publicKeyPem)
  if (!verify(null, input.manifestBytes, key, input.signatureBytes)) {
    throw new Error('Update manifest signature is invalid.')
  }
  const parsed = manifestSchema.parse(JSON.parse(input.manifestBytes.toString('utf8')))
  if (!semver.valid(parsed.version)) throw new Error('Update version is not valid semver.')
  if (parsed.channel !== input.target.channel) throw new Error('Update channel does not match this build.')
  selectTargetArtifacts(parsed, input.target)
  return parsed
}
```

Build `manifestSchema` from `.strict()` Zod objects. Validate the digest with `/^[A-Za-z0-9+/]{86}==$/`, require safe non-negative integers for sizes and schema numbers, require `minimumReadableDataSchema <= maximumReadableDataSchema`, and reject duplicate `(platform, arch, kind, name)` tuples after parsing.

Create `build/update-compatibility.json` with version-one values:

```json
{
  "profileSchema": 1,
  "accountStorageSchema": 1,
  "minimumReadableDataSchema": 1,
  "maximumReadableDataSchema": 1
}
```

- [ ] **Step 5: Run verifier tests and typecheck**

Run: `npx vitest run test/update-manifest.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the manifest contract**

```bash
git add package.json package-lock.json build/update-compatibility.json src/shared/update-contracts.ts src/main/update/release-manifest.ts test/update-manifest.test.ts
git commit -m "feat(update): authenticate release manifests"
```

---

### Task 3: Resolve candidate and stable GitHub releases

**Files:**
- Create: `src/main/update/update-source.ts`
- Create: `src/main/update/github-release-source.ts`
- Create: `test/github-release-source.test.ts`

**Interfaces:**
- Consumes: `ReleaseUpdateChannel`, injected `fetch`, repository owner/name and production public key.
- Produces: `UpdateSource.resolve(channel, target): Promise<ResolvedRelease>` containing the verified manifest and asset URLs indexed by signed artifact name.

- [ ] **Step 1: Write source-selection and trust tests**

Use fixture GitHub API responses and assert:

```ts
expect((await source.resolve('stable', target)).manifest.version).toBe('1.2.0')
expect((await source.resolve('candidate', target)).manifest.version).toBe('1.3.0-rc.2')
```

Cover draft exclusion, stable/pre-release separation, missing manifest, missing signature, duplicated asset names, unsigned manifest bytes, a signed artifact absent from the GitHub Release, redirect failure, non-HTTPS asset URL and GitHub error/rate-limit responses.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run test/github-release-source.test.ts`

Expected: FAIL because the source files do not exist.

- [ ] **Step 3: Implement the source-neutral interface**

Define:

```ts
export interface ResolvedRelease {
  manifest: SignedReleaseManifest
  artifactUrls: ReadonlyMap<string, URL>
}

export interface UpdateSource {
  resolve(channel: ReleaseUpdateChannel, target: UpdateTarget): Promise<ResolvedRelease>
}
```

`GitHubReleaseSource` requests `https://api.github.com/repos/Boxser567/insight-desktop-shell/releases?per_page=20`, sets `Accept: application/vnd.github+json`, rejects drafts, chooses the first `prerelease === (channel === 'candidate')`, then downloads `insight-update.json` and `insight-update.json.sig`. It verifies the exact manifest bytes before trusting any artifact name or version.

Allow only HTTPS release asset URLs whose initial host is `github.com` or `api.github.com`; let `fetch` follow GitHub's signed object-storage redirect. Do not embed a GitHub token in the client.

- [ ] **Step 4: Run source tests and typecheck**

Run: `npx vitest run test/github-release-source.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the release source**

```bash
git add src/main/update/update-source.ts src/main/update/github-release-source.ts test/github-release-source.test.ts
git commit -m "feat(update): resolve authenticated GitHub releases"
```

---

### Task 4: Implement update policy, persistence and state transitions

**Files:**
- Create: `src/main/update/update-policy.ts`
- Create: `src/main/update/update-state.ts`
- Create: `src/main/update/skipped-version.ts`
- Create: `src/main/update/required-update-policy.ts`
- Create: `test/update-policy.test.ts`
- Create: `test/update-state.test.ts`
- Create: `test/skipped-version.test.ts`
- Create: `test/required-update-policy.test.ts`

**Interfaces:**
- Consumes: packaged flag, platform, channel, time, state events and a user-data directory.
- Produces: `supportsUpdates`, schedule constants, `reduceUpdateStatus`, skipped-version helpers, and authenticated required-policy cache helpers.

- [ ] **Step 1: Write pure policy and reducer tests**

Require these constants:

```ts
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
export const UPDATE_STARTUP_DELAY_MS = 15_000
export const UPDATE_STARTUP_JITTER_MS = 15_000
export const AUTO_INSTALL_ON_APP_QUIT = false
```

Test that only packaged `candidate` and `stable` builds on `darwin` or `win32` support updates. Test resume checks at exactly six hours, skipped-version persistence through restart, manual checks overriding a skipped version, atomic JSON replacement, malformed preference recovery without deleting unrelated files, required-policy cache persistence/clearing, refusal to cache unverified input, and all legal reducer transitions.

- [ ] **Step 2: Run tests and verify missing modules fail**

Run: `npx vitest run test/update-policy.test.ts test/update-state.test.ts test/skipped-version.test.ts test/required-update-policy.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement policy and the discriminated status reducer**

Use the `UpdateStatus` union from `src/shared/update-contracts.ts`. Expose only reducer events:

```ts
type UpdateStateEvent =
  | { type: 'check'; manual: boolean }
  | { type: 'available'; version: string; required: boolean; manual: boolean }
  | { type: 'progress'; version: string; required: boolean; percent: number; manual: boolean }
  | { type: 'downloaded'; version: string; required: boolean; manual: boolean }
  | { type: 'installing'; version: string; required: boolean; manual: boolean }
  | { type: 'up-to-date' }
  | { type: 'unsupported'; reason: string; manual: boolean }
  | { type: 'error'; message: string; retryable: boolean; manual: boolean }
  | { type: 'reset' }
```

Clamp progress to `0..100`. An event that lacks the version required by the current phase must throw rather than silently inventing one.

Persist `{ schema: 1, version: string }` at `updates/skipped-version.json` under product `userData`. Write a sibling temporary file, rename it over the live file, and accept only valid semver on read. `shouldOfferVersion` ignores the skip when `required` is true.

Persist `{ schema: 1, releaseVersion, minimumSupportedVersion, manifestSha512 }` at `updates/required-policy.json` only after `verifyReleaseManifest` succeeds. On read, require valid semver and recompute whether the running version is still excluded. Remove this one file after a supporting version starts; malformed cache data fails open with a warning and does not modify user content.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run test/update-policy.test.ts test/update-state.test.ts test/skipped-version.test.ts test/required-update-policy.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit state and policy**

```bash
git add src/main/update/update-policy.ts src/main/update/update-state.ts src/main/update/skipped-version.ts src/main/update/required-update-policy.ts test/update-policy.test.ts test/update-state.test.ts test/skipped-version.test.ts test/required-update-policy.test.ts
git commit -m "feat(update): define update policy and state"
```

---

### Task 5: Add the testable updater executor and manager

**Files:**
- Create: `src/main/update/update-executor.ts`
- Create: `src/main/update/update-manager.ts`
- Modify: `src/main/workspace/workspace-lifecycle.ts`
- Create: `test/update-manager.test.ts`
- Modify: `test/workspace-lifecycle.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `UpdateSource`, public key, app version/channel/target, timers, `UpdateExecutor`, user-data path and `prepareToInstall`.
- Produces: `UpdateManager.start()`, `stop()`, `status()`, `subscribe()`, `check(manual)`, `download()`, `skip(version)` and `install()`.

- [ ] **Step 1: Add failing lifecycle and manager tests**

Add `WorkspaceLifecycle.stop()` tests proving it serializes behind an active start, stops once, clears `activeScope()`, and prevents an obsolete queued account from reappearing.

Use fake source, executor, clock and timers to prove the manager:

- schedules one randomized startup check and one six-hour interval;
- coalesces concurrent checks;
- authenticates the release before asking `electron-updater` to check;
- does not offer the current or an older version;
- respects skipped versions for automatic checks and ignores the skip for manual checks;
- treats the release as required only when the running version is below the signed minimum, persists the last verified required policy, and clears it after a successfully installed supporting version starts;
- never creates a required gate from an unsigned, invalid or unavailable manifest;
- does not automatically download;
- verifies `downloadedFile` size and SHA512 against the signed artifact before `downloaded`;
- deletes only the mismatched cached installer and emits a non-installable error;
- calls `prepareToInstall` exactly once before `quitAndInstall`;
- never calls `quitAndInstall` after preparation failure;
- checks after resume only when six hours elapsed;
- never starts an updater in development or unpackaged mode.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx vitest run test/update-manager.test.ts test/workspace-lifecycle.test.ts`

Expected: FAIL because the manager, executor and explicit lifecycle stop do not exist.

- [ ] **Step 3: Install and wrap electron-updater**

Run: `npm install electron-updater@^6.8.9`

Define a narrow executor instead of exposing the package:

```ts
export interface UpdateExecutor {
  configure(options: { channel: ReleaseUpdateChannel; autoInstallOnQuit: false }): void
  check(): Promise<ExecutorUpdate | undefined>
  download(): Promise<void>
  quitAndInstall(): void
  on(listener: (event: ExecutorEvent) => void): () => void
}
```

The Electron adapter sets `autoDownload = false`, `autoInstallOnAppQuit = false`, `allowPrerelease = channel === 'candidate'`, `allowDowngrade = false`, and uses the GitHub provider generated into `app-update.yml`. Map `update-available`, `update-not-available`, `download-progress`, `update-downloaded` and `error` to the interface. Include `downloadedFile` in the downloaded event.

Configure Electron Builder with:

```json
"publish": [{
  "provider": "github",
  "owner": "Boxser567",
  "repo": "insight-desktop-shell"
}],
"detectUpdateChannel": false
```

Keep every package script on `--publish never`; GitHub Actions remains the only publication owner.

- [ ] **Step 4: Implement the manager as a serialized service**

Keep source authentication separate from executor events. A check first resolves and verifies the signed release, selects the target installer/ZIP, compares it with `app.getVersion()`, and only then lets the executor check the provider. Reject any executor-reported version that differs from the signed manifest version.

Use one `operation: Promise<void> | undefined` for check/download/install exclusion. Store unsubscribe functions and timers; `stop()` clears them and removes the resume listener. Never retain the private key, GitHub credentials or a mutable artifact URL in renderer status.

Use streaming SHA512 for `downloadedFile`:

```ts
const digest = createHash('sha512')
for await (const chunk of createReadStream(downloadedFile)) digest.update(chunk)
if (digest.digest('base64') !== artifact.sha512) {
  await rm(downloadedFile, { force: true })
  throw new Error('Downloaded update does not match the authenticated release.')
}
```

- [ ] **Step 5: Add serialized workspace shutdown**

Add:

```ts
stop(): Promise<void> {
  const revision = ++this.revision
  const operation = this.queue.then(async () => {
    await this.driver.stop()
    if (revision === this.revision) this.scope = undefined
  })
  this.queue = operation.catch(() => undefined)
  return operation
}
```

Do not delete or reset an account directory during update preparation.

- [ ] **Step 6: Run manager tests and typecheck**

Run: `npx vitest run test/update-manager.test.ts test/workspace-lifecycle.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the update service**

```bash
git add package.json package-lock.json src/main/update/update-executor.ts src/main/update/update-manager.ts src/main/workspace/workspace-lifecycle.ts test/update-manager.test.ts test/workspace-lifecycle.test.ts
git commit -m "feat(update): manage verified client updates"
```

---

### Task 6: Expose safe IPC, menus, update window and badges

**Files:**
- Create: `src/shared/update-api.ts`
- Create: `src/main/update/update-window.ts`
- Create: `src/preload/update.ts`
- Modify: `src/preload/shell.ts`
- Modify: `src/preload/harness.ts`
- Modify: `src/shared/shell-api.ts`
- Modify: `src/shared/desktop-menu.ts`
- Modify: `src/preload/windows-menu.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Create: `src/renderer/update.html`
- Create: `src/renderer/src/update-main.tsx`
- Create: `src/renderer/src/UpdateWindow.tsx`
- Create: `src/renderer/src/update.css`
- Create: `src/renderer/src/UpdateBadge.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `electron.vite.config.ts`
- Create: `test/update-window.test.ts`
- Create: `test/update-api-contract.test.ts`
- Modify: `test/shell-preload-contract.test.ts`
- Modify: `test/windows-titlebar.test.ts`

**Interfaces:**
- Consumes: `UpdateManager` and its renderer-safe `UpdateStatus`.
- Produces: `DesktopUpdateApi` on Shell, Harness and update-window contexts; native/custom menu command `check-for-updates`; a dedicated update child window.

- [ ] **Step 1: Write failing IPC, preload and window tests**

Define the API expected by tests:

```ts
export interface DesktopUpdateApi {
  status(): Promise<UpdateStatus>
  subscribe(listener: (status: UpdateStatus) => void): () => void
  open(): Promise<void>
  check(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  skip(version: string): Promise<void>
}
```

Assert every mutating IPC handler validates the exact sender frame. Assert the update window uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `update.cjs`, and cannot navigate away. Assert a second open focuses the existing window. Assert `check-for-updates` is recognized by both macOS and Windows menus.

- [ ] **Step 2: Run contract tests and confirm failure**

Run: `npx vitest run test/update-window.test.ts test/update-api-contract.test.ts test/shell-preload-contract.test.ts test/windows-titlebar.test.ts`

Expected: FAIL because update APIs and UI entry points do not exist.

- [ ] **Step 3: Implement one reusable preload bridge**

Create a function returning a frozen `DesktopUpdateApi`; call it from the three preloads. The subscription listens only to `updates:status-changed` and removes the exact listener on unsubscribe. Expose it as `window.insightDesktopUpdates`.

Register handlers in main for `updates:status`, `updates:open`, `updates:check`, `updates:download`, `updates:install` and `updates:skip`. Shell and update-window calls must come from their own main frames; Harness calls must come from the active Harness view main frame.

- [ ] **Step 4: Build the dedicated update window**

Create a non-modal child `BrowserWindow` sized about 560×360, hidden until `ready-to-show`, parented to the main window when available. Load `update.html` in production and `${ELECTRON_RENDERER_URL}/update.html` in development. The window renders phase-specific actions:

- `idle` or `up-to-date`: current version and check action;
- `checking`: disabled progress state;
- `available`: download, skip and remind-later actions;
- `downloading`: percent progress and no install action;
- `downloaded`: install and restart;
- `error`: bounded message and retry when `retryable`;
- `unsupported`: explicit development/unpackaged explanation.

No update window component receives a filesystem path or arbitrary URL.

- [ ] **Step 5: Add pre-login and authenticated entries**

`UpdateBadge` subscribes to status and renders only for `available` or `downloaded`. Place it on unauthenticated Shell screens without covering the drag region. A required status opens the update window, hides skip/remind-later, keeps retry and quit available, and blocks `authManager.restore()` plus workspace startup on subsequent launches until the installed version satisfies the cached verified minimum.

Expose the same API in `src/preload/harness.ts`. In the first-party integration plugin, add a small update button beside the account footer when the status is actionable; clicking it calls `window.insightDesktopUpdates.open()`. Register only through the existing `sidebar.footer.action` component and its own CSS attributes—do not query or modify Harness DOM.

- [ ] **Step 6: Add application menu commands and main composition**

Add `check-for-updates` to `desktopMenuCommands`. On macOS put `Check for Updates...` below the app menu identity section. On Windows place it in the application section above Harness commands.

In `bootstrap()`, construct `UpdateManager` after the main window exists but before authentication restore. Its `prepareToInstall` calls the explicit workspace stop, closes auxiliary recovery/menu windows, and flushes Shell-owned update preferences. `before-quit` stops update timers before the existing Runtime shutdown path. Keep implementation details out of `src/main/index.ts`.

- [ ] **Step 7: Configure renderer and preload build entries**

Add `update: resolve('src/preload/update.ts')` to preload input and add both `src/renderer/index.html` and `src/renderer/update.html` to renderer Rollup input. Keep the production CSP unchanged and apply development relaxation only to local Vite pages.

- [ ] **Step 8: Run focused UI and contract tests**

Run: `npx vitest run test/update-window.test.ts test/update-api-contract.test.ts test/shell-preload-contract.test.ts test/windows-titlebar.test.ts test/desktop-integration-client.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit the Shell update surface**

```bash
git add src/shared src/main/update src/main/index.ts src/preload src/renderer electron.vite.config.ts packages/insight-desktop-integration test/update-window.test.ts test/update-api-contract.test.ts test/shell-preload-contract.test.ts test/windows-titlebar.test.ts test/desktop-integration-client.test.ts
git commit -m "feat(update): expose client update controls"
```

---

### Task 7: Build, sign and verify complete release assets

**Files:**
- Create: `scripts/generate-update-signing-keypair.mjs`
- Create: `scripts/build-update-release.mjs`
- Create: `scripts/merge-mac-update-metadata.mjs`
- Create: `scripts/verify-release-assets.mjs`
- Modify: `scripts/finalize-windows-release.mjs`
- Create: `build/update-signing-public.pem`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `test/build-update-release.test.ts`
- Create: `test/merge-mac-update-metadata.test.ts`
- Create: `test/verify-release-assets.test.ts`
- Modify: `test/finalize-windows-release.test.ts`
- Modify: `test/release.test.ts`

**Interfaces:**
- Consumes: one release-assets directory, desktop semver, channel, Shell commit, runtime manifest, compatibility JSON and an Ed25519 private key path.
- Produces: merged updater metadata, `insight-update.json`, `insight-update.json.sig`, validated installer/blockmap inventory and a committed public key.

- [ ] **Step 1: Write failing release-tool fixture tests**

Create small fixture files and test that the release builder inventories exact file size/SHA512, sorts artifacts by `(platform, arch, kind, name)`, writes a trailing newline, signs the exact bytes, and includes the Runtime tag/commit from `build/runtime-manifest.json`.

Test mac metadata merging with two inputs whose `files` arrays point at arm64 and x64 ZIPs. Test failure on duplicate architecture, version mismatch, missing ZIP blockmap and malformed YAML.

Test final verification requires exactly:

```text
insight-mac-arm64.dmg
insight-mac-arm64.zip
insight-mac-arm64.zip.blockmap
insight-mac-x64.dmg
insight-mac-x64.zip
insight-mac-x64.zip.blockmap
insight-windows-x64-setup.exe
insight-windows-x64-setup.exe.blockmap
latest-mac.yml
latest.yml
insight-update.json
insight-update.json.sig
```

It must reject unexpected target architecture, zero-byte assets, YAML digest/size mismatch, manifest digest/size mismatch, invalid signature and version disagreement.

- [ ] **Step 2: Run release-tool tests and confirm failure**

Run: `npx vitest run test/build-update-release.test.ts test/merge-mac-update-metadata.test.ts test/verify-release-assets.test.ts test/finalize-windows-release.test.ts test/release.test.ts`

Expected: FAIL because the three new scripts and production public key do not exist.

- [ ] **Step 3: Implement key generation with private-key exclusion**

The generator uses `generateKeyPairSync('ed25519')`, writes PKCS8 private PEM to `.local/update-signing-private.pem` with mode `0600`, and writes SPKI public PEM to `build/update-signing-public.pem`. Add only `.local/update-signing-private.pem` to `.gitignore`; do not ignore the public key.

Run: `node scripts/generate-update-signing-keypair.mjs`

Expected: both files exist, `git status --short` never shows the private key, the public key is visible for commit, and `git check-ignore .local/update-signing-private.pem` succeeds.

Add the public key as an Electron Builder resource:

```json
{
  "from": "build/update-signing-public.pem",
  "to": "update-signing-public.pem"
}
```

Extend `test/release.test.ts` to require this entry and reject any private-key resource.

- [ ] **Step 4: Implement manifest creation and detached signing**

`build-update-release.mjs` accepts:

```text
--dir <release-assets>
--version <semver>
--channel candidate|stable
--shell-commit <40-hex>
--runtime-manifest <path>
--compatibility <path>
--private-key <path>
```

It identifies assets only through exact Insight filename patterns, streams SHA512, emits deterministic JSON plus one newline, signs with `sign(null, manifestBytes, privateKey)`, then reuses `verifyReleaseManifest` through a built or script-safe shared verifier before returning success.

- [ ] **Step 5: Adapt the upstream metadata utilities without DSH product assumptions**

Port only the behavior of upstream `merge-mac-update-metadata.mjs` and `verify-release-assets.mjs`. Use Insight filenames, the authenticated manifest, both architectures and no ModelScope/DSH paths.

Change `finalize-windows-release.mjs` output from `Finalized signed installer metadata` to `Finalized Windows installer metadata`. Keep rebuilding blockmap and YAML from the exact post-build installer so the unsigned bytes and metadata agree.

- [ ] **Step 6: Run release-tool tests and inspect secret hygiene**

Run: `npx vitest run test/build-update-release.test.ts test/merge-mac-update-metadata.test.ts test/verify-release-assets.test.ts test/finalize-windows-release.test.ts test/release.test.ts && git diff --check && git status --short`

Expected: tests pass; no private PEM appears in Git status or `git diff`.

- [ ] **Step 7: Store the production private key in GitHub Actions**

Run locally without printing the key:

```bash
gh secret set DESKTOP_UPDATE_SIGNING_PRIVATE_KEY < .local/update-signing-private.pem
gh secret list | grep '^DESKTOP_UPDATE_SIGNING_PRIVATE_KEY'
```

Expected: the secret name is listed; command output never includes its value.

- [ ] **Step 8: Commit release authentication tooling**

```bash
git add .gitignore package.json build/update-signing-public.pem scripts/generate-update-signing-keypair.mjs scripts/build-update-release.mjs scripts/merge-mac-update-metadata.mjs scripts/verify-release-assets.mjs scripts/finalize-windows-release.mjs test/build-update-release.test.ts test/merge-mac-update-metadata.test.ts test/verify-release-assets.test.ts test/finalize-windows-release.test.ts test/release.test.ts
git commit -m "build(update): authenticate desktop release assets"
```

---

### Task 8: Separate development, candidate and stable build channels

**Files:**
- Create: `electron-builder.candidate.cjs`
- Modify: `electron-builder.dev.cjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main/index.ts`
- Modify: `test/release.test.ts`
- Modify: `test/runtime.test.ts`

**Interfaces:**
- Consumes: builder metadata and packaged `package.json`.
- Produces: `resolveDesktopChannel(): UpdateChannel`, isolated identities and package scripts for each channel.

- [ ] **Step 1: Add failing channel-isolation tests**

Assert:

```ts
expect(stable.build.extraMetadata.insightDesktopChannel).toBe('stable')
expect(candidate.appId).toBe('com.insight.desktop.candidate')
expect(candidate.productName).toBe('因赛AI Candidate')
expect(candidate.extraMetadata.insightDesktopChannel).toBe('candidate')
expect(development.appId).toBe('com.insight.desktop.dev')
expect(development.extraMetadata.insightDesktopChannel).toBe('development')
expect(development.publish).toBeNull()
```

Require package scripts for `package:candidate:mac:arm64`, `package:candidate:mac:x64` and `package:candidate:win`, all using the candidate config and `--publish never`.
Require `package:candidate:dir` for a local unpacked candidate inspection.

- [ ] **Step 2: Run channel tests and confirm old metadata fails**

Run: `npx vitest run test/release.test.ts test/runtime.test.ts`

Expected: FAIL because development still uses `dshDesktopChannel` and candidate configuration does not exist.

- [ ] **Step 3: Implement channel resolution and builder configurations**

Rename packaged metadata to `insightDesktopChannel`. Stable `package.json` embeds `stable`; candidate and development configs override it. `resolveDesktopChannel()` returns `development` for unpackaged Electron and otherwise accepts only the three literal values, failing closed to `stable` for old production packages only when App ID is `com.insight.desktop`.

Set candidate output to `dist-candidate`, artifact names to `insight-candidate-${os}-${arch}.${ext}` and NSIS name to `insight-candidate-windows-${arch}-setup.${ext}`. Candidate macOS retains hardened runtime and production signing capability.

Set candidate `userData` to `insight-desktop-candidate`; keep stable at `insight-desktop` and development at `insight-desktop-dev`.

- [ ] **Step 4: Run channel tests, typecheck and build**

Run: `npx vitest run test/release.test.ts test/runtime.test.ts && npm run typecheck && npm run build`

Expected: PASS; normal build prepares the locked Core Runtime and both renderer entries without packaging.

- [ ] **Step 5: Commit channel isolation**

```bash
git add electron-builder.candidate.cjs electron-builder.dev.cjs package.json package-lock.json src/main/index.ts test/release.test.ts test/runtime.test.ts
git commit -m "build(update): isolate desktop release channels"
```

---

### Task 9: Rebuild the GitHub release workflow around unsigned Windows

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `test/release.test.ts`
- Modify: `docs/client-build-runbook.md`

**Interfaces:**
- Consumes: stable `v*` tag or explicit `candidate_tag`, macOS signing secrets, update-signing private key and native runner artifacts.
- Produces: draft-then-published GitHub Release whose complete assets pass `verify-release-assets.mjs`.

- [ ] **Step 1: Change workflow contract tests before YAML**

Require:

- a `candidate_tag` input rather than `windows_prerelease_tag`;
- macOS arm64/x64 ZIP blockmaps and architecture-specific YAML uploads;
- unsigned Windows EXE, blockmap and `latest.yml` uploaded directly from `windows-2022`;
- no `sign-windows`, UKey, Jsign, SafeNet, ModelScope, Feishu or `dshdesktop.com` text;
- `DESKTOP_UPDATE_SIGNING_PRIVATE_KEY` in the publish job;
- metadata merge, manifest build and complete asset verification before Release publication;
- stable publish depends directly on both macOS jobs and `windows-x64`;
- candidate publish uses candidate build scripts and marks the Release as pre-release;
- no published asset is overwritten with `--clobber`.

- [ ] **Step 2: Run the workflow contract and confirm it fails**

Run: `npx vitest run test/release.test.ts`

Expected: FAIL on the inherited Windows signing job, missing updater assets and DSH deployment remnants.

- [ ] **Step 3: Update native build jobs**

For stable tags, preserve `latest-mac.yml` as `latest-mac-arm64.yml` and `latest-mac-x64.yml`, and upload each ZIP blockmap. Windows uploads `insight-windows-x64-setup.exe`, its blockmap and `latest.yml` directly as `windows-x64`.

For `candidate_tag`, set the package version from the input, run candidate package scripts, sign/notarize both macOS architectures, and upload candidate-equivalent updater metadata under distinct artifact names.

Delete the complete `sign-windows` job. Do not add a replacement self-hosted runner.

- [ ] **Step 4: Make publication atomic and authenticated**

The publish job downloads three native artifacts, merges macOS metadata, writes the private key to a runner-temp file with mode `0600`, builds the manifest/signature, and runs asset verification.

Create a draft Release, upload the verified set, then publish it. If GitHub immutable releases are enabled, never edit or replace an existing published release. A rerun for an already published version must fail with an instruction to create a new version.

Always remove the runner-temp private key in an `if: always()` cleanup step.

- [ ] **Step 5: Update the Runbook gates**

Document that Windows SmartScreen is expected, Authenticode is absent, and a successful Windows update requires manifest signature, EXE SHA512, N-to-N+1 installation and retained account data. Document that macOS update acceptance requires Developer ID validation plus the same manifest checks.

- [ ] **Step 6: Run workflow tests and local non-packaging checks**

Run: `npx vitest run test/release.test.ts test/build-update-release.test.ts test/merge-mac-update-metadata.test.ts test/verify-release-assets.test.ts && npm run typecheck && git diff --check`

Expected: PASS.

- [ ] **Step 7: Commit the workflow**

```bash
git add .github/workflows/release.yml docs/client-build-runbook.md test/release.test.ts
git commit -m "ci(update): publish verified desktop releases"
```

---

### Task 10: Validate UI and packaged candidate update paths before stable release

**Files:**
- Modify: `docs/client-build-runbook.md`
- Create: `docs/incidents/` only if a failure changes future build or update gates.

**Interfaces:**
- Consumes: two sequential candidate versions on macOS arm64 and Windows x64.
- Produces: recorded evidence that the complete update lifecycle preserves product behavior and user data.

- [ ] **Step 1: Run the complete local source checks once**

Run:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all commands pass; build prepares the locked Core Runtime, first-party integration plugin, default Profile, Shell renderer and update renderer.

- [ ] **Step 2: Validate fixture UI without packaging**

Start development mode with a fixture update source enabled only through a test-only command-line flag accepted by unpackaged Electron. Exercise idle, checking, available, downloading, downloaded, up-to-date, unsupported and error phases.

Expected: update window works before login; authenticated footer badge opens the same window; no fixture can enable installation or contact production GitHub Releases.

- [ ] **Step 3: Build and inspect an isolated local macOS candidate directory**

Run: `npm run package:candidate:dir`

Inspect the packaged `package.json`, resources and app-update configuration.

Expected: App ID/channel are candidate, production userData is untouched, public key is present, Core Runtime manifest matches the lock, Better Sidebar and first-party integration are packaged, and no private signing key or local source path is present.

- [ ] **Step 4: Publish candidate N through GitHub Actions**

Create a non-production candidate tag through the workflow and wait for both macOS architectures plus unsigned Windows x64 to pass. Download assets and run the workflow's release verification script locally against the complete directory.

Expected: candidate Release contains its twelve channel-specific installer/update assets plus a valid manifest signature.

- [ ] **Step 5: Install candidate N and create retention evidence**

On macOS arm64 and Windows x64, install candidate N, sign in, create a Harness session, import a harmless local test plugin, confirm Better Sidebar opens Markdown/HTML, record account scope and user-data paths, then quit normally.

Expected: both installations work under candidate identities; Windows may display SmartScreen, macOS passes Gatekeeper.

- [ ] **Step 6: Publish and install candidate N+1 through the updater**

Publish the next candidate version. Wait for automatic discovery or invoke `Check for Updates...`, download, verify, install and restart.

Expected on both platforms: the client runs N+1; the signed manifest version, Shell commit and Core Runtime identity match the Release; login restoration, account isolation, session, imported plugin and Better Sidebar still work. Windows installer authentication succeeds despite no Authenticode signature.

- [ ] **Step 7: Exercise negative update cases**

Against a private fixture feed, test a modified manifest byte, invalid signature, wrong platform, wrong channel, mismatched downloaded file and unavailable GitHub response.

Expected: no invalid artifact reaches installation; the current version remains usable; only the updater cache entry is removed; user data is untouched.

- [ ] **Step 8: Record the validated release gate**

Update the Runbook with exact candidate tags, workflow runs, installed paths, Shell commits, Runtime identities, user-data roots and manual results. If failures changed a permanent gate, add one incident document and link it; otherwise do not create a timeline document.

- [ ] **Step 9: Commit verification documentation**

```bash
git add docs/client-build-runbook.md docs/incidents
git commit -m "docs(update): record candidate update validation"
```

---

## Deferred follow-up plans

After Task 10 is accepted, create separate designs and plans in this order:

1. **Compatible version rollback** — signed version catalog, data-schema preflight, metadata snapshot and isolated-data fallback.
2. **Official optional plugin catalog** — compatibility declarations and device-level installation without authority over required first-party plugins.
3. **Community plugin market evaluation** — compare selective dshmarket adoption, a fork, and a narrower in-product manager; keep it behind explicit user consent or developer mode until arbitrary third-party code permissions are designed.
4. **Regional update mirror** — implement the existing `UpdateSource` interface against object storage/CDN only when GitHub download evidence justifies it.
5. **Windows Authenticode** — add Artifact Signing or another organization certificate when distribution volume, enterprise policy or support cost justifies it; retain the product-level manifest signature after signing is added.

## Plan self-review result

- Spec coverage: product-fork policy, stable/candidate/development isolation, signed macOS, unsigned Windows automatic update, independent release authentication, GitHub source, pre-login/recovery access, account data retention, required-plugin ownership and selective upstream intake each map to at least one task.
- Deliberate exclusions: rollback execution and community marketplace are separate subprojects; the v1 manifest contains the compatibility data they will need.
- Type consistency: `UpdateChannel`, `ReleaseUpdateChannel`, `SignedReleaseManifest`, `UpdateSource`, `ResolvedRelease`, `UpdateExecutor`, `UpdateManager`, `UpdateStatus` and `DesktopUpdateApi` are introduced once and consumed by name in later tasks.
- Secret handling: only the SPKI public key is committed; the PKCS8 private key is ignored locally, stored as a GitHub secret, materialized only in runner temp and removed unconditionally.
