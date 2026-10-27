# Bounded library acceptance for shared-db #4427

Owner: the coordinator of shared-db #4427. This narrow owning-app runner reuses
the isolated-context/password-form pattern of `orderlist-integration-proof.mjs`;
it does not execute that unrelated OrderList acceptance suite. Consolidate this
runner into a common login helper only through a future reviewed app change;
retire it when #4427's durable repeatable acceptance supersedes it.

This source is preparation, not production proof or permission to execute.
Before execution, obtain exact source/action/resource approval and the native
production/UI gates. Bind the actual deployed frontend SHA independently.
The coordinator's public unauthenticated `/login` and JavaScript-build capture
identified `a273bff8b14395d13191186a6cb83c98b7829dc1`, entry
`/assets/index-CO-xW9cW.js`, SHA256
`2bdf4452e1e4cc8c8e69462dc230160eaf4d98ef5ab8dd340af652bde21647a7`.
`vite.config.ts` embeds APP_COMMIT/APP_DATE (or Git fallback) and AppHeader
renders those constants; this is not a claim that current main is deployed.
Root must re-prove the public asset/hash and unique short-header-to-full-commit
mapping immediately before execution; a changed asset or build requires fresh
binding. The candidate checks that already-proven commit's header after login.
Use the existing dedicated `ai-admin@designflow.app` password identity only.
Supply username/password through protected 1Password secret-reference environment
injection; never arguments, model context, logs, screenshots or files. Bind the
actual existing secret item references in the action review before execution.

The runtime pin is Playwright **1.56.1**, already declared by the app's
`orderlist-integration-live-proof.yml`. The runner refuses other versions.
Search existing runtimes first. If unavailable, separately review an isolated
application dependency/browser installation; never update the reviewer toolkit
or a global dependency. The candidate installation is `npm install --prefix`
an owned private temporary runtime directory, with `--no-save
--package-lock=false --ignore-scripts playwright@1.56.1`, followed by that
package's own CLI `install chromium` with `PLAYWRIGHT_BROWSERS_PATH` set to an
owned private directory. Installation and execution have not occurred.

The runner launches an ephemeral headless Chromium context, blocks service
workers, submits the ordinary password form at `https://dam.designflow.app`,
checks the deployed build stamp, requires a successful authenticated bounded
nonempty `style_groups` read and a matching visible SKU, and verifies a fresh
read after page reload. Licensed metadata/thumbnails may load in that isolated
local UI and bounded in-process response inspection; none is exported.

Every mutating request is denied except ONE exact password token exchange,
ONE normal UI logout, and the four existing read-only library facet RPCs.
Other business REST/RPC mutations, signup/recovery/refresh, third-party POSTs,
and Microsoft/Authentik navigation are blocked. Any denied request prevents a
passing receipt. There are no writes to assets, roles, workflows or settings.
GET/HEAD/OPTIONS are limited to the exact DAM origin (excluding auth callbacks),
the fixed Supabase public REST/storage and user endpoint, and the documented
`popdam.nyc3.digitaloceanspaces.com/thumbnails/` origin/path. Unknown hosts,
unexpected ports, URL credentials and other API paths refuse; only a bounded
sanitized hostname list and count are retained. Authorization headers are never
read or extracted. Genuine normal form login, authenticated app landing, and
nonempty rendered/reloaded library together provide this scoped session proof.

Cleanup clicks the normal user-menu Sign out control and checks its successful
endpoint response and return to the login page, then closes context/browser.
IMPORTANT: existing app `useAuth` calls the SDK's default **global** signout,
which can revoke other sessions for this dedicated QA identity. Exact action
review must explicitly accept this boundary or refuse execution; do not silently
substitute token manipulation or an unreviewed logout scope. Cleanup is attempted
even after partial successful authentication. A cleanup failure fails the proof.

Required environment: `POPDAM_ACCEPTANCE_BASE_URL`, `SUPABASE_PROJECT_ID`,
`POPDAM_TEST_USER`, `POPDAM_TEST_PASSWORD`, `DEPLOYED_FRONTEND_SHA`, absolute
`POPDAM_PLAYWRIGHT_PACKAGE`, and absolute `POPDAM_PROOF_FILE` in a real private
0700 directory. The receipt is exclusively created 0600, synced and closed.
It contains booleans, fixed target/build provenance and blocked count only.
Require actual CLI exit 0 plus matching stdout, private file identity/mode/hash,
and all cleanup flags; the file alone is not acceptance if writing/syncing fails.

This read-only runner cannot prove #4427's separate genuine business write,
readback and restoration requirement, or resolve linter/performance warnings.
Those remain on the same original issue under the coordinator's custody.
