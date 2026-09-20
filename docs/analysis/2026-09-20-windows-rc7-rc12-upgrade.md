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
