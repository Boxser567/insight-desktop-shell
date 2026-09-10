# Desktop RC2 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不提前切换生产业务服务的前提下，完成 `1.0.0-rc.2` 的环境配置收口、品牌主题、About 窗口和主动检查更新体验，并在本地验收通过后停下等待 GitHub Actions 发布授权。

**Architecture:** 使用一份仓库受控 JSON 作为客户端业务环境的唯一选择源，认证 Main、第一方模型 Gateway 和发布门禁共同消费；About 使用独立、受限、单实例 BrowserWindow；菜单更新入口复用现有 UpdateManager 和更新窗口，通过一个可单测的 Main helper 主动执行 `check(true)`；第一方界面统一使用 `#315dfb`，不修改上游 Harness 设计系统。

**Tech Stack:** Electron 43、electron-vite 5、React 18、TypeScript 5.9、Vitest 4、electron-updater、electron-builder、GitHub Actions。

**Design:** `docs/plans/2026-09-10-desktop-rc2-polish-design.md`

**Execution status (2026-09-10):** Tasks 1–4 and Task 5 automated/build steps are complete. The isolated Apple Silicon DEV package is ready; execution is paused at Task 5 manual acceptance before the RC2 version bump.

## Global Constraints

- RC2 客户端继续使用测试用户中心和测试模型 Gateway；更新 Origin 始终为 `https://updates.insight-aigc.com`。
- 业务环境不能由 Renderer、URL 参数、用户设置或未受信任环境变量覆盖。
- 后续 Stable 发布在业务环境仍为 `test` 时必须失败关闭。
- CI 的 OIDC/STS Gateway 本轮保持测试地址，它不属于客户端运行时配置。
- 仅调整因赛AI第一方页面和控件，不覆盖上游 Harness 设计系统 Token。
- 左下角更新入口仍只在可信更新存在时出现；本次不增加假更新数据、取消检查协议或动态窗口尺寸。
- 本地验收阶段不写 OSS、不修改 `candidate/current.json`、不触发 GitHub Actions、不安装本地 Candidate 覆盖已安装的云端 RC1。
- 每个任务只提交该任务列出的文件；保留仓库中与本计划无关的工作树内容。

## File and Interface Map

| Concern | Primary files | Interface/contract |
| --- | --- | --- |
| Client service environment | `build/client-service-environment.json`, `src/shared/service-environment.ts`, `src/main/auth/auth-environment.ts`, `packages/insight-desktop-integration/src/model-gateway.ts` | `desktopServiceEnvironment(name?)` returns one immutable auth/model pair |
| Release guard | `scripts/verify-release-preflight.mjs`, `.github/workflows/release.yml` | Candidate may use `test`; Stable requires `production` |
| Brand token | `src/renderer/src/styles.css`, `src/renderer/src/update.css`, first-party integration/menu/recovery CSS | `--insight-primary: #315dfb` |
| About window | `src/main/about-window.ts`, `src/renderer/about.html`, `src/renderer/src/AboutApp.tsx`, `src/shared/desktop-menu.ts` | One local single-instance window; `show-about` command |
| Active update check | `src/main/update/open-update-window.ts`, `src/main/index.ts`, `src/renderer/src/UpdateApp.tsx` | Menu command calls `check(true)` and opens current state |
| RC2 identity | `package.json`, `package-lock.json`, `build/update-release-policy.json` | version `1.0.0-rc.2`, release date `2026-09-10` |

---

## Task 1: Centralize Client Service Environment and Add the Stable Guard

**Files:**

- Create: `build/client-service-environment.json`
- Create: `src/shared/service-environment.ts`
- Create: `test/service-environment.test.ts`
- Modify: `src/main/auth/auth-environment.ts`
- Modify: `packages/insight-desktop-integration/src/model-gateway.ts`
- Modify: `test/auth-environment.test.ts`
- Modify: `test/desktop-integration-package.test.ts`
- Modify: `scripts/verify-release-preflight.mjs`
- Modify: `.github/workflows/release.yml`
- Modify: `test/release-preflight.test.ts`
- Modify: `test/release.test.ts`
- Modify: `test/release-workflow-verifier.test.ts`

- [x] **Step 1: Write failing service-environment tests**

