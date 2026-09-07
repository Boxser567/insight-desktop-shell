# Signed Plugin Remote Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Insight service recommend, block, retire or require a minimum version of known plugins without silently downloading or executing code.

**Architecture:** Shell fetches a detached Ed25519-signed policy envelope after authentication, verifies the exact payload bytes with a dedicated packaged public key, caches the last valid policy and merges it with the local device registry. Recommendations require a native user confirmation before the existing device plugin installer downloads and verifies an artifact; startup never waits on the network.

**Tech Stack:** Electron main process, Node.js `crypto`, authenticated environment configuration, atomic JSON cache, native Electron dialogs, Vitest.

## Global Constraints

- Execute this plan only after `2026-09-07-device-plugin-control-plane.md` passes local DMG acceptance.
- Remote policy cannot add or update `required` packages.
- Remote policy cannot silently install or execute code.
- `recommend` requires a native confirmation every time a new package or version would be downloaded.
- `block`, `minimum-version` and `retire` may affect already known plugin IDs but cannot execute payload-provided scripts.
- Network failure, HTTP failure, invalid signature, expiry or malformed JSON must not block login or startup.
- The remote policy signing key is independent from application update signing.
- Test builds use `https://gapi-test.insight-aigc.com/desktop-server/plugin-policy/v1`; production builds use `https://gapi.insight-aigc.com/desktop-server/plugin-policy/v1`.
- Policy artifacts must use HTTPS, an exact semver version and a 64-character lowercase SHA-256 digest.
- Do not implement a server or signing service in the Shell repository.

---

### Task 1: Define the signed wire format and strict parser

**Files:**
- Create: `src/shared/plugin-remote-policy-contract.ts`
- Create: `src/main/plugins/plugin-policy-signature.ts`
- Create: `test/plugin-remote-policy-contract.test.ts`
- Create: `test/plugin-policy-signature.test.ts`

**Interfaces:**
- Produces: `SignedPluginPolicyEnvelope`, `PluginPolicyPayload`, `PluginPolicyDirective` and `parseSignedPluginPolicyEnvelope()`.
- Produces: `verifyPluginPolicyEnvelope(envelope, publicKey, now): PluginPolicyPayload`.

- [ ] **Step 1: Write parser and signature failure tests**

Cover invalid base64url, unknown schema, duplicate plugin/directive pair, floating version, non-HTTPS artifact, invalid digest, invalid signature, future `issuedAt`, expired payload and a payload larger than 256 KiB.

```ts
export interface SignedPluginPolicyEnvelope {
  schemaVersion: 1
  payload: string
  signature: string
}

export interface PluginPolicyPayload {
  schemaVersion: 1
  policyVersion: number
  issuedAt: string
  expiresAt: string
  directives: PluginPolicyDirective[]
}
```

Use a discriminated union:

```ts
type PluginPolicyDirective =
  | { plugin: string; action: 'block'; reason: string }
  | { plugin: string; action: 'retire'; reason: string; replacement?: string }
  | { plugin: string; action: 'minimum-version'; version: string; reason: string }
  | { plugin: string; action: 'recommend'; version: string; reason: string; artifactUrl: string; sha256: string }
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx vitest run test/plugin-remote-policy-contract.test.ts test/plugin-policy-signature.test.ts`

Expected: FAIL because the contract and verifier do not exist.

- [ ] **Step 3: Implement detached Ed25519 verification**

Decode `payload` and `signature` as base64url. Verify the signature over the decoded payload bytes before parsing JSON. Reject payloads outside the 256 KiB cap and enforce a five-minute maximum future clock skew. Do not reserialize JSON before verification.

- [ ] **Step 4: Run tests and commit the wire contract**

```bash
npx vitest run test/plugin-remote-policy-contract.test.ts test/plugin-policy-signature.test.ts
git add src/shared/plugin-remote-policy-contract.ts src/main/plugins/plugin-policy-signature.ts test/plugin-remote-policy-contract.test.ts test/plugin-policy-signature.test.ts
git commit -m "feat(plugins): verify signed remote policy"
```

### Task 2: Fetch after login and cache only valid policy

**Files:**
- Modify: `src/main/auth/auth-environment.ts`
- Create: `src/main/plugins/plugin-policy-cache.ts`
- Create: `src/main/plugins/plugin-policy-client.ts`
- Create: `test/plugin-policy-cache.test.ts`
- Create: `test/plugin-policy-client.test.ts`

**Interfaces:**
- Consumes: Task 1 verifier and existing `AuthEnvironmentConfig`.
- Produces: `PluginPolicyClient.refresh(signal): Promise<PolicyRefreshResult>` and `loadCachedPolicy(now)`.

