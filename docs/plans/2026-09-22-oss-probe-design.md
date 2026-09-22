# OSS upload probe

Approved scope: compare SDK file, SDK Buffer and independent HTTP on the same
GitHub runner. Reuse publish-update.yml OIDC; do not change release assets or pointers.
Use desktop/diagnostics/<run>-<attempt>-<uuid>/ with forbid-overwrite.
Test 64 KiB and 4 MiB PUTs and 8 MiB SDK multipart (file/Buffer).
Each request has a 60-second timeout, no automatic retries. Failures are collected
without printing credentials, signed URLs or raw HTTP error messages.
Report timings, HTTP status/request ID, source bytes read when observable and
HTTP request completion (not proof of remote receipt). Keep tiny diagnostic objects;
do not request delete permissions. Remote diagnosis requires running on main.

Alternatives: repeating release upload gives little evidence; local-only probes
cannot test the GitHub-to-OSS route. Use the approved same-runner comparison.
