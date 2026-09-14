# Core 0.1.5-rc.2 delivery acceptance

## Scope and identity

- Shell: `codex/core-upgrade-delivery-20260914`, based on `3c61043`; candidate `1.0.0-rc.10`.
- Core: `5c7450d116d59f972b5df64efa3942220d363809`, integrating upstream `dsh-v0.1.5-rc.2` while retaining Insight additions. Original Core checkout remains untouched.
- Runtime dependency prerelease: https://github.com/Boxser567/insight-harness-core/releases/tag/insight-runtime-v0.1.5-rc.2
- Native build: https://github.com/Boxser567/insight-harness-core/actions/runs/34814936667 — all three targets succeeded.
- This is a candidate upgrade, not a declaration that every upstream feature has been merged or production installed-update acceptance has finished.

## Completed

| Check | Evidence |
|---|---|
| Frozen Profile | Sidebar 0.19.1, Market 1.46.1, generation 5; two clean installs resolved identical 177 package manifests; lock SHA-256 `5604758bb1487ae17aebce998909d12fcc41b5918b9a775df73d496acdafc3f4` |
| Core peers | No installed `@deepseek-ai` package manifests in the Profile; peers resolve from selected Runtime |
| Profile migration | Generation 4 retains user plugins, removed optional community plugins and custom patch; managed Sidebar/Market remain installation-owned |
| Shell regression | 108 files / 689 tests passed before candidate identity bump; identity-related follow-up tests and release preflight passed after lock/version update |
| Types/build | Shell types, integration types/build, Electron build and native-runtime `build:prepared` passed |
| Real Renderer | Actual Shell Main/preloads + Core with fixture authentication: one sidebar, account footer, settings, model catalog defaults to `yinsai-gateway` |
| Market protection | Actual update/uninstall HTTP routes reject Sidebar, Market and first-party integration (6 checks), with the expected managed-package reason |
| Workspace/editor/terminal | Temporary workspace created via Core RPC and opened through UI; Markdown edited through CodeMirror and verified on disk; terminal command created a verified file |
| Account lifecycle | Logout destroys old view; second login uses a different Electron session and no first-account identity remains |
| Safe Mode | Fresh isolated home starts without normal Profile; settings, Gateway catalog and account switch passed |
| Native Runtime | macOS arm64/x64 and Windows x64 archives, sidecar hashes, embedded runtime metadata and entry presence verified; exact same Core commit |
| Core gates | Official build, host/client types, required-peer/workflow tests, documentation typecheck, Cordis catalog and Markdown gates passed; Core pre-push hook passed |

### Runtime checksums

- darwin-arm64: `fd98062b7bdab9982607e287d79b94a4be45e96e41d8361a330d1bc59eeeb0b1`
- darwin-x64: `f46b297661286b1def8468eed6a28ad7cc551fedffb0a892f6c61ee043df9cba`
- win32-x64: `287676920316102c92633fc0b7e109ee10afe365ae5ec13a18755f5de1170a02`

## Bugs found during actual client acceptance

1. Fresh Safe Mode attempted to load Gateway from a normal Profile that did not yet exist. It now copies the installation-owned integration into its isolated Profile and resolves peers through that Profile.
2. Vendored prompt-enhance 0.1.9 read the removed composer `imageIds` field. The pinned client now reads Core's `attachmentIds`. Build-time validation fails if its expected anchor changes; startup reapplies the patch after dependency repair, only for 0.1.9, preserving removal and user upgrades.
3. Core native release workflow lacked a validation-only artifact mode. `publish=false` now builds native archives as CI artifacts without publishing. Existing publishing defaults remain unchanged.

## Reproduce desktop acceptance

After preparing the locked Runtime, integration, Profile and Electron build:

```sh
INSIGHT_SMOKE_ROOT="$PWD" INSIGHT_SMOKE_OUTPUT=/tmp/insight-desktop-smoke-unique INSIGHT_SMOKE_WORKSPACE=1 node_modules/.bin/electron test/fixtures/candidate-desktop-smoke.cjs
INSIGHT_SMOKE_ROOT="$PWD" INSIGHT_SMOKE_OUTPUT=/tmp/insight-safe-mode-smoke-unique node_modules/.bin/electron test/fixtures/candidate-desktop-smoke.cjs --safe-mode
```

Use a fresh output directory for every run. The fixture uses temporary user data and fake authentication responses; it never authenticates a production user. It tests real Shell, Renderer, IPC, Core and plugin routes. A `passed` file is written only after assertions succeed, including renderer error checks.

Local evidence: `/private/tmp/insight-delivery-editor-patched-20260914`, `/private/tmp/insight-delivery-safe-mode-final-20260914`, `/private/tmp/insight-delivery-shell-tests-final.log`.

## Remaining release gates

- Signed/notarized native installer results and packaged Runtime smoke.
- Installed rc.9 → rc.10 download/verification/restart and rollback on available native systems. Updater unit tests passed; they are not installed acceptance.
- Real test-account login and a model request with actual service credentials; fixture authentication does not establish service availability.
- Copied real legacy user-session corpus migration; prior Core migration fixtures cover v0→v1→v2→v3, but no production user data was copied or modified here.
- Windows and macOS Intel interactive acceptance require those native environments; native Runtime CI is not an interactive acceptance result.
- Candidate update pointer and stable promotion remain unchanged until the above gates are satisfied. No installation gray-rollout service is fabricated.
