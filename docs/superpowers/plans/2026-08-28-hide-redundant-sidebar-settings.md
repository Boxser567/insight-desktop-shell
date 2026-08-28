# Hide Redundant Sidebar Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the Harness settings row at the sidebar foot while keeping the account-menu settings action and complete settings dialog available.

**Architecture:** The first-party desktop integration shadows the public single `sidebar.settings` slot with a null component at priority `-100`. The Harness settings registration remains loaded at priority `0`, so it continues to declare the settings slots and provide `settingsDialog.open(sectionId)` without rendering its own trigger row.

**Tech Stack:** TypeScript, React 18, DSH UI Slots, Vitest, Electron Vite.

## Global Constraints

- Do not modify Core, Harness sidebar layout, Better Sidebar, or authentication code.
- Do not hide the row with CSS, DOM queries, simulated clicks, or private selectors.
- The account menu remains the only visible settings entry in expanded and collapsed sidebar states.
- The settings dialog and `settings.section` registrations must remain available.
- Preserve all unrelated working-tree changes.

---

### Task 1: Shadow the Harness settings trigger

**Files:**
- Modify: `packages/insight-desktop-integration/src/client/components.tsx`
- Modify: `packages/insight-desktop-integration/src/client/index.tsx`
- Modify: `test/desktop-integration-client.test.ts`
- Modify: `test/authenticated-sidebar-contract.test.ts`

**Interfaces:**
- Consumes: public single slot `sidebar.settings` and its numeric `priority` shadowing rule.
- Produces: `HiddenSidebarSettings(): null`, registered at priority `-100`; the existing account action still calls `ctx.settingsDialog.open('client')`.

- [ ] **Step 1: Add a failing source contract**

Extend `test/desktop-integration-client.test.ts` to require the formal slot registration and prohibit CSS/DOM hiding:

```ts
expect(source).toContain("ctx.slots.inject('sidebar.settings'")
expect(source).toContain("name: 'sidebar.settings'")
expect(source).toContain('priority: -100')
expect(source).toContain('HiddenSidebarSettings')
expect(source).not.toMatch(/querySelector|\.click\(|fetch\(|token|cookie/iu)
```

Update `test/authenticated-sidebar-contract.test.ts` so every member of `requiredSlots`, including `sidebar.settings`, must be injected by the product integration.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run test/desktop-integration-client.test.ts test/authenticated-sidebar-contract.test.ts`

Expected: FAIL because `sidebar.settings`, `priority: -100`, and `HiddenSidebarSettings` are absent.

- [ ] **Step 3: Add the null slot component and registration**

Add the component to `components.tsx`:

```tsx
/** Hide the redundant sidebar trigger without disabling the settings service. */
export function HiddenSidebarSettings(_: PropsRuntime<'sidebar.settings'>) {
  return null
}
```

Import it in `index.tsx` and register it before the settings section:

```tsx
ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
  name: 'sidebar.settings',
  priority: -100
}, HiddenSidebarSettings))
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
