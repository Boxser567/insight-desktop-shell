# Session history compatibility implementation plan

> Execute inline in the current task; the user has authorized implementation and subsequent repair-release preparation.

**Goal:** Restore access to the known failed V3 conversations without changing committed source files or admitting unresolved tools into V4.

**Architecture:** The adjacent V3→V4 stage repairs only a closed step followed immediately by the recorded scheduler-unavailable error. Started calls receive an explicit missing-result error; advertisements with no recorded start receive the existing canonical not-started error. The V4 relationship validator remains unchanged. Desktop recovery inspection stays read-only; client controls propagate session-open failure.

**Constraints:** Preserve source generations and user uninstall choices. Do not commit private session content. Reuse installed/local Core outputs for validation; do not download Core release artifacts. Keep existing unrelated README/document changes out of commits. Native package failures cancel the whole build before repair/retry.

## Task 1: Bounded migration repair

Files: `packages/session/session-format-v3-to-v4/src/migration.ts`, new `failed-tool-step.ts` and `tests/failed-tool-step.spec.ts` in the Core repository; owning bilingual README.

- [ ] Reproduce two advertised calls, one registered call, no results, then `step/end` and an immediately following `turn/end` with `UNKNOWN` / `Cannot read properties of undefined (reading 'prepare')`.
- [ ] Track pending advertised calls in the migration stage and hold only the affected step boundary for one-event lookahead. Insert error results before that boundary, remap later references, and preserve timestamps and source event payloads.
- [ ] Prove ordinary completion, generic errors, absent/mismatched failure evidence, malformed call relationships and native V4 still refuse unresolved tools. Prove repaired output reopens unchanged and derives complete model tool responses.
- [ ] Replay all five local V3 artifacts on copies using the new migration; require original hashes unchanged, five readable histories and validated V4 successors.

## Task 2: Recovery visibility and failure state

Files: Desktop main-process recovery inspection/menu and focused tests; Core `ui-model-selection` service/component tests; Desktop expert picker and tests.

- [ ] Provide a bounded read-only inspection/export path for historical artifacts that still refuse migration. Read with historical decoding, never adopt them as a writable Session and never execute logged tools.
- [ ] Surface session-open failure in model controls rather than indefinite loading, and explain skill catalog unavailability in the picker.
- [ ] Verify failure → successful retry clears the failure state; normal model/skill selection remains intact.

## Task 3: Integration and repair-release preparation

- [ ] Run focused migration/persistence/client regressions, changed type checks, built-runtime recovery and source-preservation checks; select repository checks with `dsh-pre-push-checks`.
- [ ] Commit only repair files, create/attach PRs and wait for required CI before merge.
- [ ] Pin the repaired Core commit in a new Runtime release and prepare a new desktop version. Do not overwrite 1.0.4/1.0.5 assets or tags. Publish only after the compatibility acceptance above passes.
