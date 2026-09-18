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

For the Skill picker feature, use a locally assembled Core containing the selected-skill input API until its release is pinned:

```bash
# In the Core repository, using Node 24 with development headers:
pnpm run runtime:assemble --target darwin-arm64 --output /absolute/path/to/local-runtime
# In this Shell repository:
npm run dev:local -- /absolute/path/to/local-runtime
```

Select the current host target (`darwin-arm64`, `darwin-x64`, or `win32-x64`). `dev:local` validates and copies that Runtime into the ignored development cache, checks and builds the integration, refreshes the bundled profile, and starts Electron. The manifest labels it as local development. It does not change `core-runtime.lock.json`; normal builds still download and verify the locked release. Development uses the separate `insight-desktop-dev` data directory and requires its own login. Stop with Ctrl+C.

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

## Reference upstream

This repository treats `dataelement/dsh-desktop` as a reference upstream. Changes are reviewed by upstream commit range and accepted through selective adoption; whole-repository merges are not the normal upgrade path. Every adoption must preserve the independently locked Core Runtime, bundled profile, product identity, account isolation, and first-party integrations. See [Upstream intake](docs/upstream-intake.md) for the review record.
