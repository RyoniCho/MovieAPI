# Weekly application logging

Application stdout/stderr is captured before the database and routes load. Output is appended to `logs/app-YYYY-MM-DD.log`, where the date is the Monday starting that week in Asia/Seoul. Timestamps also use Korea time. New writes select their week automatically, without restarting the service. Restarting during a week appends to the same file. INFO and ERROR denote stdout and stderr respectively.

`run_service.bat` no longer redirects all output to `app_server.log` or appends `service_launch.log`. The existing WinSW wrapper configuration is unchanged and captures early startup/native errors and fallback output if the application log directory is unwritable. Old logs are not renamed, truncated, or deleted. There is deliberately no retention cleanup or size limit; weekly files can still be large during heavy transcoding. Log writes are synchronous so failures and shutdown output are not lost to a pending buffer. Very high log volume can therefore affect request latency.

URL query strings and bearer tokens are redacted before application log output. This is defense in depth, not a guarantee that arbitrary application messages contain no private data; do not intentionally log credentials or personal data.

## Activation

These local edits do not alter the running Node process. After reviewing and authorizing deployment, restart `MovieApiService` once during an idle window. No nginx change is needed for logging. Verify a new weekly log appears and the API responds normally. A scheduled restart each week is NOT needed. Preserve `app_server.log` and backups until a separate retention policy is chosen.

## Verification

Run `node --test tests/weeklyLogger.test.js` and `node --check utils/weeklyLogger.js`. Tests use isolated OS-temporary directories, not production logs or the database. Coverage includes KST Monday/year boundaries, restart append, old-file preservation, Unicode/multiline output, redaction, write failure, stream restore, split UTF-8, and no duplicate stdout output. A live service restart has not been tested as part of local implementation.