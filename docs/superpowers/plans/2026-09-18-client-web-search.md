# Client Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route DSH native web search through the authenticated enterprise Gateway in the current desktop integration architecture.

**Architecture:** Extend the existing `@insight-ai/desktop-integration` Host plugin with a `ctx.web` registration that reuses the existing model credential IPC client and the shared service environment. Disable the stock Core search registration in the managed Profile, and bump the managed Profile version so existing users receive the new installation-owned integration package and patch.

**Tech Stack:** TypeScript, Electron/DSH Cordis Host plugins, locked Core Runtime, Vitest, esbuild, YAML Profile patches.

## Global Constraints

- Do not modify `core-runtime.lock.json`; the locked Runtime already supplies `@deepseek-ai/dsh-web` and `@deepseek-ai/dsh-web-search-deepseek`.
- Do not expose access tokens to renderer code, persist them in the Host, or include them in request records.
- Use `desktopServiceEnvironment().modelBaseUrl` as the sole endpoint source; do not add a second service URL literal.
- Preserve the current Profile migration behavior and user-owned plugins/workspaces.
- Keep changes limited to web-search registration, Profile wiring, tests, and the two planning documents.

---

### Task 1: Add the enterprise search Provider factory

**Files:**
- Create: `packages/insight-desktop-integration/src/web-search.ts`
- Modify: `packages/insight-desktop-integration/tsconfig.json`

**Interfaces:**
- Consumes: `Context` only for the existing session request recorder; `desktopServiceEnvironment().modelBaseUrl`; `resolveAccessToken(): Promise<string>`.
- Produces: `createWebSearchProvider(ctx, resolveAccessToken): DeepSeekSearchProvider`.

- [ ] **Step 1: Add Runtime type paths.** Add `@deepseek-ai/dsh-web` and `@deepseek-ai/dsh-web-search-deepseek` entries pointing to the matching `build/core-runtime/node_modules/@deepseek-ai/.../lib/types/index.d.ts` files.

- [ ] **Step 2: Write the Provider factory test.** Create `test/enterprise-search.test.ts` with a small fake `Context`, stubbed `fetch`, and assertions for `deepseek-official`, the endpoint ending in `/messages`, `Authorization: Bearer`, `web_search_20250305`, citation mapping, no Token in recorded session data, per-search Token resolution, cancellation before dispatch, upstream 429 message, and rejection of text-only responses.

- [ ] **Step 3: Run the focused test before implementation.** Run `npx vitest run test/enterprise-search.test.ts`. It must fail because the factory does not exist yet.

- [ ] **Step 4: Implement the minimal factory.** Construct `new DeepSeekSearchProvider(() => ({
  baseURL: desktopServiceEnvironment().modelBaseUrl.replace(/\/$/u, ''),
  resolveApiKey: resolveAccessToken,
  model: 'enterprise-search',
  apiVersion: '2023-06-01',
  maxTokens: 4096,
  maxUses: 5,
  recordRequest: request => ctx.get('agents')?.currentInitiator()?.session.append('web/deepseek-search-llm-request', request)
}))`.

- [ ] **Step 5: Run the focused test after implementation.** Run `npx vitest run test/enterprise-search.test.ts`. It must pass and prove that the endpoint preserves the configured reverse-proxy prefix.

- [ ] **Step 6: Commit the Provider unit.** Run `git add packages/insight-desktop-integration/src/web-search.ts packages/insight-desktop-integration/tsconfig.json test/enterprise-search.test.ts && git commit -m "feat: add authenticated web search provider"`.

### Task 2: Register search with the existing Host lifecycle

**Files:**
- Modify: `packages/insight-desktop-integration/src/index.ts`
- Modify: `test/desktop-integration-package.test.ts`

**Interfaces:**
- Consumes: `createWebSearchProvider` from Task 1 and the existing `createModelCredentialClient`.
- Produces: one lifecycle-owned model adapter registration and one lifecycle-owned web search registration sharing one credential client.