Create `test/service-environment.test.ts` with assertions for the exact RC2 contract:

```ts
import { describe, expect, it } from 'vitest'
import {
  desktopServiceEnvironment,
  type DesktopServiceEnvironmentName
} from '../src/shared/service-environment'

describe('desktopServiceEnvironment', () => {
  it('selects the test services for RC2', () => {
    expect(desktopServiceEnvironment()).toEqual({
      name: 'test',
      authOrigin: 'https://gapi-test.insight-aigc.com',
      modelBaseUrl: 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1'
    })
  })

  it.each<[DesktopServiceEnvironmentName, string, string]>([
    ['test', 'https://gapi-test.insight-aigc.com', 'https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1'],
    ['production', 'https://gapi.insight-aigc.com', 'https://gapi.insight-aigc.com/insight-harness-llm-gateway/v1']
  ])('keeps auth and model services in the same %s environment', (name, authOrigin, modelBaseUrl) => {
    expect(desktopServiceEnvironment(name)).toEqual({ name, authOrigin, modelBaseUrl })
  })
})
```

Extend existing auth and integration tests to assert that packaged authentication and the model proxy consume the selected shared configuration rather than separate URL literals.

Run: `npm test -- test/service-environment.test.ts test/auth-environment.test.ts test/desktop-integration-package.test.ts`

Expected: FAIL because the shared configuration does not exist and the two consumers still own separate test URLs.

- [x] **Step 2: Add the repository-controlled service configuration**

Create `build/client-service-environment.json`:

```json
{
  "schemaVersion": 1,
  "releaseEnvironment": "test",
  "environments": {
    "test": {
      "authOrigin": "https://gapi-test.insight-aigc.com",
      "modelBaseUrl": "https://gapi-test.insight-aigc.com/insight-harness-llm-gateway/v1"
    },
    "production": {
      "authOrigin": "https://gapi.insight-aigc.com",
      "modelBaseUrl": "https://gapi.insight-aigc.com/insight-harness-llm-gateway/v1"
    }
  }
}
```

Implement `src/shared/service-environment.ts` as the only runtime reader:

```ts
import configuration from '../../build/client-service-environment.json'

export type DesktopServiceEnvironmentName = 'test' | 'production'

export interface DesktopServiceEnvironment {
  readonly name: DesktopServiceEnvironmentName
  readonly authOrigin: string
  readonly modelBaseUrl: string
}

export function desktopServiceEnvironment(
  name: DesktopServiceEnvironmentName = configuration.releaseEnvironment as DesktopServiceEnvironmentName
): DesktopServiceEnvironment {
  const value = configuration.environments[name]
  if (!value) throw new Error(`Unsupported desktop service environment: ${name}`)
  return Object.freeze({ name, ...value })
}
```

Keep the accepted names closed to `test | production`; validate exact HTTPS origins in tests so malformed repository changes fail before packaging.

- [x] **Step 3: Replace the two runtime URL owners**

In `src/main/auth/auth-environment.ts`, preserve the current development isolation but obtain URLs from the shared configuration:

```ts
const service = desktopServiceEnvironment(app.isPackaged ? undefined : 'test')

return {
  name: service.name,
  baseUrl: service.authOrigin,
  partition: app.isPackaged ? `persist:insight-auth-${service.name}` : `insight-auth-${service.name}`
}
```

Adapt this snippet to the existing return type; do not alter the existing `auth/<environment>.json` path or account-scope hashing.

In `packages/insight-desktop-integration/src/model-gateway.ts`, replace the hard-coded base URL with:

```ts
const MODEL_BASE_URL = desktopServiceEnvironment().modelBaseUrl
```

Do not introduce a second environment variable or package-local copy of the endpoints.

- [x] **Step 4: Write the failing Stable release guard tests**

Extend `test/release-preflight.test.ts` fixture creation and CLI invocation to include:

```text
--service-environment build/client-service-environment.json
```

Add cases proving:

- Candidate + `releaseEnvironment: test` succeeds.
- Stable + `releaseEnvironment: test` fails with a direct production-environment message.
- Stable + `releaseEnvironment: production` succeeds.
- Unknown environment, missing endpoint, HTTP URL, URL credentials, query, fragment, and trailing-path mismatch fail closed.

Run: `npm test -- test/release-preflight.test.ts`

