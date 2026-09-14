# Windows update diagnostics for rc11

## Scope

Add persistent stage logs without changing uninstall, retry, process termination or user-data removal policy. The previous PML contained only profiling samples; it did not identify a root cause. Windows upgrade reliability is still pending real-device validation.

## Evidence retained

The installer and new uninstaller append UTF-16LE logs under `%TEMP%\insight-desktop-update-logs\update-<PID>.log`, outside the installation tree. Each entry includes the package version, monotonic tick count and incoming NSIS error flag. Files are separate per process; startup entries and modification times distinguish attempts. No model requests, API keys or general process command lines are recorded.

Stages: installer start, registered-install process cleanup results, old-uninstaller launch/return, in-place launch fallback, retry prompt, non-atomic fallback attempts, final failure, installation completion. The new uninstaller records removal start and the first failed atomic relocation path before restoring files.

The logging macro preserves its scratch registers and the NSIS error flag. Logging is best effort: an unwritable log directory must not alter the installation outcome. A nonzero old-uninstaller exit code is not interpreted as a specific Win32 error.

## Old-version boundary

rc11 can log calls into rc8/rc10 uninstallers, but cannot add internal file-operation logging to those already-built executables. Detailed atomic-relocation logging inside the uninstaller becomes available when upgrading away from an installed rc11. These logs narrow the stage and preserve outcomes; they do not guarantee that every external lock can be identified without a system trace.

## If an upgrade fails

1. Preserve `%TEMP%\insight-desktop-update-logs` before clearing temporary files. Zip that folder and attach it, together with the displayed source and target versions.
2. Run `scripts/diagnose-windows-update.ps1` from this repository, or the copy installed at `resources\diagnostics\diagnose-windows-update.ps1`. It produces a desktop JSON containing registry/install metadata, a scoped process snapshot and up to 20 recent installer logs (500 lines each). The script remains usable without starting the client. If a partial uninstall removed the bundled script, use the repository copy.
3. Do not delete installation files or registry entries before collecting evidence. No cleanup script is automatically run by this change.

## Release gate

- Focused release contract tests and NSIS compilation of the installer/uninstaller diagnostic hooks.
- Full Windows installer build in the normal release workflow.
- Real Windows rc8/rc10 → rc11 upgrade: either successful completion or persistent logs showing every attempted uninstall and its result.
- Verify that installation data outside the install directory and account/session data remain intact.
- Once rc11 is installed, test the next-version upgrade to validate logging inside its uninstaller.

The client version/tag is managed separately by the release operator; this change does not publish an installer or move OSS update pointers.

## Local validation

- Release contract suite: 24 tests passed.
- electron-builder bundled NSIS 3.0.4.1 compiled a fixture expanding both installer cleanup/recovery hooks and uninstaller logging hooks. Fixture-only unused UI warnings; no compilation errors. This is not a Windows execution test or a full release package build.
- The original PowerShell collector ran on the affected Windows PC; the new log-collection extension still needs real-device validation.
