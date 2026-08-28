# Hide Redundant Sidebar Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the Harness settings row at the sidebar foot while keeping the account-menu settings action and complete settings dialog available.

**Architecture:** Core keeps the `sidebar.settings` shell mounted when the active `settings.trigger` contribution is null. The first-party desktop integration shadows only `settings.trigger` at priority `-100`, so `settingsDialog.open(sectionId)` and the modal host remain available without rendering the native trigger row.

**Tech Stack:** TypeScript, React 18, DSH UI Slots, Vitest, Electron Vite.

## Global Constraints

- Limit the Core change to the product-neutral settings trigger rendering rule; do not modify Harness sidebar layout, Better Sidebar, or authentication code.
- Do not hide the row with CSS, DOM queries, simulated clicks, or private selectors.
- The account menu remains the only visible settings entry in expanded and collapsed sidebar states.
- The settings dialog and `settings.section` registrations must remain available.
- Preserve all unrelated working-tree changes.

---

### Task 1: Preserve the Core settings host with an empty trigger

**Files:**
- Modify: Core `packages/client/ui-settings-general/src/client/SettingsRoot.tsx`
- Modify: Core `packages/client/ui-settings-general/tests/settings-root.client.spec.tsx`
- Modify: Core package README pair and add the required Agent Note triplet

**Interface:** A null, undefined, or false `settings.trigger` contribution suppresses only the trigger wrapper. `SettingsRoot` and `SettingsDialogController` remain mounted.

- [ ] **Step 1: Add a failing Core client test**

Mount `SettingsRoot` with a null `settings.trigger`, assert that no `aria-haspopup="dialog"` button exists, call `settingsDialog.open('models')`, and assert that the Models section renders in the dialog.

- [ ] **Step 2: Conditionally render only the trigger wrapper**

Resolve `settings.trigger` once and omit the button for null, undefined, or false content. Do not conditionally mount `SettingsRoot` or its controller attachment.

- [ ] **Step 3: Run focused Core verification**

Run the settings-root and settings-shell client tests, the affected package build, translation pairing, and documentation checks.

---

### Task 2: Shadow the Harness settings trigger from the desktop integration

**Files:**
- Modify: `packages/insight-desktop-integration/src/client/components.tsx`
- Modify: `packages/insight-desktop-integration/src/client/index.tsx`
- Modify: `test/desktop-integration-client.test.ts`
- Modify: `test/authenticated-sidebar-contract.test.ts`

**Interfaces:**
- Consumes: public single slot `settings.trigger` and its numeric `priority` shadowing rule.
- Produces: `HiddenSettingsTrigger(): null`, registered at priority `-100`; the existing account action still calls `ctx.settingsDialog.open('client')`.

- [ ] **Step 1: Add a failing source contract**

Extend `test/desktop-integration-client.test.ts` to require the formal slot registration and prohibit CSS/DOM hiding:

```ts
expect(source).toContain("ctx.slots.inject('settings.trigger'")
expect(source).toContain("name: 'settings.trigger'")
expect(source).toContain('priority: -100')
expect(source).toContain('HiddenSettingsTrigger')
expect(source).not.toContain("ctx.slots.inject('sidebar.settings'")
expect(source).not.toMatch(/querySelector|\.click\(|fetch\(|token|cookie/iu)
```

Update `test/authenticated-sidebar-contract.test.ts` so the Runtime types still contain `sidebar.settings`, while the product integration injects `settings.trigger` and does not replace `sidebar.settings`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run test/desktop-integration-client.test.ts test/authenticated-sidebar-contract.test.ts`

Expected: FAIL because `settings.trigger`, `priority: -100`, and `HiddenSettingsTrigger` are absent.

- [ ] **Step 3: Add the null slot component and registration**

Add the component to `components.tsx`:

```tsx
/** Hide the redundant settings trigger while preserving the mounted settings shell. */
export function HiddenSettingsTrigger(_: PropsRuntime<'settings.trigger'>) {
  return null
}
```

Import it in `index.tsx` and register it before the settings section:

```tsx
ctx.slots.inject('settings.trigger', () => ctx.slots.register({
  name: 'settings.trigger',
  priority: -100
}, HiddenSettingsTrigger))
```

- [ ] **Step 4: Run automated verification**

Run:

```bash
npx vitest run test/desktop-integration-client.test.ts test/authenticated-sidebar-contract.test.ts
npm run typecheck:desktop-integration
npm run build:desktop-integration
npm test
npm run typecheck
git diff --check
```

Expected: all checks pass; no Core Runtime download occurs.

- [ ] **Step 5: Commit the implementation**

```bash
git add packages/insight-desktop-integration/src/client/components.tsx packages/insight-desktop-integration/src/client/index.tsx test/desktop-integration-client.test.ts test/authenticated-sidebar-contract.test.ts
git commit -m "feat: hide redundant sidebar settings entry"
```

- [ ] **Step 6: Run the prepared DEV manual gate**

Run with host Node 22 and the already prepared local Runtime:

```bash
nvm use 22.21.1
npm exec electron-vite -- dev
```

Expected: the bottom settings row/icon is absent in expanded and collapsed modes; the account menu settings action opens the complete settings center, including the client section; sign-out remains functional.
