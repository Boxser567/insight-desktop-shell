# Approved OSS upload change

User requested removal of the temporary diagnostic demo, 1 MiB multipart parts,
and a direct RC17 upload attempt after enabling Guangzhou bucket acceleration.
Use https://oss-accelerate.aliyuncs.com as the fixed SDK transport endpoint while
retaining Guangzhou V4 signing and validation of the server-issued STS bucket,
region and regional endpoint. No arbitrary endpoint or public-endpoint fallback.
Remove diagnostic script, test and workflow command; retain history and remote
diagnostic objects. Keep signature/hash/immutable-prefix protections, retries and
timeouts. Only stage RC17 after tests; do not promote or rebuild installers.

Compared with more probes or deploying a mainland runner, this is the user's
selected smallest direct attempt. Acceleration does not guarantee success or
eliminate cross-border traffic; live stage success is the acceptance gate.
