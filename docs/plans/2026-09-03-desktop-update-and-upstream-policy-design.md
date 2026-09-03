# Desktop Update and Upstream Policy Design

## Status

This document defines the approved direction for full-client updates, plugin update ownership, release rollback, and the relationship between Insight Desktop and `dataelement/dsh-desktop`. It supersedes the earlier assumption that the Shell should periodically merge the complete DSH Desktop main branch.

The first implementation phase covers full-client update checks, authenticated release metadata, download, installation, release-asset validation, and the upstream intake policy. Historical-version rollback and a community plugin market remain separately planned capabilities.

## Product decision

Insight Desktop is an independently maintained product fork. `dataelement/dsh-desktop` remains a reference upstream whose fixes and designs are periodically audited, but its main branch is no longer merged wholesale into the product branch.

This distinction does not change the Core relationship. Insight Harness Core may continue to ingest DeepSeek Harness upstream changes through its own review and release process. The Shell consumes only a locked Core Runtime artifact and never follows an npm or upstream version implicitly.

```text
DeepSeek Harness upstream
        |
        | reviewed and adapted by the Core repository
        v
Insight Harness Core Runtime Release
        |
        | core-runtime.lock.json + manifest + digest
        v
Insight Desktop Shell Release
        |
        +-- required first-party plugins
        +-- Better Sidebar
        +-- authentication and account isolation
        +-- future canvas product surface
        +-- full-client updater

dataelement/dsh-desktop
        |
        +-- reference implementation and selective fix source
            (no periodic full merge)
```

## Goals

- Update the whole installed client so the Shell, locked Core Runtime, required first-party plugins, default Profile, and recovery surfaces remain one tested release unit.
- Check at startup after a short randomized delay, every six hours while running, after a sufficiently long system resume, and when the user requests a check.
- Let unsigned Windows builds download and install updates without buying a Windows code-signing certificate during the current product stage.
- Preserve macOS Developer ID signing, notarization, stapling, and platform signature validation for production releases.
- Authenticate update metadata and artifacts independently of Windows Authenticode so a compromised download location cannot silently replace an installer.
- Keep update controls available before login and when Core Runtime or plugins fail to start.
- Support both optional releases and authenticated required releases for versions below a declared minimum, so an incompatible required first-party plugin or business protocol can move with the whole client.
- Preserve account data, Harness sessions, user settings, workspaces, assets, and user-imported plugins across an application update.
- Keep the initial update host replaceable so a CDN or regional mirror can be added without redesigning the client.
- Continue learning from DSH Desktop without restoring its product identity, Runtime ownership, marketplace, signing hardware, or deployment services.

## Non-goals for the first implementation phase

- Windows Authenticode or Microsoft Store distribution.
- Automatic Core Runtime download independent of a Shell release.
- Independent update of required first-party plugins.
- A public community plugin marketplace.
- Automatic selection and installation of arbitrary historical versions.
- Data-schema downgrade migrations.
- ModelScope, Feishu, `dshdesktop.com`, or DSH Desktop release infrastructure.
- Linux packages.

## Release unit and version ownership

One desktop version identifies one immutable release unit:

```text
Desktop version
  -> Shell commit
  -> Core Runtime tag, commit, platform and digest
  -> required first-party plugin versions
  -> bundled Profile template version
  -> supported user-data schema range
  -> macOS and Windows release artifacts
```

The Shell release workflow is the only owner of this mapping. Installed clients never replace Core Runtime or a required first-party plugin without replacing the complete application.

The application installation directory is disposable. Mutable product data remains under the stable product `userData` root. Updating the application must not delete or recreate account-scoped Harness homes, sessions, imported plugins, settings, workspaces, or future canvas assets.

## Platform and signing matrix

| Channel | macOS | Windows |
| --- | --- | --- |
| Development | Separate App ID and user-data root; unsigned; production update source disabled | Separate App ID and user-data root; unsigned; production update source disabled |
| Release candidate | Developer ID signed, notarized and stapled; isolated candidate feed | Unsigned NSIS; isolated candidate feed; SmartScreen warning accepted |
| Stable | Developer ID signed, notarized and stapled; authenticated stable feed | Unsigned NSIS; authenticated stable feed; SmartScreen warning accepted |

macOS uses the platform signature check performed by the updater and the authenticated release manifest described below. Windows sets `verifyUpdateCodeSignature: false` while Authenticode is unavailable, but it must not install an artifact until the product-level manifest signature and artifact digest both pass.

Development packages cannot check, download, or install stable updates. Release candidate and stable channels have separate manifests so an RC cannot replace a stable installation and a stable installation cannot discover an RC.

## Update source

The initial source is the public `Boxser567/insight-desktop-shell` GitHub Releases feed. GitHub Actions already builds the platform artifacts and can publish the metadata beside them, so no new hosting service is required.