- [ ] **Step 1: Add exact environment URL tests**

Extend auth environment expectations so development/candidate use the test policy URL and production uses the production URL from Global Constraints. The URL remains build-channel controlled and is not user editable.

- [ ] **Step 2: Write cache and network failure tests**

Test HTTP 200 valid policy replacement, 304 reuse, timeout, 500, invalid signature, lower policy version rollback, expired cache and atomic-write failure. A failed refresh returns the still-valid cached policy and never deletes it.

- [ ] **Step 3: Implement bounded fetch**

Start refresh only after authenticated Workspace is already usable. Use a ten-second timeout, `If-None-Match`, a 256 KiB streamed body cap and no redirects to non-HTTPS origins. Do not send account tokens unless the final service contract requires authentication; the initial endpoint is public signed metadata.

- [ ] **Step 4: Implement atomic environment-scoped cache**

Store the envelope, ETag and verification timestamp under `<userData>/insight/plugin-policy/<test|production>/policy.json`. Verify the cached signature and expiry on every read. Write a temporary sibling and rename only after verification and monotonic `policyVersion` checks pass.

- [ ] **Step 5: Run and commit client tests**

```bash
npx vitest run test/auth-environment.test.ts test/plugin-policy-cache.test.ts test/plugin-policy-client.test.ts
git add src/main/auth/auth-environment.ts src/main/plugins/plugin-policy-cache.ts src/main/plugins/plugin-policy-client.ts test/auth-environment.test.ts test/plugin-policy-cache.test.ts test/plugin-policy-client.test.ts
git commit -m "feat(plugins): cache remote plugin policy"
```

### Task 3: Merge local authority with remote directives

**Files:**
- Create: `src/main/plugins/resolve-plugin-policy.ts`
- Create: `test/resolve-plugin-policy.test.ts`
- Modify: `src/main/plugins/plugin-inventory.ts`

**Interfaces:**
- Consumes: packaged local manifest, device registry and verified remote payload.
- Produces: `resolvePluginPolicy(input): ResolvedPluginPolicy`.

- [ ] **Step 1: Write precedence tests**

Prove these exact rules:

1. Local `required` wins over every remote directive.
2. `block` prevents a removable plugin from loading.
3. `minimum-version` warns but does not download.
4. `retire` removes recommendations but does not uninstall.
5. `recommend` is display-only until confirmed.
6. An unknown installed user plugin remains allowed when no directive names it.
7. Missing or invalid remote policy returns local behavior unchanged.

- [ ] **Step 2: Implement a pure resolver**

The resolver performs no filesystem, network, DSH or dialog operation. Return separate `load`, `warnings` and `recommendations` collections so a recommendation can never accidentally enter the load path.

- [ ] **Step 3: Add resolved status to inventory**

Expose only `blocked`, `update-required`, `retired` or `recommended` status plus user-facing reason. Do not expose raw policy bytes, signatures or service URLs to the Harness page.

- [ ] **Step 4: Run and commit policy resolution**

```bash
npx vitest run test/resolve-plugin-policy.test.ts test/plugin-inventory.test.ts
git add src/main/plugins/resolve-plugin-policy.ts src/main/plugins/plugin-inventory.ts test/resolve-plugin-policy.test.ts test/plugin-inventory.test.ts
git commit -m "feat(plugins): resolve local and remote policy"
```

### Task 4: Enforce block before Runtime start without making network a dependency

**Files:**
- Modify: `src/main/plugins/reconcile-device-plugins.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/safe-mode.ts`
- Create: `test/plugin-policy-runtime.test.ts`

**Interfaces:**
- Consumes: last valid cached `ResolvedPluginPolicy` only.
- Produces: blocked removable plugins are disabled before Runtime starts.

- [ ] **Step 1: Write startup ordering tests**

Assert that cached policy is loaded, blocked packages are removed from the launch Profile or disabled, reconciliation completes and only then `runtime.start()` runs. Assert that refresh starts after ready and cannot delay `runtime.start()`.

- [ ] **Step 2: Enforce only verified cached blocks**

A valid `block` writes a Shell-owned disabled overlay without deleting device artifacts or account data. Clearing the block removes only that overlay and preserves a user's own account disable choice. Required packages ignore the directive and log a policy violation.

- [ ] **Step 3: Surface recovery detail**

Safe Mode identifies a remote block separately from a load failure and shows the signed policy reason. It does not offer “卸载” automatically.

- [ ] **Step 4: Verify and commit startup behavior**

