# OSS Acceleration Implementation Plan

**Goal:** remove temporary probe and stage RC17 with 1 MiB parts via acceleration.
**Architecture:** fixed transport change in the existing authenticated client.
**Tech Stack:** Node, ali-oss, Vitest, GitHub Actions.

Inline execution requested by user; superpowers execution skills unavailable.

- [ ] Update test/github-oss-client.test.ts assertions to `partSize: 1024 * 1024`
  and `endpoint: 'https://oss-accelerate.aliyuncs.com'`; run focused tests to prove failure.
- [ ] Update scripts/github-oss-client.mjs accordingly; remove diagnoseUploads.
- [ ] Remove scripts/diagnose-oss-upload.mjs, test/diagnose-oss-upload.test.ts and
  docs/oss-upload-probe.md; remove diagnose from .github/workflows/publish-update.yml.
- [ ] Require fixed acceleration endpoint in scripts/verify-publish-workflow.mjs.
- [ ] Run focused tests, typecheck, workflow contract and git diff --check.
- [ ] Commit, fast-forward main, push and dispatch stage v1.0.0-rc.17 all only.

No installer changes, production pointer changes or remote object deletion.
