# Windows rc7 → rc12 failed upgrade

## Evidence and limits

The 2026-09-20 report identifies rc7 installed and rc12 running from updater/pending.
The two installer log snapshots are each 418 bytes: the first retains
`legacy-retry-prompt attempt=6 result=2`, the second `upgrade-failed ... result=0`.
The post-exit installation contains only two Mistral SDK files (esm JS and src TS),
both with measured absolute path length 260. The main executable and uninstaller
are absent. The process snapshot did not identify a live application process;
it cannot exclude external locks or earlier transient processes.

Traditional Win32 MAX_PATH includes the NUL terminator. These lengths strongly
implicate path handling but do not independently prove the precise old NSIS
operation that failed. The overwritten logs cannot be recovered by updating code.
The submitted collector is SchemaVersion 1; its manifest parse error is an
encoding artifact, not evidence of a corrupt package.

## Local changes

- Seek to EOF before writing each installer log entry. NSIS FileOpen `a` preserves
  contents but starts at position zero.
- Remove the non-atomic regular-uninstall fallback. Previously, cancelling the
  retry prompt could trigger additional destructive uninstall attempts; a zero
  exit with leftover files then stopped installation after removing the old app.
  Failed old-uninstaller results now stop without another uninstall invocation.
  This prevents this additional destructive step; it cannot guarantee an old
  uninstaller itself restores all files after a failure.
- Add `scripts/probe-windows-long-path.ps1`. It creates empty temporary fixtures
  at lengths 259/260/261 and compares MoveFileW/DeleteFileW with ordinary,
  extended, and available 8.3 paths. It touches no installation or registry.
  Results describe the PowerShell host/API behavior, not old NSIS behavior.

## Validation / remaining work

- Local release contract tests: 24 passed. These are static regression checks,
  not an installer execution test.
- User executed the PowerShell fixture on the affected Windows machine at
  2026-09-20 11:30:35. For both JS and TS, ordinary paths succeeded at 259
  characters and failed at 260/261 with Win32 error 3 on both move and delete.
  Extended paths and 8.3 aliases succeeded in all cases; the report has no errors.
  This reproduces the API boundary, not the actual NSIS uninstall operation.
- NSIS compilation and exact old/new installer end-to-end tests remain pending.
- Do not publish this as a complete long-path upgrade repair. The new code does
  not recover the already partially removed rc7 installation.
- Next: collect the fixture report, verify the same boundary in the actual NSIS
  uninstaller, then implement and validate path-safe handling before selecting
  any packaging path-length gate. Do not simply ignore remaining files, drop
  required SDK runtime modules, or require users to change registry policy.
- Keep the original two residual files until evidence collection is complete.
  Recovery installation and update-pointer promotion are separate operations.

References:
- https://nsis.sourceforge.io/Reference/FileOpen
- https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation

## NSIS reproduction (2026-09-20)

The Windows Runner executed the installed electron-builder recursive atomic
relocation and restoration functions, with only function names and the staging
variable renamed for a disposable test executable. Source paths of 259/260/261
characters failed when the corresponding staging destinations were 270/271/272
characters. Prefixing BOTH roots with `\\?\` allowed relocation and restoration.
An open-file case deliberately failed relocation; original content and a separate
marker were present after restoration. This is a function-level test, not a
successful rc7 upgrade. See Actions run 35488853715. A subsequent assertion also
checks the marker was actually staged before restoration.

The user confirmed rc13 cancellation preserves a working rc7 and existing
conversations. The log includes `nonAtomicFallback=disabled`.

## Proposed legacy compatibility boundary

Only fixing a newly generated uninstaller will not repair the rc7 uninstaller
already on disk. Passing a short `_?=` directory is insufficient: the existing
multi-user initialization reads the installation directory from the registry.

Proposed next implementation: embed a corrected compatibility uninstaller in the
new installer and use it for the verified same-product legacy installation. Keep
atomic relocation, restore on failure, current-user/all-users scope, and account
data retention. Do not overwrite the old uninstaller on disk before success,
temporarily rewrite registry paths, or reintroduce regular-uninstall fallback.

This changes which executable performs legacy cleanup, so validate it separately:
matching installation identity/path; long source AND staging destination; file
locks with a partial move followed by restore; cleanup success; cancellation;
then the complete rc7 installation and the real user machine. No new installer
containing this proposed takeover has been implemented or published yet.