```bash
npx vitest run test/plugin-policy-runtime.test.ts test/safe-mode.test.ts test/reconcile-device-plugins.test.ts
npm run typecheck
git add src/main/plugins/reconcile-device-plugins.ts src/main/index.ts src/main/safe-mode.ts test/plugin-policy-runtime.test.ts test/safe-mode.test.ts test/reconcile-device-plugins.test.ts
git commit -m "feat(plugins): enforce cached plugin blocks"
```

### Task 5: Confirm recommendations before download and device install

**Files:**
- Create: `src/main/plugins/recommended-plugin-install.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/harness-account-api.ts`
- Modify: `src/preload/harness.ts`
- Modify: `packages/insight-desktop-integration/src/client/components.tsx`
- Modify: `packages/insight-desktop-integration/src/client/index.tsx`
- Create: `test/recommended-plugin-install.test.ts`
- Modify: `test/harness-account-ipc.test.ts`

**Interfaces:**
- Consumes: one verified `recommend` directive and the Task 1 device plugin installer.
- Produces: `confirmAndInstallRecommendedPlugin(directive): Promise<InstallResult>`.

- [ ] **Step 1: Write confirmation and artifact tests**

Cover cancel without network, confirm plus exact download, redirect rejection, digest mismatch, invalid package identity/version, successful device registry transaction and failed current-account reconcile.

- [ ] **Step 2: Add a narrow recommendation action**

The trusted Harness page sends only the selected package name. Shell resolves the complete directive from verified policy; it never accepts URL, digest, version or install command from renderer IPC.

- [ ] **Step 3: Use a native confirmation**

Show package, version, publisher source, reason and the device-wide effect. Buttons are `安装到此设备` and `取消`, with cancel as default. Only after confirmation may Shell download to staging.

- [ ] **Step 4: Verify and import through the existing device transaction**

Stream to a capped staging file, verify SHA-256, inspect package name/version and then call the same device registry import used by local plugins. The current account reconciles immediately; other accounts receive it before next start and default to enabled.

- [ ] **Step 5: Run and commit recommendation flow**

```bash
npx vitest run test/recommended-plugin-install.test.ts test/harness-account-ipc.test.ts
npm run typecheck
git add src/main/plugins/recommended-plugin-install.ts src/main/index.ts src/shared/harness-account-api.ts src/preload/harness.ts packages/insight-desktop-integration/src/client/components.tsx packages/insight-desktop-integration/src/client/index.tsx test/recommended-plugin-install.test.ts test/harness-account-ipc.test.ts
git commit -m "feat(plugins): confirm recommended installs"
```

### Task 6: Document service ownership and verify offline behavior

**Files:**
- Create: `docs/plugin-remote-policy.md`
- Modify: `docs/plugin-management.md`
- Modify: `docs/client-build-runbook.md`

**Interfaces:**
- Consumes: all remote-policy tasks.
- Produces: the server handoff contract and operator recovery steps.

- [ ] **Step 1: Document the server contract**

Record exact endpoint paths, envelope and directive fields, Ed25519 signing input, maximum size, cache/expiry rules, error codes and the rule that recommendations never auto-install. Include one valid signed test vector generated by the test key; never commit a production private key.

- [ ] **Step 2: Run automated checks**

```bash
npx vitest run test/plugin-remote-policy-contract.test.ts test/plugin-policy-signature.test.ts test/plugin-policy-cache.test.ts test/plugin-policy-client.test.ts test/resolve-plugin-policy.test.ts test/plugin-policy-runtime.test.ts test/recommended-plugin-install.test.ts
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Perform offline and tamper acceptance**

1. Launch with no network and no cache: local plugins work normally.
2. Launch with a valid cached block: the named removable plugin does not load.
3. Tamper one payload byte: cached policy is rejected and local behavior remains available.
4. Receive a recommendation, cancel: no file is downloaded and registry is unchanged.
5. Confirm a recommendation: digest is checked, every account defaults to enabled, and uninstall removes it device-wide.
6. Return 500 and then time out: startup time and login remain unaffected.

- [ ] **Step 4: Commit operating documentation**

```bash
git add docs/plugin-remote-policy.md docs/plugin-management.md docs/client-build-runbook.md
git commit -m "docs: record signed plugin policy operations"
```

## Plan self-review

- Spec coverage: signed policy, offline cache, no silent code execution, recommendation confirmation, device-wide install, blocking, minimum version, retirement and required-plugin precedence are assigned.
- Scope split: the server implementation and Core process sandbox are excluded; the Shell contract is complete without them.
- Type consistency: wire directives, resolver output and recommendation installer all use the same package/action discriminants.
- Safety: renderer input cannot choose a URL or command, invalid policy cannot change local behavior, and network refresh cannot delay startup.