The update manager consumes an `UpdateSource` interface rather than constructing GitHub URLs in UI or lifecycle code. The interface resolves an authenticated release descriptor for a named channel. A future generic HTTPS, object-storage, CDN, or regional mirror source must implement the same interface and serve the same signed bytes.

The GitHub repository should enable immutable releases when available. The workflow creates a draft release, uploads and verifies every asset, and only then publishes it. Published tags and assets are never overwritten; a correction uses a new version.

## Authenticated release manifest

Every RC and stable release includes:

- `insight-update.json`: canonical UTF-8 JSON release manifest;
- `insight-update.json.sig`: Ed25519 signature over the exact manifest bytes;
- platform updater metadata such as `latest-mac.yml` and `latest.yml`;
- installers, ZIPs and blockmaps required by `electron-updater`;
- a release-asset validation report retained by the workflow.

The manifest records:

```ts
type UpdateChannel = 'candidate' | 'stable'
type UpdatePlatform = 'darwin' | 'win32'
type UpdateArch = 'arm64' | 'x64'

interface SignedReleaseManifest {
  schema: 'insight-desktop-update/v1'
  version: string
  channel: UpdateChannel
  publishedAt: string
  shellCommit: string
  coreRuntime: {
    tag: string
    commit: string
  }
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
  artifacts: Array<{
    platform: UpdatePlatform
    arch: UpdateArch
    kind: 'dmg' | 'zip' | 'nsis' | 'blockmap' | 'updater-metadata'
    name: string
    size: number
    sha512: string
  }>
}
```

The Ed25519 private key exists only as a protected GitHub Actions secret. The application embeds only the public key. A key rotation requires a release that trusts both the current and next public keys before a later release removes the old key.

The client rejects an update before download when the manifest signature, schema, channel, semantic version, update policy, target platform, target architecture, or compatibility declaration is invalid. `minimumSupportedVersion` cannot be newer than the release version. After download it compares the actual artifact size and SHA512 to the signed manifest before installation. The unsigned Windows installer is therefore still authenticated as an Insight release even though Windows displays an unknown-publisher warning.

An optional release may be skipped. A required release applies only when the running version is older than its authenticated `minimumSupportedVersion`; it cannot be skipped and remains visible until installed. The client caches only a successfully verified required manifest. On the next launch that cached policy gates login and Core startup until the update succeeds or the user quits. A network error with no previously verified required policy never invents a mandatory update or locks an otherwise usable installed client.

## Update manager ownership

The updater is a Shell main-process service. It starts independently of authentication and Core Runtime. Renderer code only receives a safe status projection and invokes narrow commands.

The main process owns:

- scheduling and resume checks;
- release-source access;
- manifest signature validation;
- version and channel policy;
- `electron-updater` configuration;
- download and artifact verification;
- application shutdown preparation;
- install and restart;
- persistent skipped-version preference;
- structured updater logs.

The Shell renderer owns:

- a pre-login and recovery-safe update dialog;
- current version, new version, download progress and errors;
- check, download, install, skip and remind-later actions;
- an update badge near the authenticated user entry;
- no filesystem, private-key, token, URL-construction, or installer access.

The native application menu exposes `Check for Updates...` on macOS and the custom Windows menu exposes the equivalent command. Both invoke the same main-process service.

## Update state model

The renderer receives one state union:

```ts
type UpdateStatus =
  | { phase: 'idle'; currentVersion: string; lastCheckedAt?: string }
  | { phase: 'checking'; currentVersion: string; manual: boolean }
  | { phase: 'available'; currentVersion: string; availableVersion: string; required: boolean; manual: boolean }
  | { phase: 'downloading'; currentVersion: string; availableVersion: string; required: boolean; percent: number; manual: boolean }
  | { phase: 'downloaded'; currentVersion: string; availableVersion: string; required: boolean; manual: boolean }
  | { phase: 'installing'; currentVersion: string; availableVersion: string; required: boolean; manual: boolean }
  | { phase: 'up-to-date'; currentVersion: string; manual: true }
  | { phase: 'unsupported'; currentVersion: string; reason: string; manual: boolean }
  | { phase: 'error'; currentVersion: string; message: string; manual: boolean; retryable: boolean }
```

An automatic check may transition to `available`, but transient `checking`, `up-to-date`, and network errors do not interrupt the user. A manual check displays them. A required release opens the update surface, disables skip/remind-later, and prevents a later launch from entering login or Core after its signed policy has been cached. It does not terminate an active operation mid-turn; installation remains an explicit user action. Only one check, download, or install operation may run at once.

The client checks 15-30 seconds after startup, every six hours, and after resume when the previous successful or attempted check is at least six hours old. Network failure keeps the current application usable and is retried on the next scheduled or manual check.

## Installation lifecycle

An update does not stop Core Runtime while it is only checking or downloading. Immediately before installation the update manager asks the workspace lifecycle to:

1. reject new update-install requests;
2. stop accepting new product operations;
3. flush Shell-owned mutable state;
4. detach the Harness view;
5. stop the Core Runtime with the existing graceful timeout;
6. close auxiliary recovery and menu views;
7. invoke `quitAndInstall`.

If preparation fails, the client remains on the current version, returns to an error state, and does not run the installer. The manager never deletes user data to recover from an update failure.

## Rollback policy

Rollback is a separate second-phase capability. The first updater records compatibility fields now so later rollback does not require changing the release format.

The future rollback catalog may expose only releases whose signed manifest remains available. Before installing an older release, the client compares the target read range with the currently written data schema:

- compatible target: allow downgrade;
- target requires a reversible metadata migration: snapshot the affected databases and configuration, then downgrade;
- incompatible target: block in-place downgrade and offer an isolated data root if product requirements justify it.

Large media assets are not duplicated merely to roll back application code. Metadata, databases, configuration, Profile patches, and asset references are the recoverable set.

## Plugin ownership

| Class | Installation scope | Update owner | Removal policy |
| --- | --- | --- | --- |
| Required first-party | Bundled with the application and installed into the managed Profile | Whole-client release | Cannot be independently removed or updated |
| Optional official | Device-level installation with declared Shell/Core compatibility | Future curated official catalog | User removable |
| User/community | Device-level installation shared by accounts | User or future community manager | User removable |

Better Sidebar, account integration, the future canvas bridge, and baseline document/media preview plugins are required first-party capabilities when the product depends on them. PDF or spreadsheet preview is a plugin capability; dshmarket is only a plugin discovery, installation, update, backup, and diagnostic system.

The current product keeps local plugin import. dshmarket is not bundled as a required component in this phase. Its backup, compatibility, operation tracking, rollback and diagnostic designs may be selectively adapted later. A public community market, if added, is a separate reviewed feature and does not gain authority over required first-party plugins.

## DSH Desktop upstream intake policy

The `upstream-dsh-desktop` remote remains configured. A periodic audit fetches the remote and classifies upstream changes into:

- Electron or operating-system lifecycle fixes;
- updater and release-pipeline fixes;
- plugin recovery or Profile safety fixes;
- Harness compatibility changes relevant to the locked Core interface;
- DSH-specific product, market, brand, analytics, mobile or deployment features.

Only the first four classes are candidates for selective adoption. Adoption occurs as a focused local change with:

- the reviewed upstream commit range;
- the specific files or behavior adopted;
- the local product differences;
- focused tests;
- the appropriate build-runbook validation stage;
- a commit message or design note retaining provenance.

The product branch must not merge upstream `package.json`, lockfile, release workflow, vendored Harness packages, dshmarket tree, product assets, App ID, Profile, or update host as a unit.

## Failure handling

- Missing or invalid signature: report an unauthenticated release and refuse download.
- Missing artifact or mismatched digest: delete only the updater cache entry and refuse installation.
- GitHub unavailable or rate limited: retain the current version and retry later; manual checks show a bounded error.
- Download interrupted: keep the current version; allow a later retry through updater cache semantics.
- Core Runtime cannot stop: cancel installation and keep the current process alive when possible.
- Required update download unavailable: keep retry and quit available; do not start login/Core from a later launch while a cached authenticated minimum-version policy still excludes the installed version.
- Installer fails after application exit: the existing installation and user data remain recoverable through platform installer behavior; the next launch records the running version and previous update attempt.
- Release asset validation fails in CI: do not publish or mutate the Release.

## Verification strategy

Validation follows the existing low-cost-to-high-cost curve:

1. Pure unit tests for signature validation, optional/required policy, channel policy, target selection, state transitions, scheduling and skipped versions.
2. IPC and preload contract tests proving untrusted renderers cannot access installer paths or update internals.
3. Release-script fixture tests for manifests, signatures, digests, merged macOS metadata and required assets.
4. Development UI validation using fixture manifests and fake executor events; no production source and no real installation.
5. Packaged unsigned DEV smoke proving the development channel cannot see stable updates.
6. Candidate feed with a signed/notarized macOS N to N+1 update, including installation and data retention.
7. Candidate feed with unsigned Windows N to N+1 update, including manifest verification, installer execution, SmartScreen expectation and data retention.
8. Stable Release publication only after both candidate paths and the existing login, account isolation, Better Sidebar and packaged Runtime checks pass.

## Documentation consequences

After this design is accepted, current documentation that says DSH Desktop is periodically merged must be changed to the reference-upstream policy. The build Runbook must replace “upstream merge” with “upstream intake audit” as the normal path while retaining an exceptional isolated integration-branch procedure for a deliberately requested full merge.

New updater or packaging failures that change future gates belong in the client build Runbook. One-off failure timelines belong in `docs/incidents/`.