Expected: FAIL because the preflight parser does not accept or validate the new file.

- [x] **Step 5: Implement the preflight guard and workflow wiring**

Add `--service-environment` to the exact argument set and usage string in `scripts/verify-release-preflight.mjs`. Validate the exact JSON keys and both known environment records. Apply the channel rule:

```js
if (channel === 'stable' && value.releaseEnvironment !== 'production') {
  throw new Error('Stable releases require the production desktop service environment.')
}
```

Include `serviceEnvironment` in the preflight JSON output. Pass the new file from `.github/workflows/release.yml`, and extend workflow/source-contract tests so the argument cannot be silently removed.

- [x] **Step 6: Verify and commit Task 1**

Run: `npm test -- test/service-environment.test.ts test/auth-environment.test.ts test/desktop-integration-package.test.ts test/release-preflight.test.ts test/release.test.ts test/release-workflow-verifier.test.ts`

Run: `npm run typecheck`

Expected: all tests and type checks pass; `rg -n "gapi-(test\\.)?insight-aigc\\.com" src packages` reports runtime endpoints only in the shared configuration import path or explicit contract tests, not duplicated production code literals.

Commit:

```bash
git add build/client-service-environment.json src/shared/service-environment.ts src/main/auth/auth-environment.ts packages/insight-desktop-integration/src/model-gateway.ts scripts/verify-release-preflight.mjs .github/workflows/release.yml test/service-environment.test.ts test/auth-environment.test.ts test/desktop-integration-package.test.ts test/release-preflight.test.ts test/release.test.ts test/release-workflow-verifier.test.ts
git commit -m "feat(release): centralize desktop service environment"
```

---

## Task 2: Normalize First-Party Brand Color to `#315dfb`

**Files:**

