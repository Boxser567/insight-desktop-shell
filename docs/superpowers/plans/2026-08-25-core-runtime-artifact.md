# Core Runtime Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a complete, immutable Core Runtime artifact per desktop target from `insight-harness-core`.

**Architecture:** A Core deployment root contains the DSH CLI, its production dependency closure, and the pinned Node and pnpm executables required by desktop profile operations. A target runner builds the directory, writes `runtime.json` with the checked-out commit, archives it deterministically, computes SHA-256, and uploads all three files to the Core GitHub Release.

**Tech Stack:** pnpm deploy, Node.js ESM, GitHub Actions, SHA-256, tar.gz archives.

## Global Constraints

- Release targets are exactly `darwin-arm64`, `darwin-x64`, and `win32-x64`.
- Runtime version, commit, Node version, pnpm version, target, and archive checksum are immutable release facts.
- Runtime includes no user Profile, credentials, sessions, or pnpm store.
- The artifact uses the Core checkout's lockfile; it never resolves a new DSH version from the registry during Shell packaging.
- The first artifact Release is an RC; it does not create desktop auto-update behavior.

---

### Task 1: Create the Core deployment root and artifact metadata generator

**Repository:** `/Users/boxser.shi/Documents/harness/insight-harness-core`

**Files:**
- Create: `apps/runtime/package.json`
- Create: `scripts/runtime-artifact.ts`
- Create: `scripts/runtime-artifact.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `createRuntimeMetadata(input): RuntimeMetadata`
- Produces: `pnpm run runtime:artifact --target <target> --output <directory>`

- [ ] **Step 1: Write metadata validation tests**

```ts
expect(createRuntimeMetadata(input)).toEqual({
  schemaVersion: 1,
  core: { repository: 'Boxser567/insight-harness-core', version: '0.1.1-rc.2', commit },
  entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js',
  node: { version: nodeVersion },
  pnpm: { version: pnpmVersion },
  target: { platform: 'darwin', arch: 'arm64' }
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm exec vitest run scripts/runtime-artifact.spec.ts`

Expected: failure because the artifact generator does not yet exist.

- [ ] **Step 3: Implement the private deployment root and generator**

```json
{
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh": "workspace:^",
    "node": "<pinned Node version>",
    "pnpm": "<pinned pnpm version>"
  }
}
```

The generator must run the official Core build, deploy this root into `runtime/`, add `runtime.json`, and reject an output whose DSH entry, Node executable, pnpm entry, or target data is absent.

- [ ] **Step 4: Run target-local generation and inspect its metadata**

Run: `pnpm run runtime:artifact --target darwin-arm64 --output dist/runtime`

Expected: `dist/runtime/runtime/runtime.json` names the current 40-character commit and the deployed runtime contains the declared entry paths.

- [ ] **Step 5: Commit Core artifact assembly**

```bash
git add apps/runtime/package.json scripts/runtime-artifact.ts scripts/runtime-artifact.spec.ts package.json
git commit -m "feat: assemble core runtime artifacts"
```

### Task 2: Publish signed identities and checksums from Core CI

**Repository:** `/Users/boxser.shi/Documents/harness/insight-harness-core`

**Files:**
- Create: `.github/workflows/runtime-release.yml`
- Create: `scripts/runtime-artifact-release.ts`
- Create: `scripts/runtime-artifact-release.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runtime/` from Task 1
- Produces: `<artifact>.tar.gz`, `<artifact>.sha256`, `<artifact>.json`

- [ ] **Step 1: Write archive naming and SHA-256 tests**

```ts
expect(runtimeArtifactName('0.1.1-rc.2', 'win32-x64')).toBe(
  'insight-harness-runtime-0.1.1-rc.2-win32-x64.tar.gz'
)
expect(sha256Line(archive, digest)).toBe(`${digest}  ${archive}\n`)
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm exec vitest run scripts/runtime-artifact-release.spec.ts`

Expected: failure because release archive helpers do not yet exist.

- [ ] **Step 3: Implement archive generation and target workflow**

```yaml
strategy:
  matrix:
    include:
      - target: darwin-arm64
        runs-on: macos-15
      - target: darwin-x64
        runs-on: macos-15-intel
      - target: win32-x64
        runs-on: windows-2022
```

The workflow runs only by `workflow_dispatch` from an explicit Core tag, builds the target artifact, checks its SHA-256, and attaches the archive plus both metadata files to a prerelease or release selected by workflow input.

- [ ] **Step 4: Dispatch an RC and verify the Release assets**

Expected assets for each target: one `.tar.gz`, one `.sha256`, and one `.json`; the JSON commit must equal the tagged Core commit.

- [ ] **Step 5: Commit Core Release workflow**

```bash
git add .github/workflows/runtime-release.yml scripts/runtime-artifact-release.ts scripts/runtime-artifact-release.spec.ts package.json
git commit -m "feat: publish core runtime release artifacts"
```

### Task 3: Make Shell consume a locked Core artifact

**Repository:** `/Users/boxser.shi/Documents/harness/insight-desktop-shell`

**Files:**
- Create: `core-runtime.lock.json`
- Create: `scripts/prepare-core-runtime.mjs`
- Create: `src/main/state/core-runtime.ts`
- Create: `test/core-runtime.test.ts`
- Modify: `package.json`
- Modify: `scripts/prepare-bundled-profile.mjs`
- Modify: `scripts/prepare-runtime-manifest.mjs`
- Modify: `src/main/index.ts`
- Modify: `test/release.test.ts`

**Interfaces:**
- Consumes: `CoreRuntimeLock` keyed by `darwin-arm64`, `darwin-x64`, and `win32-x64`
- Produces: `build/core-runtime/runtime/runtime.json`
- Produces: `resolveCoreRuntime(resourceRoot): CoreRuntimePaths`

- [ ] **Step 1: Write failing lock and archive verification tests**

```ts
await expect(prepareCoreRuntime(lock, target)).rejects.toThrow('SHA-256')
expect(resolveCoreRuntime(resourceRoot)).toMatchObject({
  dshEntryPath: expect.stringContaining('@deepseek-ai/dsh/lib/bin.js'),
  nodeExecutablePath: expect.stringContaining('/node/bin/node')
})
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npx vitest run test/core-runtime.test.ts`

Expected: failure because no lock resolver or archive verifier exists.

- [ ] **Step 3: Implement fixed-lock download, SHA-256 check, and unpacking**

The script must accept only the current platform/architecture entry, download its exact URL, compare the archive digest to the lock before extraction, verify `runtime.json` agrees with the lock's Core version and commit, then atomically replace `build/core-runtime`. It must not use `npm install`, `npm update`, or registry fallback.

- [ ] **Step 4: Switch all Shell runtime paths to the packaged Core directory**

Replace `node_modules/@deepseek-ai/dsh`, Shell's Node package path, and Shell pnpm path in startup and bundled-profile preparation with paths from `CoreRuntimePaths`. Package `build/core-runtime` as `Resources/runtime` and project its verified Core identity into the desktop Runtime Manifest.

- [ ] **Step 5: Remove direct Shell DSH runtime dependencies and add release guards**

Delete the direct DSH package declarations only after the Core artifact test passes. Add a release test that fails if `package.json` reintroduces `@deepseek-ai/dsh` or if an Electron resource points outside `Resources/runtime` for DSH, Node, or pnpm.

- [ ] **Step 6: Verify a macOS RC package**

Run: `npm test && npm run typecheck && npm run build && npm run package:mac:arm64`

Expected: the app starts using `Contents/Resources/runtime`, Better Sidebar initializes for a fresh user profile, and `runtime-manifest.json` contains the locked Core commit and archive SHA-256.

- [ ] **Step 7: Commit Shell adoption**

```bash
git add core-runtime.lock.json scripts/prepare-core-runtime.mjs src/main/state/core-runtime.ts test/core-runtime.test.ts package.json scripts/prepare-bundled-profile.mjs scripts/prepare-runtime-manifest.mjs src/main/index.ts test/release.test.ts
git commit -m "feat: bundle locked core runtime"
```

### Task 4: Validate all desktop targets before production adoption

**Repositories:** both Core and Shell

**Files:**
- Modify: existing release workflows only to invoke the established Core artifact and Shell package commands.

- [ ] **Step 1: Produce Core RC artifacts for all targets**

Expected: GitHub Release holds matching version and commit metadata for `darwin-arm64`, `darwin-x64`, and `win32-x64`.

- [ ] **Step 2: Run Shell packages on matching runners**

Run: `npm run package:mac:arm64`, `npm run package:mac:x64`, and `npm run package:win` on their matching platform runners.

Expected: each package embeds only its matching Core Runtime artifact and reports the same Core commit in its desktop manifest.

- [ ] **Step 3: Manually verify first-run and upgrade behavior**

Expected: a clean user profile gets one Better Sidebar; an existing user profile and sessions survive; the system has no registry fallback when Core artifact identity is invalid.

- [ ] **Step 4: Commit release workflow wiring**

```bash
git add .github/workflows package.json test
git commit -m "ci: validate locked core runtime packages"
```

## Self-review

- Core artifact construction, metadata, checksum, Release publication, Shell locking, runtime replacement, and all three target checks each have a task.
- The plan never proposes a registry fallback, Core source copying, user-data migration, or auto-update service.
- The only cross-repository interface is the explicit Runtime artifact plus its lock and metadata files.
