# Service home and watch history (local changes, not deployed)

## Features
- Existing category home remains the default. The user can select Service view; only the view preference is persisted.
- Authenticated service-home API returns continue watching, recent additions, recently watched and watch again. Each history row is grouped to the most recently watched episode per title.
- Default category excludes AdultVideo before limits; explicit categories are filtered on the server and client. Existing image blur preference is retained.
- Position saves include duration when available. 95% progress or the ended event marks completion. Starting again and saving an earlier position clears completion.
- Legacy history without duration remains resumable; completion is not guessed. Watch again will populate as new completion data is recorded.
- Movie addedAt is captured for new records. Existing records use ObjectId creation time for ordering without a bulk rewrite. This means initial library registration, not new episodes added to an existing title.

## Verification
Run `node --test tests/watch-history.test.js tests/watch-history-routes.test.js tests/weeklyLogger.test.js`.
Route tests use stub models and a temporary loopback port. They do not write to MongoDB.
The package's pre-existing npm test placeholder is unchanged.

## Deployment (not performed)
1. Review only the intended files in each repository. Preserve pre-existing local changes, especially Config.js and AddAdminAccount.js. Commit/push only when authorized; git push itself does not deploy these checkouts.
2. At a safe idle time, restart MovieApiService once to load new API/model/logger code. No bulk DB migration is required. New fields are populated on subsequent playback/new movie registration.
3. After API deployment, build the frontend into a staging directory and publish the verified build to nginx's existing static root. Preserve/backup the previous build for rollback. Ordinary static asset updates do not require nginx restart; no nginx configuration is changed here.
4. Smoke-test login/logout, both home modes, each category and blur, series episode resume/replay, pause/end persistence, and native Safari/AirPlay. Automated tests are not a substitute for actual device playback validation.

Existing production services, database records, logs and static build were not modified by testing. Weekly logs retain all prior files; disk retention is intentionally not automated.