- [ ] **Step 1: Add the failing contract assertions.** Assert that the integration Host injects `web`, imports the search factory, registers it inside the effect, and disposes its unregister function.

- [ ] **Step 2: Run the contract test before implementation.** Run `npx vitest run test/desktop-integration-package.test.ts`. It must fail on the missing `web` registration contract.

- [ ] **Step 3: Extend the Host plugin.** Change `export const inject` to `['llm', 'web']`; import `createWebSearchProvider`; create the model adapter and web Provider inside the existing effect; register both; return cleanup that calls both unregister functions before disposing the credential client.

- [ ] **Step 4: Run the package contract test.** Run `npx vitest run test/desktop-integration-package.test.ts test/enterprise-search.test.ts`. Both must pass.

- [ ] **Step 5: Commit the lifecycle wiring.** Run `git add packages/insight-desktop-integration/src/index.ts test/desktop-integration-package.test.ts && git commit -m "feat: register authenticated web search in desktop integration"`.

### Task 3: Disable the stock search Provider and migrate the managed Profile

**Files:**
- Modify: `packages/insight-desktop-integration/cordis.patch.yml`
- Modify: `scripts/prepare-bundled-profile.mjs`
- Modify: `src/main/state/bundled-profile.ts`
- Modify: `test/authenticated-sidebar-contract.test.ts`
- Modify: `test/bundled-profile.test.ts`

**Interfaces:**
- Consumes: the installation-owned integration package and the Provider registration from Tasks 1–2.
- Produces: Profile version 6 with `web-search-deepseek` disabled and the first-party integration enabled.

- [ ] **Step 1: Add failing Profile assertions.** Assert the patch contains `id: web-search-deepseek` with `disabled: true`, the preparation script uses version 6, the runtime migration accepts version 5, and generated manifests report version 6.

- [ ] **Step 2: Run the Profile-focused tests before implementation.** Run `npx vitest run test/authenticated-sidebar-contract.test.ts test/bundled-profile.test.ts`. They must fail on the version and patch assertions.

- [ ] **Step 3: Update the patch and versions.** Add the stock Provider disable entry, set both Profile constants to 6, and add 5 to the existing migration list. Do not change the user plugin or workspace preservation logic.

- [ ] **Step 4: Run the Profile-focused tests.** Run `npx vitest run test/authenticated-sidebar-contract.test.ts test/bundled-profile.test.ts`. They must pass.

- [ ] **Step 5: Commit Profile wiring.** Run `git add packages/insight-desktop-integration/cordis.patch.yml scripts/prepare-bundled-profile.mjs src/main/state/bundled-profile.ts test/authenticated-sidebar-contract.test.ts test/bundled-profile.test.ts && git commit -m "feat: route bundled web search through enterprise gateway"`.

### Task 4: Verify the integrated artifact

**Files:**
- Modify: none unless a verification failure identifies a regression in Tasks 1–3.

**Interfaces:**
- Consumes: the committed Provider, Host lifecycle, and Profile changes.
- Produces: type-safe, built desktop integration and passing regression suite.

- [ ] **Step 1: Prepare the locked Core Runtime if absent.** Run `npm run prepare:core-runtime`; it must finish with the Runtime artifact matching `core-runtime.lock.json`.

- [ ] **Step 2: Run type checks.** Run `npm run typecheck:desktop-integration && npm run typecheck`; both must exit successfully.

- [ ] **Step 3: Build the integration package.** Run `npm run build:desktop-integration`; the generated `packages/insight-desktop-integration/lib/index.js` must contain the external Runtime imports and `lib/client.js` must still build.

- [ ] **Step 4: Run the full test suite.** Run `npm test`; all tests must pass.

- [ ] **Step 5: Inspect the final diff.** Run `git diff origin/main...HEAD --check` and `git diff --stat origin/main...HEAD`; confirm no Runtime lock, renderer credential, unrelated file, or user-data deletion changes are present.

- [ ] **Step 6: Commit verification-only changes if any.** If verification required a source correction, run the focused test first, then `git add` only the corrected files and commit with a message describing the correction; otherwise leave the verification state clean.
