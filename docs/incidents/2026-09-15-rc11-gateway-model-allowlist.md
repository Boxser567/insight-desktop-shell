# rc11 conversation failure: enterprise model allowlist

## Confirmed cause

The installed rc11 Runtime matches Core commit 42ddfb640a97d551e458613d11ddb73936d15e11. A failed persisted conversation recorded HTTP 403 / AUTH after switching to deepseek-flash.

Using the same locally stored login credential against the configured test Gateway:

- deepseek-flash: HTTP 403, response detail.code MODEL_NOT_ALLOWED, message states only deepseek-v4-flash-vision-exp is allowed.
- deepseek-v4-flash-vision-exp: HTTP 200, valid completion.

This proves a client/server model allowlist mismatch, not an expired login. The adapter currently classifies any HTTP 403 as AUTH and does not preserve the FastAPI detail error shape, making the UI misleading. The rc11 release gate failed to validate the newly selected model against the deployed enterprise service.

## Local compatibility fix

The Insight adapter maps its three supported logical IDs to the deployed enterprise wire alias only when sending a request, through both prepared and direct stream paths. Model listing, session model identity and official capability metadata remain deepseek-flash. No output budget, compression threshold, login or auth retry policy changes.

This is temporary compatibility with the confirmed service contract. The backend must add deepseek-flash to its allowlist and routing, after which this mapping should be removed following a real service check. Backend source/deployment access was requested and is not available locally. Production endpoint behavior has not been tested.

## Verification

- Reproduced failure with the current login token without printing or saving plaintext credentials.
- Regression failed before the fix against the deployed wire-ID contract.
- 10 Gateway runtime tests passed, covering real credential IPC, authentication failures, aliases, parameters, images, cancellation and same-session continuation/overflow.
- Desktop integration TypeScript check passed.
- Compiled the modified adapter and used it from a local Electron diagnostic process with the existing login credential. Two real streaming requests included the official default max_tokens=256000; both returned HTTP 200 and finish=stop. Turn 1 answered OK; turn 2, given the prior exchange, answered that it had replied OK.
- No user conversation files modified. No installed signed application patched. No release or OSS pointer change performed.

## Remaining acceptance

The local adapter validation does not constitute full installed-client UI acceptance, sustained long-output capacity validation or backend deployment. Before the next release, verify a real authenticated conversation from the packaged client and preserve structured MODEL_NOT_ALLOWED errors separately from login failures.
