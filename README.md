# 因赛AI Desktop

因赛AI Desktop is a cross-platform Electron host for the pinned Insight Harness Core Runtime.

## Runtime policy

The application does not install or upgrade `@deepseek-ai/dsh` from the npm registry at runtime. `core-runtime.lock.json` pins an independently released Core Runtime, and packaged builds embed that artifact together with the default Better Sidebar profile.

Profiles, plugins, workspaces, and Harness sessions are stored outside the application installation directory. The product application data directory is stable across upgrades.

## Local development

```bash
npm install
npm run dev
```

Development prepares the locked Core Runtime, its manifest, and the bundled profile before starting Electron.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

## Packaging

```bash
npm run package:mac:arm64
npm run package:mac:x64
npm run package:win
```

Each target must be built on its matching operating system and architecture. The GitHub Actions release workflow builds the Windows installer on `windows-2022`.

## Upstream synchronization

This repository periodically merges `dataelement/dsh-desktop`. Preserve the independent Core Runtime and bundled profile when resolving conflicts; do not restore registry-owned DSH dependencies or patch files that the locked Core artifact no longer consumes.