- Create: `test/brand-theme.test.ts`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/update.css`
- Modify: `packages/insight-desktop-integration/src/client/styles.tsx`
- Modify: `src/preload/windows-menu.ts`
- Modify: `build/plugin-recovery.html`
- Modify: `build/safe-mode.html`

- [x] **Step 1: Write the failing brand-source audit**

Create `test/brand-theme.test.ts` that reads only the first-party files listed above and asserts:

```ts
expect(shellCss).toContain('--insight-primary: #315dfb')
expect(updateCss).toContain('--insight-primary: #315dfb')
expect(firstPartySources.join('\n')).not.toMatch(/#315efb|#6d8cff|#6c63ff|#4d6bfe/i)
```

Also assert the update progress selector, primary login action, Windows menu focus state, recovery action and safe-mode action refer to `#315dfb` directly or through `--insight-primary`.

Run: `npm test -- test/brand-theme.test.ts`

Expected: FAIL and list the current near-blue and purple literals.

- [x] **Step 2: Define and consume the first-party token**

Add the exact token in both renderer style roots:

```css
:root {
  --insight-primary: #315dfb;
  --accent: var(--insight-primary);
}
```

Keep `--insight-primary` unchanged in dark mode. Use derived opacity or a nearby darker value only for hover, focus halo and disabled state. Replace the listed legacy literals in first-party integration and menu styles. Add the same CSS custom property to the recovery and safe-mode documents and route their main action through it.

Do not global-search-and-replace colors in upstream Harness assets or bundled plugin content.

- [x] **Step 3: Verify and commit Task 2**

Run: `npm test -- test/brand-theme.test.ts`

Run: `npm run typecheck`

Expected: exact primary color is present in every first-party surface and forbidden legacy values are absent from the scoped files.

Commit:

```bash
git add src/renderer/src/styles.css src/renderer/src/update.css packages/insight-desktop-integration/src/client/styles.tsx src/preload/windows-menu.ts build/plugin-recovery.html build/safe-mode.html test/brand-theme.test.ts
git commit -m "style(brand): unify first-party primary color"
```

---

## Task 3: Add the Single-Instance About Window

**Files:**

- Create: `src/main/about-window.ts`
- Create: `src/renderer/about.html`
- Create: `src/renderer/src/about-main.tsx`
- Create: `src/renderer/src/AboutApp.tsx`
- Create: `src/renderer/src/about-view-model.ts`
- Create: `src/renderer/src/about.css`
- Create: `test/about-window.test.ts`
- Modify: `electron.vite.config.ts`
- Modify: `package.json`
- Modify: `src/main/index.ts`
- Modify: `src/shared/desktop-menu.ts`
- Modify: `src/preload/windows-menu.ts`
- Modify: `test/windows-titlebar.test.ts`

- [x] **Step 1: Write failing About view-model and window tests**

In `test/about-window.test.ts`, specify the presentation contract:

```ts
expect(createAboutViewModel({ version: '1.0.0-rc.2', releaseDate: '2026-09-10' })).toEqual({
  productName: '因赛AI',
  poweredBy: 'Powered by InClaw & OWL',
  versionText: '版本 1.0.0-rc.2',
  releaseText: '发布于 2026年9月10日',
  copyright: '© 因赛AI'
})
```

Test invalid version/date inputs and assert the controller has one BrowserWindow, focuses the existing instance, uses `380 × 312`, disables resize/maximize, enables sandbox/context isolation/web security, disables Node integration, denies new windows, and rejects non-local About URLs.

Update `test/windows-titlebar.test.ts` to require the `show-about` whitelisted command and Windows menu entry; remove the old assertion that About must not exist.

Run: `npm test -- test/about-window.test.ts test/windows-titlebar.test.ts`

Expected: FAIL because the renderer, command and controller do not exist.

- [x] **Step 2: Implement the pure view model and local renderer**

Implement a strict view-model constructor:

```ts
export function createAboutViewModel(input: { version: string; releaseDate: string }) {
  if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/u.test(input.version)) {
    throw new Error('Invalid desktop version metadata.')
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(input.releaseDate)
  const date = new Date(`${input.releaseDate}T00:00:00Z`)
  if (
    !match ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.releaseDate
  ) {
    throw new Error('Invalid desktop release date metadata.')
  }
  const [, year, month, day] = match
  return {
    productName: '因赛AI',
    poweredBy: 'Powered by InClaw & OWL',
    versionText: `版本 ${input.version}`,
    releaseText: `发布于 ${Number(year)}年${Number(month)}月${Number(day)}日`,
    copyright: '© 因赛AI'
  }
}
```

`about-main.tsx` reads `version` and `releaseDate` from the Main-controlled local query string, builds the view model, and renders `AboutApp`. Import the repository-owned icon through Vite and display it at approximately `58 × 58` CSS pixels:

```ts
import appIconUrl from '../../../build/app-icon.png'
```

The document must contain no remote scripts, links or navigation.

Add `about.html` to `electron.vite.config.ts` renderer inputs. No preload or IPC is needed for this read-only page.

- [x] **Step 3: Implement the secure single-instance controller**

Model `src/main/about-window.ts` on the existing update-window controller while keeping the interface small:

```ts
export interface AboutMetadata {
  readonly version: string
  readonly releaseDate: string
}

export class AboutWindowController {
  async open(metadata: AboutMetadata): Promise<void>
  close(): void
}
```

Use:

```ts
{
  width: 380,
  height: 312,
  resizable: false,
  maximizable: false,
  minimizable: false,
  show: false,
  title: '关于因赛AI',
  webPreferences: {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    partition: 'insight-about'
  }
}
```

Call the existing `secureWebContents`, deny `setWindowOpenHandler`, reject navigation outside the exact local `about.html` URL, and focus rather than recreate an existing window. Pass only `app.getVersion()` and the release-date metadata supplied by Main.

- [x] **Step 4: Wire both menus through one whitelisted command**

Add one version-owned metadata field to `package.json` without changing the current package version yet:

```json
"insightReleaseDate": "2026-09-10"
```

Type the imported package metadata in Main. Add `'show-about'` to `DesktopMenuCommand`; in `executeDesktopMenuCommand`, pass `app.getVersion()` and `insightReleaseDate` to the single controller. Put “关于因赛AI” at the top of the macOS app menu and the Windows product section. Both entries must send the same command; do not add renderer-specific About implementations.

- [x] **Step 5: Verify and commit Task 3**

Run: `npm test -- test/about-window.test.ts test/windows-titlebar.test.ts`

Run: `npm run typecheck`

Run: `npm run build`

Expected: About page is emitted as a renderer entry, all security and single-instance tests pass, and the application build succeeds.

Commit:

```bash
git add package.json src/main/about-window.ts src/main/index.ts src/shared/desktop-menu.ts src/preload/windows-menu.ts src/renderer/about.html src/renderer/src/about-main.tsx src/renderer/src/AboutApp.tsx src/renderer/src/about-view-model.ts src/renderer/src/about.css electron.vite.config.ts test/about-window.test.ts test/windows-titlebar.test.ts
git commit -m "feat(shell): add secure about window"
```

---

## Task 4: Make Menu “Check for Updates” Start a Real Check

**Files:**

- Create: `src/main/update/open-update-window.ts`
- Create: `test/open-update-window.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/UpdateApp.tsx`
- Modify: `src/renderer/src/update.css`
- Modify: `test/update-window.test.ts`
- Modify: `test/update-api-contract.test.ts`

- [x] **Step 1: Write the failing orchestration test**

Create a pure dependency test:

```ts
it('starts a manual check before opening the status window', async () => {
  const calls: string[] = []
  const manager = { check: async (manual: boolean) => { calls.push(`check:${manual}`) } }
  const window = { open: async () => { calls.push('open') } }

  await openUpdateWindowAndCheck(manager, window)

  expect(calls).toEqual(['check:true', 'open'])
})
```

Add error cases proving neither rejection is swallowed. Update existing source contracts to distinguish menu behavior from the sidebar `updates:open` behavior.

Run: `npm test -- test/open-update-window.test.ts test/update-window.test.ts test/update-api-contract.test.ts`

Expected: FAIL because menu commands currently only open the window.

- [x] **Step 2: Implement the smallest Main helper**

Create narrow interfaces and invoke the check synchronously before awaiting the window:

```ts
interface ManualUpdateChecker {
  check(manual: boolean): Promise<void>
}

interface UpdateWindowOpener {
  open(): Promise<void>
}

export async function openUpdateWindowAndCheck(
  manager: ManualUpdateChecker,
  window: UpdateWindowOpener
): Promise<void> {
  const check = manager.check(true)
  await Promise.all([check, window.open()])
}
```

Use this helper for macOS and Windows menu commands. Leave the sidebar IPC handler calling only `updateWindowController.open()` so clicking a real available-update badge does not reset the state.

- [x] **Step 3: Render the checking state as immediate indeterminate progress**

In `UpdateApp.tsx`, render a progress element only for `checking` and preserve the current determinate progress for `downloading`:

```tsx
{model.state === 'checking' ? (
  <progress className="update-progress update-progress--checking" aria-label="正在检查更新" />
) : null}
```

Style its active segment with `var(--insight-primary)`. Do not add a Cancel button or imply that closing the window cancels the request.

Extend `test/update-window.test.ts` to assert the exact checking copy, indeterminate progress markup and absence of a cancel action.

- [x] **Step 4: Verify and commit Task 4**

Run: `npm test -- test/open-update-window.test.ts test/update-window.test.ts test/update-api-contract.test.ts test/update-manager.test.ts`

Run: `npm run typecheck`

Expected: menu-triggered checks call `check(true)` before the window open call, errors reach the caller, checking UI appears immediately, and existing update-state tests remain green.

Commit:

```bash
git add src/main/update/open-update-window.ts src/main/index.ts src/renderer/src/UpdateApp.tsx src/renderer/src/update.css test/open-update-window.test.ts test/update-window.test.ts test/update-api-contract.test.ts
git commit -m "feat(update): start checks from the app menu"
```

---

## Task 5: Run Feature Acceptance on the Current Local Identity

**Files:**

- Modify only files directly responsible for defects found by these checks.

- [x] **Step 1: Run focused regression suites**

Run:

```bash
npm test -- test/service-environment.test.ts test/auth-environment.test.ts test/desktop-integration-package.test.ts test/brand-theme.test.ts test/about-window.test.ts test/windows-titlebar.test.ts test/open-update-window.test.ts test/update-window.test.ts test/update-api-contract.test.ts test/update-manager.test.ts test/release-preflight.test.ts test/release-workflow-verifier.test.ts test/release.test.ts
```

Expected: all new contracts and existing update contracts pass.

- [x] **Step 2: Run repository-level gates**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: full test suite, Node/Web TypeScript checks, desktop integration typecheck and production renderer build pass. If the local Homebrew `python3` shim is broken, run the same commands with `/usr/bin` ahead of Homebrew in `PATH`; do not change repository code to accommodate a machine-only shim issue.

- [x] **Step 3: Build a DEV DMG for visual/manual validation**

Run: `npm run package:dev:mac:arm64`

Expected: DEV DMG/ZIP and `因赛AI Dev.app` are emitted under the configured DEV output directory; the production bundle identifier and installed cloud RC1 remain untouched.

Record the exact output paths with:

```bash
find dist-dev -maxdepth 3 -type f \( -name '*.dmg' -o -name '*.zip' \) -print
find dist-dev -maxdepth 3 -type d -name '因赛AI Dev.app' -print
```

- [ ] **Step 4: Manually verify the DEV application**

Check all of the following and record pass/fail in the 1.0 verification ledger:

- First launch, quit and relaunch do not show a macOS keychain password dialog.
- Login verification-code traffic targets `gapi-test.insight-aigc.com`.
- First-party model requests target the test `/insight-harness-llm-gateway/v1` endpoint.
- Login primary action, focus state, update UI and first-party account UI use `#315dfb` in both light and dark appearances.
- “关于因赛AI” opens once, repeats focus the same window, remains approximately `380 × 312`, and displays the current package version, `2026年9月10日` and approved copy.
- Menu “检查更新…” immediately shows “正在检查更新…” with an indeterminate blue progress indicator; it does not present a second check button or fake update.
- The unsupported/unavailable result in a DEV identity is honest and retryable.
- Sidebar update entry remains absent unless a cryptographically trusted real update is available.

The About version at this stage is expected to match the still-current package version. The purpose of this pass is to prove that the value is dynamic and the UI behavior is correct before claiming the RC2 release identity.

- [ ] **Step 5: Record the local acceptance decision**

Update `docs/superpowers/plans/2026-09-09-desktop-v1-release-verification.md` only with checks that have actually been observed. If any visual or behavioral check fails, fix only that defect, rerun the focused test and rebuild the DEV package. Do not advance the version while a local feature check remains unresolved.

---

## Task 6: Set RC2 Identity, Re-run Gates and Stop Before Publication

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `build/update-release-policy.json`
- Modify: `test/release-preflight.test.ts`
- Modify: `docs/release-runbook.md`
- Modify: `docs/superpowers/plans/2026-09-09-desktop-v1-release-verification.md`

- [ ] **Step 1: Bump the package and Candidate policy atomically**

Run: `npm version 1.0.0-rc.2 --no-git-tag-version`

Expected: `package.json` and `package-lock.json` both report `1.0.0-rc.2`; `insightReleaseDate` remains `2026-09-10`; no Git tag or commit is created.

Set `build/update-release-policy.json` to:

```json
{
  "schema": 1,
  "releaseVersion": "1.0.0-rc.2",
  "channel": "candidate",
  "mode": "optional",
  "minimumSupportedVersion": "1.0.0-rc.1"
}
```

Do not change `build/update-distribution.json`, the update signing public key, runtime lock or OSS pointer.

- [ ] **Step 2: Synchronize the release runbook and verification ledger**

Document the exact RC2 facts:

- RC2 is a Candidate using test auth/model services and production update Origin.
- Local DEV validation cannot prove signed auto-update installation.
- The authoritative upgrade proof is installed cloud RC1 → promoted cloud RC2.
- Production business endpoint cutover is a later atomic client change and can require one login.
- Stable workflow is guarded from publishing test service configuration.

Add dated ledger entries for the completed local checks and unchecked entries for Candidate Draft review, STS stage, promote, RC1 detection/download/install and post-upgrade data/keychain behavior.

- [ ] **Step 3: Verify the final RC2 identity and repository gates**

Run:

```bash
node scripts/verify-release-preflight.mjs --tag v1.0.0-rc.2 --expected-channel candidate --package package.json --policy build/update-release-policy.json --runtime-lock core-runtime.lock.json --service-environment build/client-service-environment.json
```

Expected: JSON output reports version `1.0.0-rc.2`, channel `candidate`, service environment `test`, the locked Runtime tag/commit and all three targets.

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: full tests, type checks and final RC2 renderer build pass. About/release tests prove the exact RC2 version and date metadata.

- [ ] **Step 4: Inspect an unpacked RC2 Candidate without installing it**

Run: `npm run package:candidate:dir`

Expected: `dist-candidate/mac-arm64/因赛AI.app` is built for static inspection only. Verify its package version, Candidate channel, production bundle identity, `updates.insight-aigc.com` update Origin and `test` client service selection. Do not open, install or codesign this local Candidate as the production identity; signed/notarized behavior remains a GitHub Actions responsibility.

- [ ] **Step 5: Commit the RC2 identity after all checks pass**

Commit:

```bash
git add package.json package-lock.json build/update-release-policy.json test/release-preflight.test.ts docs/release-runbook.md docs/superpowers/plans/2026-09-09-desktop-v1-release-verification.md
git commit -m "chore(release): prepare desktop 1.0.0 rc2"
```

- [ ] **Step 6: Stop at the publication gate**

Run: `git status --short --branch`

Run: `git log --oneline origin/main..HEAD`

Expected: only the planned RC2 commits are ahead of `origin/main`; unrelated working-tree files remain unstaged. Present the automated results, DEV app/DMG paths, manual ledger and commit list to the product owner. Do not push, create a tag, dispatch a workflow, upload to OSS or modify `candidate/current.json` without explicit approval.

---

## Task 7: Publish and Prove `RC1 → RC2` Only After Explicit Approval

**Entry condition:** The product owner has accepted the Task 5 manual checks, Task 6 is complete, and GitHub Actions has been explicitly authorized. This task is intentionally not part of the initial implementation run.

**Files:**

- No source edits are expected; record evidence in `docs/superpowers/plans/2026-09-09-desktop-v1-release-verification.md` only after each external result exists.

- [ ] **Step 1: Push the reviewed RC2 commits**

Run: `git push origin main`

Expected: `origin/main` resolves to the reviewed RC2 source commit.

- [ ] **Step 2: Build the complete Candidate Draft**

Dispatch `Release desktop installers` with:

```text
candidate_tag: v1.0.0-rc.2
target: all
```

Expected: macOS arm64/x64 and Windows x64 assets, manifests, YAML, blockmaps, signatures and verification evidence are attached to a GitHub Draft Release; no OSS pointer changes during build.

- [ ] **Step 3: Review the Draft before distribution**

Verify exact filenames, sizes, hashes, signatures, notarization/stapling, Windows installer metadata, version `1.0.0-rc.2`, Candidate channel and source commit. Confirm the release is still Draft before STS stage.

- [ ] **Step 4: Stage immutable RC2 assets through OIDC/STS**

Dispatch `Publish desktop updates` with:

```text
command: stage
tag: v1.0.0-rc.2
confirm_version: empty
```

Expected: complete verified assets appear under the immutable RC2 OSS directory and pass CDN read-back; `candidate/current.json` still points to RC1.

- [ ] **Step 5: Promote RC2 only after stage verification**

Dispatch `Publish desktop updates` with:

```text
command: promote
tag: v1.0.0-rc.2
confirm_version: 1.0.0-rc.2
```

Expected: GitHub Candidate Release is published and `candidate/current.json` is written last with signed RC2 metadata. Save the workflow URL, report artifact, commit SHA, OSS keys and CDN verification evidence.

- [ ] **Step 6: Prove the installed cloud RC1 upgrade path**

From the already installed signed `1.0.0-rc.1` client:

- Choose menu “检查更新…” and confirm checking begins immediately.
- Confirm `1.0.0-rc.2` release notes and download actions are real.
- Download the update; for failure paths verify the same-origin complete installer action remains usable.
- Install and relaunch into signed `1.0.0-rc.2` without visiting the main website.
- Confirm no keychain dialog appears, existing RC1 login/data remain available within the same test environment, About reports RC2, and test auth/model traffic still works.

- [ ] **Step 7: Record the release evidence**

Update the verification ledger with exact URLs, artifact names, hashes, installation result and remaining Stable blockers. Commit documentation only after the recorded evidence exists.

Commit:

```bash
git add docs/superpowers/plans/2026-09-09-desktop-v1-release-verification.md
git commit -m "docs(release): record desktop rc2 acceptance"
git push origin main
```
