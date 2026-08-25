# Core Runtime Manifest Implementation Plan

> **For agentic workers:** Execute this plan inline as authorized by the user. Do not replace the registry-supplied Harness Runtime or add an update service.

**Goal:** Ship a machine-readable runtime manifest with every Insight desktop build so support can identify the exact DSH and Node runtime in an installation.

**Architecture:** A pre-build Node script reads the root dependency declarations and npm lockfile, validates the pinned DSH package record, and writes `build/runtime-manifest.json`. Electron copies that file into `Resources`; the main process validates and records it in `harness.log` during bootstrap.

**Tech Stack:** Node.js ESM scripts, npm lockfile v3, Electron main process, Vitest.

## Global Constraints

- Core remains registry-supplied in this phase; `core.commit` is `null` and `core.source` is `registry`.
- The checksum is the lockfile SRI integrity for `@deepseek-ai/dsh`, not a self-referential installer checksum.
- The manifest is generated for the host platform and architecture used to build the package.
- No new renderer UI, IPC API, update backend, or Core artifact download is introduced.

---

### Task 1: Generate and validate the runtime manifest

**Files:**
- Create: `scripts/prepare-runtime-manifest.mjs`
- Create: `test/runtime-manifest.test.ts`

**Interfaces:**
- Produces: `createRuntimeManifest(packageJson, packageLock, target): RuntimeManifest`
- Produces: `writeRuntimeManifest(outputPath, manifest): Promise<void>`

- [ ] **Step 1: Write failing tests**

```ts
expect(manifest).toMatchObject({
  schemaVersion: 1,
  core: { source: 'registry', commit: null },
  harness: { package: '@deepseek-ai/dsh', version: '0.1.1-rc.1' },
  node: { version: '24.9.0' },
  target: { platform: process.platform, arch: process.arch }
})
expect(manifest.checksums.dshPackage).toMatch(/^sha512-/)
```

- [ ] **Step 2: Implement the smallest generator**

```js
export function createRuntimeManifest(packageJson, packageLock, target) {
  const dsh = packageLock.packages['node_modules/@deepseek-ai/dsh']
  if (!dsh?.integrity) throw new Error('…')
  return { schemaVersion: 1, core: { source: 'registry', commit: null }, … }
}
```

- [ ] **Step 3: Verify focused tests and generated JSON**

Run: `npx vitest run test/runtime-manifest.test.ts && npm run prepare:runtime-manifest`

Expected: the test passes and `build/runtime-manifest.json` contains the pinned package version, Node version, target, and DSH SRI integrity.

### Task 2: Package and report the manifest

**Files:**
- Modify: `package.json`
- Create: `src/main/state/runtime-manifest.ts`
- Modify: `src/main/index.ts`
- Modify: `test/release.test.ts`
- Modify: `test/runtime-manifest.test.ts`

**Interfaces:**
- Consumes: `build/runtime-manifest.json`
- Produces: `readRuntimeManifest(path): RuntimeManifest`

- [ ] **Step 1: Add failing package/resource tests**

```ts
expect(packageJson.scripts.build).toContain('prepare:runtime-manifest')
expect(packageJson.build.extraResources).toContainEqual({
  from: 'build/runtime-manifest.json',
  to: 'runtime-manifest.json'
})
```

- [ ] **Step 2: Wire the generator into development and production build commands**

```json
"prepare:runtime-manifest": "node scripts/prepare-runtime-manifest.mjs",
"build": "npm run prepare:runtime-manifest && electron-vite build"
```

- [ ] **Step 3: Read the packaged/development resource during bootstrap**

```ts
const manifest = readRuntimeManifest(desktopResourcePath('runtime-manifest.json'))
runtime.note(`[desktop] runtime manifest: ${JSON.stringify(manifest)}`)
```

- [ ] **Step 4: Verify the focused suite and project checks**

Run: `npm test && npm run typecheck && npm run build`

Expected: all tests pass, TypeScript checks pass, and a built manifest exists.

### Task 3: Document the operational verification path

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`

- [ ] **Step 1: Describe the resource location and fields**

```text
<App>.app/Contents/Resources/runtime-manifest.json
```

- [ ] **Step 2: Verify documentation references the generated resource**

Run: `rg -n "runtime-manifest" README.md README.zh.md`

Expected: both READMEs explain how to inspect the runtime version data.
