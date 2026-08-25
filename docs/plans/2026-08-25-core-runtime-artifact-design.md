# Core Runtime Artifact Design

## Decision

Insight Desktop Shell consumes an immutable Runtime artifact released by `Boxser567/insight-harness-core`. It does not declare `@deepseek-ai/dsh` or its DSH companion packages as Shell dependencies after migration.

`@deepseek-ai/dsh` remains the Core repository's CLI package name and Runtime entry point. Its version is an implementation detail of the Core artifact, not a Shell upgrade signal.

## Artifact

Each Core Release Candidate and release publishes one artifact per target:

```text
insight-harness-runtime-<core-version>-<target>.tar.gz
insight-harness-runtime-<core-version>-<target>.sha256
insight-harness-runtime-<core-version>-<target>.json
```

Supported targets are `darwin-arm64`, `darwin-x64`, and `win32-x64`.

The archive root is `runtime/` and contains the pinned Node executable, pnpm, the assembled DSH dependency closure, and `runtime.json`. The archive excludes profiles, user data, credentials, sessions, and mutable pnpm stores.

`runtime.json` is schema version 1 and contains:

```json
{
  "schemaVersion": 1,
  "core": {
    "repository": "Boxser567/insight-harness-core",
    "version": "0.1.1-rc.2",
    "commit": "<40-character Git SHA>"
  },
  "entry": "node_modules/@deepseek-ai/dsh/lib/bin.js",
  "node": { "version": "24.x.y" },
  "pnpm": { "version": "11.x.y" },
  "target": { "platform": "darwin", "arch": "arm64" }
}
```

The sidecar SHA-256 is calculated over the compressed archive. The archive does not contain its own SHA-256, avoiding a self-referential checksum.

## Release and adoption flow

```text
Core commit → target-specific artifact build → SHA-256 → GitHub Release
                                         ↓
Shell core-runtime.lock.json → download → SHA-256 verification → unpack
                                         ↓
                         packaged Resources/runtime + desktop manifest
```

The Shell lock records the immutable Core Release URL, Core commit, target-specific SHA-256, and expected `runtime.json` identity. Its values change only through a reviewed Shell commit. A download mismatch or a mismatch between lock and `runtime.json` fails the build before Electron Builder runs.

## Boundaries

- Core owns Runtime assembly, runtime metadata, artifact checksums, and GitHub Release publication.
- Shell owns the selected artifact lock, download verification, embedding, startup paths, profile initialization, and the desktop Runtime Manifest projection.
- Shell never runs `npm install` against the registry to assemble DSH at application build time.
- Better Sidebar remains a Shell-owned built-in profile, but uses the selected Runtime's Node, pnpm, and DSH entry.
- A Shell release never changes Core merely because an npm package updates.

## Rollout

1. Produce a Core RC for macOS ARM64 and prove it can run the Shell's existing startup and Better Sidebar profile preparation.
2. Add macOS Intel and Windows x64 artifacts and CI verification.
3. Switch Shell to one explicitly locked RC on all supported targets.
4. Publish a production Core release only after target-specific Shell package checks pass.

## Non-goals

- Automatic Core download or update by installed clients.
- Registry fallback when a lock cannot be fetched or validated.
- Replacing the Shell's user Profile, sessions, or plugin policy.
- Core source vendoring in the Shell repository.
