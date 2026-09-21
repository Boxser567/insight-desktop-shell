# OSS release upload recovery

Approved scope: repair the publisher, not RC17 binaries or the STS service.
Two attempts obtained STS and listed OSS, then timed out uploading the first
ARM64 DMG after 30 minutes. This does not prove STS service failure or the exact
network cause. Waiting alone and repeating the identical PUT are not preferred.

Use SDK multipart upload for release files of at least 8 MiB, 4 MiB parts,
sequential transfer, 2-minute request timeout, at most two transient retries
using an in-memory checkpoint. Obtain fresh STS credentials on SDK refresh;
never retry permanent permission errors or expose credentials/checkpoints.
Small pointer writes retain their existing behavior.

Resume a partial release only after checking all existing names and sizes and
downloading existing objects to verify SHA-512 against the signed GitHub assets.
Upload only missing objects with forbid-overwrite. Recheck remote contents before
promotion. Unexpected files, different contents, and unavailable authentication
remain blockers. No deletion or overwrite of published objects.

Checkpoints are not persisted across workflow runs; incomplete multipart tasks
may require the bucket's lifecycle cleanup. Complete objects can be reused after
verification. No broader OSS permissions are requested automatically.
