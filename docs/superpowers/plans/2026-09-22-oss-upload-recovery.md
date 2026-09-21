# OSS Upload Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Neither is available in this session; execute inline with explicit test checkpoints.

**Goal:** Upload verified RC17 assets reliably without bypassing STS or immutability.
**Architecture:** Extend the scoped OSS adapter with multipart release uploads; the publisher verifies existing remote bytes before resuming or promoting.
**Tech Stack:** Node ESM, installed ali-oss 6.23.0, Vitest.

## Global Constraints

- No Core/client rebuild or STS service changes; no credential logging.
- Preserve GitHub OIDC/main-only policy and signed manifest verification.
- Never overwrite conflicting assets; never promote until staging succeeds.

### Task 1: Upload adapter

Files: scripts/github-oss-client.mjs; test/github-oss-client.test.ts.
- [ ] Add tests for multipart selection, checkpoint retry, bounded failure, immutable headers, fresh STS callback, and non-retryable AccessDenied.
- [ ] Run `npm test -- test/github-oss-client.test.ts` and observe failures.
- [ ] Add `uploadReleaseObject(key, source, headers)`; use stat size, 8 MiB threshold, 4 MiB parts, parallel 1, 120000ms timeout. Save checkpoint only in memory. Retry timeout/reset/5xx at most twice with bounded delay; refresh expired token once. Keep putObject for mutable pointers.
- [ ] Run adapter tests and syntax checks; commit with Task 2 after integration verification.

### Task 2: Verified partial staging

Files: scripts/publish-update-to-oss.mjs; test/publish-update-to-oss.test.ts.
- [ ] Add fixtures for partial prefix, wrong-size/unexpected object, same-size wrong hash and complete reuse; assert no upload after failed verification.
- [ ] Export `uploadImmutableRelease(options, releaseDir, files, oss)` for tests. Add streamed SHA-512 verification via temporary files and getObject; verify all existing objects before uploading any missing ones.
- [ ] Reuse remote verification in promote before GitHub publication/pointer mutation. Log only object name, size and transfer progress.
- [ ] Run focused tests, typecheck and publisher contract checks. Review diff, commit and merge publisher-only change to main for authorized OIDC workflow.
- [ ] Run stage; only after success run promote. If authentication/permission failure appears, stop and report the safe error and request ID for service owners.
