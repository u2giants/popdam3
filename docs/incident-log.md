---
summary: Critical incident write-ups, newest first; read the matching entry before changing behavior an incident touched.
kind: living
status: current
read-when: debugging a familiar symptom before re-investigating
---

# Critical incidents

Moved verbatim from `AGENTS.md` on 2026-09-18 to keep the router under its size cap. Add new entries here, then add a one-line title to the index in `AGENTS.md` → Critical incidents.

## 2026-11-10: OrderList showed a replaced assortment on PO 62012008

What happened: a buyer reported PO 62012008 (Ross, ColdLion SO 7128129) listed assortment AAH6208 next to the correct BRG6205, and asked why AAH6208 was linked.

Root cause: ColdLion itself changed the order. Its 2026-10-23 sync showed SO 7128129 line 1 as AAH6208 (high-gloss canvas); its 2026-10-26 sync showed the same line as BRG6205 (framed). The intake created lines for both versions. On 2026-11-02 the AAH6208 lines were correctly voided ("Superseded ColdLion source component"), so the data was right. But the OrderList grid still listed voided lines, only faded with a strike-through style, among live ones. The buyer read them as a live wrong link. The PO number and SKUs were never matched incorrectly.

Fix: the OrderList now hides voided lines everywhere — rows, row counts, status counts and Find (`orderListFilters` in `src/hooks/useOrderList.ts`). Find runs server-side, so shared-db [#6022](https://github.com/popcre/shared-db/issues/6022) / [PR #6023](https://github.com/popcre/shared-db/pull/6023) added `line_voided_at`/`order_voided_at` to its filter allowlist; it must reach production before this app change, or Find refuses the filter.

Rule: anything the system retires must leave the working list, not just be styled differently. Voided-order rows (a person's decision, with Restore) still show struck through; only voided lines are hidden.

## Resolved 2026-11-09: Nightly style-group rebuild monitor failed — worker silently stopped recording terminal outcomes

The "Monitor Nightly Style Group Rebuild" workflow failed from 2026-11-05 with "No terminal worker outcome was recorded in the last 27 hours" (runs 42075115379, 42256119738, 42388031692). The rebuild itself never stopped: `admin_config.BULK_OPERATIONS` showed `rebuild-style-groups` completing nightly, but `bulk_operation_runs` — the append-only worker-outcome table the monitor reads — had no terminal row after the 2026-11-04 1:00 AM EST run.

Root cause: PR #713's user-Stop guard made `persistOpState`'s `onlyIfRunning` applied-check compare the RPC-echoed status to a hardcoded `"running"`. A terminal save persists `completed`/`failed`, so an applied terminal write read back as refused and `recordStyleGroupTerminalOutcome` was silently skipped — success and failure rows (and the failure alert webhook) alike. The first nightly run after #713 merged (2026-11-04 5:12 PM EST) was the first missing row.

Fix: PR #866 (7b933a21, merged 2026-11-08 8:57 AM EST) compares the returned status to the status being persisted; a concurrent user Stop leaves a different status and still reads as refused, so the #469/#821 protection is unchanged (worker suite 535/535). Deployed to Railway the same morning; the live `WORKER_HEARTBEAT` sha matched 7b933a21.

Rule: an applied-check must compare the RPC echo to what this write persisted, never to a fixed expected value; and a green cron/enqueue never proves the worker succeeded — only its own terminal row in `bulk_operation_runs` does. That table exists precisely because cron measures the enqueue, not the rebuild (shared-db #2439).

Live proof: the first post-fix rebuild (run_id 4a19ee71, 2026-11-09 1:29–1:53 AM EST) landed its terminal row with `succeeded=true` — verified read-only, as were the 2026-11-10 and 2026-11-11 rows. The monitor passed its 2026-11-09 dispatch run 42651677874 and every scheduled run since (42688021173, 42862124924, 43066757847). Issue #863 closed 2026-11-09 11:09 AM EST via PR #880, which also retired its handoff. The 2026-11-05–07 outcome gap is unbackfillable (those run_ids were overwritten by later runs) and accepted on the issue.

## Resolved 2026-11-01: DAM picture search times out under cold database load

The exact query `spiderman coir` intermittently fails in `dam-search-ai`, causing the app to fall back to broader word matching. The earlier planning-cost repair (shared-db #5075) is live; this is a separate execution-I/O regression as style-group picture coverage grows.

Authenticated production reproduction: the semantic anchor hit its 5-second statement limit and ranked search hit its 30-second limit. A direct exact style-group vector scan also exceeded 15 seconds, with active queries waiting on database disk reads. At reproduction the mixed search-document table occupied about 1.2 GB and held 9,641 non-null style-group vectors.

Shared-db [PR #5397](https://github.com/popcre/shared-db/pull/5397), tracked on [#4508](https://github.com/popcre/shared-db/issues/4508), adds a compact private vector projection maintained by a transactional trigger. Exact group scans use the same vectors and distance formula; word matching, asset ANN, visibility, ranks, counts, thresholds and time limits stay unchanged. Insert, vector replacement, key change, invalidation and deletion update the projection in the same transaction. Vectors remain inline so the scan is sequential rather than fetching scattered heap/TOAST values.

Review-finding [shared-db #5401](https://github.com/popcre/shared-db/issues/5401) identified replica-mode writers bypassing an ORIGIN-only trigger. Forward [PR #5422](https://github.com/popcre/shared-db/pull/5422) keeps this same trigger enabled in both modes and reconciles missing, changed and orphan vectors under its writer-conflicting lock. Disposable PostgreSQL reproduced the old drift, repaired it, and passed normal/replica lifecycle and complete-parity checks. The already-rehearsed original migration remains byte-identical.

Local PostgreSQL17/pgvector checks cover migration with existing vectors, projection parity and lifecycle/privilege contracts. A 9,641-vector synthetic test returned identical top-2,000 candidates (zero symmetric difference); the compact exact scan took 12.235 ms. Those local numbers are not production acceptance.

The live page also exposed a separate count mismatch: its header/footer preferred a one-row variant probe reporting 10 while the main search returned all 15 mat groups. [PopDAM PR #649](https://github.com/u2giants/popdam3/pull/649) uses the loaded page total consistently and avoids that redundant probe during text search. Nine focused regressions, typecheck, lint and full [CI 41380870029](https://github.com/u2giants/popdam3/actions/runs/41380870029) passed. Frontend [publish 41381204217](https://github.com/u2giants/popdam3/actions/runs/41381204217) succeeded for merge `0f0b9979217dc575a0641e68f2ca2e4f9cc312e5`; Coolify deployment `nuytec594njiltbjhrqc7r1x` finished.

- [x] live proof: both migrations automatically promoted ([original](https://github.com/popcre/shared-db/actions/runs/41378855953), [replica synchronization](https://github.com/popcre/shared-db/actions/runs/41379360000)). The first fresh authenticated browser after database deployment returned all 15 correct `spiderman coir` mat groups in 7.042 seconds (edge 6.145 seconds); five sequential/concurrent calls took 2.447–6.988 seconds, all returning the same 15 IDs. After frontend deployment, a fresh authenticated browser visibly confirmed build `0f0b997`, all 15 mat cards, header 15 and paginator 1–15 of 15 in 5.658 seconds (main edge 4.590 seconds), with no fallback during 35 seconds of observation. Five additional sequential/concurrent calls took 2.600–6.257 seconds; all returned the same 15 IDs and exact total. These are fresh browser first calls, not a flushed database-cache test. Licensed screenshots and rows stay local. Separate missing-artwork/ERP recall remains on #616.

## Resolved 2026-10-29: Master Data first load slow, then a false "could not be loaded"

What happened: the first Master Data load (Licensed tab) took a long time and often ended in "Master Data could not be loaded."; waiting triggered an automatic reload that succeeded. Users navigated away believing it failed.

Root causes: (1) `style_tracker_rows_with_bridge` joined `api.plm_item_list` per row; the item list exposes its id through a window function, so the planner rescanned all ~19.9k item rows per tracker row — ~19.9M join-filter comparisons per 1,000-row page (measured 3.7–6.8 s warm; cold runs over the shared 8 s statement cap → HTTP 500/57014). (2) The app retried once, then dead-ended in the error state even though the next (warm) attempt always succeeded.

Fix: shared-db popcre/shared-db#5045 (issue #5037, migration `20261029162652`) rewrote that join as an indexed lateral over base tables (value-preserving: full-view comparison on production returned 0 differences) — the 1,000-row first wave executes in ~0.13 s in-database and the page's signed-in first-wave requests measured 1.06 s / 0.55 s live. popdam3 PR #581 made the `style-rows` query retry up to 3 times with capped backoff so a cold timeout keeps showing "Loading…" and recovers by itself.

Rule: library-scale queries must stay far under the 8 s `authenticated` cap cold; measure with `EXPLAIN (ANALYZE)` as production sees it (see the 2026-10-27 OrderList entry) and fix the plan, not the timeout.

## Resolved 2026-10-27: OrderList first load "canceling statement due to statement timeout"

What happened: opening OrderList failed with "Could not load OrderList: canceling statement due to statement timeout" (SQLSTATE 57014, 8s `authenticated` limit); a few hard refreshes made it load. The failing request was the first 500-row block sorted by `sales_order_received_date`.

Root causes: (1) `plm.production_order_line_source_ref` had never been analyzed after ColdLion rows arrived, so the planner estimated 1 ColdLion row (actual 1,131) and chose a nested loop doing ~28.9M join checks (6.5s warm). (2) Even with a good plan, the block query built every grid column for all ~25k lines before taking the top 500 (~1.9s warm, over 8s cold).

Fix: manual `ANALYZE` on the table (3:44 PM EDT); shared-db PR #4969 (issue #4930) set `autovacuum_analyze_scale_factor=0.02`, `autovacuum_analyze_threshold=50` on it, verified in production `pg_class.reloptions`. popdam3 PR #560 made `fetchOrderListBlock` rank line IDs first (~0.65s), then fetch those rows by primary key in 100-ID chunks (~30ms each). Albert confirmed a clean first load on 2026-10-27.

Rule: when an OrderList request times out, read the failing URL in edge logs, then `EXPLAIN ANALYZE` it as `authenticated` with a real `sub`; compare estimated vs actual rows before changing code.

## Resolved 2026-10-27: OrderList assortment Case Pack blank or 0 (ColdLion orders)

What happened: Yuchen reported assortment designs on OrderList with an empty Case Pack (PO 62011865) or 0 (PO 62011483). About 600 live ColdLion assortment member lines were affected.

Root cause: the ColdLion order import filled each assortment member's Case Pack from the item master (`coldlion.item_detail.carton_qty`) looked up by that design's own SKU. The order's own carton total (`prepackQty` on the parent line) was ignored. Design-level item records are unreliable for this. Some have `carton_qty` 0, which became 0 (e.g. CAC62MVDP01, CRM62MVSP01). Others have two conflicting records or none, so the lookup abstained and left it blank (e.g. CAC62DCJK01, HSD68DYLS04). A first fix (2026-10-26) also used the wrong meaning, "pieces of that design per carton"; it was stopped before merge.

Fix: shared-db PR #4859 (migration `20261027185328`, issue #4858). For every assortment member, Case Pack is now the parent line's ColdLion `prepackQty`, the whole carton's piece count (owner ruling 2026-10-27, relaying Yuchen). Tracking counts cartons once per physical parent. 601 live lines were corrected and read back. Fully cancelled lines keep their saved history. Missing or conflicting totals stay blank and are never guessed. The signed-in live proof passed: popdam3 run 40619858294.

Rule added to prevent recurrence: for assortment members, never take Case Pack from per-design item-master data. Use the order's parent carton total. If an assortment design shows blank or 0 again, compare the line with `coldlion.intake_order_line.prepack_qty` and `line_cancelled_qty` first. A remaining blank on a fully cancelled line (e.g. SO 7128132, 7128133) is expected.

## Resolved 2026-10-27: one production Supabase sb_secret key printed into an AI transcript

What happened: during the Master Data first-paint session (PR #541 live proof), the full value of the new-format Supabase API secret (`SUPABASE_SECRET_KEY`, sb_secret class) was printed into the ZCode chat transcript while inspecting the 1Password item "Supabase Runtime Keys - shared POP database (production)". Per standing rules the key is treated as compromised.

Impact: the key is the deployed edge-function gate key (proven by probe) and a possible Railway worker env value. Probe-verified facts, the two-stage rotation plan, and the blocking Railway-access gap are recorded in `plan_credential_rotation_20261027.md` (issue #551). Stage A (replace the edge secret with a fresh sb_secret, no revocation, worker DB path untouched) awaits AI-reviewer APPROVE; Stage B (revoke) is blocked until Railway env values can be confirmed or updated — both stored Railway API tokens are rejected.

**Resolution 2026-10-27 (owner ruling):** Albert ruled that an exposure confined to this machine's session transcript needs redaction, not rotation ("if the keys were not published outside of this computer then no need to rotate, just redact them from where they appeared"). All transcript occurrences were redacted in place and verified gone the same day; a useless 6-character fragment on a merged branch's history is the only trace outside the machine. The rotation plan (`plan_credential_rotation_20261027.md`) is cancelled and retained as reference; the ruling is recorded in `ai-devops docs/owner-rulings.md`.

Also discovered in the same session: all three AI tester account passwords are stale (`invalid_credentials`); repair is tracked separately.

## Resolved 2026-07-01: Microsoft login returned "500: Database error granting user" on first attempt

What happened: Users signing into `dam.designflow.app` with Microsoft/Azure hit `500: Database error granting user` on the first OAuth callback. Retrying often worked, which made it look like a transient OAuth issue.

Impact: New/returning SSO users could not reliably enter PopDAM on the first attempt. No asset data impact.

Root cause 1 (fixed 2026-06-30, commit `4073f2c`): the shared CRM auth migration in `/worksp/shared-db` (`20260621162220_crm_auth_provision`) used the generic `on_auth_user_created` trigger name on `auth.users`, replacing PopDAM's original `public.handle_new_user()` trigger. Azure users were created in `auth.users` and shared `app.profile`, but did not get PopDAM `public.profiles`, `public.user_roles`, or `public.app_access('popdam')`. Fix: migration `20260630173500_restore_popdam_auth_trigger.sql` adds a PopDAM-specific `on_auth_user_created_popdam` trigger and backfills missing managed-SSO access rows.

Root cause 2 (actual remaining first-login failure, fixed 2026-07-01, commit `ab265bb`): Supabase Auth logs still showed `Database error granting user`; the matching Postgres log showed `duplicate key value violates unique constraint "refresh_tokens_pkey"`. `auth.refresh_tokens_id_seq` was behind the imported rows (`last_value = 281`, `max(id) = 3518`), so token creation could collide. Fix: reset the live sequence and commit migration `20260701114000_repair_auth_refresh_token_sequence.sql`.

Rule added to prevent recurrence: Never use the generic `on_auth_user_created` trigger name for PopDAM-owned provisioning; keep `on_auth_user_created_popdam`. When Supabase Auth reports `Database error granting user`, inspect both `auth_logs` and `postgres_logs` around the same timestamp/request ID; the browser error is only a wrapper. After Supabase imports/restores/cutovers, verify Auth-owned sequences such as `auth.refresh_tokens_id_seq` are not behind their table max.

---

## Resolved 2026-06-25: PopDAM Helper (Windows) uninstall failed with "NSIS Error: Error launching installer" — CI cached the NSIS toolchain

What happened: A pilot user could not uninstall the Windows Helper — it failed **100% of the time** with `NSIS Error — Error launching installer`, both via Settings → Apps → Uninstall and by running the uninstaller directly; quitting the tray app first did not help. Install worked; only uninstall was broken.

Impact: No data impact. The broken uninstaller was on every Windows build produced after the bad cache entry was created; the corrected installer overwrites in place and writes a fresh, working uninstaller (no manual deletion needed to recover).

Root cause: An electron-builder NSIS uninstaller copies itself to `%TEMP%` and relaunches that copy to delete its own folder; "Error launching installer" means that relaunch failed. The Windows CI job cached **`~\AppData\Local\electron-builder\Cache`** — the NSIS *toolchain* (uninstaller stub + plugins + winCodeSign) that stamps the (un)installer — keyed only on `package-lock.json`. A corrupted toolchain entry therefore persisted across every build and shipped the same broken uninstaller. (The other possible cause of this error — Windows blocking the *unsigned* temp copy via SmartScreen/Smart App Control/AV — was **not** the cause here; that one is only fixable by code signing, which is permanently abandoned.)

Recovery / fix (commit `d7a1133`): Stop caching the electron-builder toolchain dir; cache **only** the immutable Electron binary (`~\AppData\Local\electron\Cache`) and re-download the integrity-checked NSIS toolchain fresh each run. Cache key prefix changed `electron-win-` → `electron-bin-win-` so the old suspect cache is never restored. Verified: rebuilt Helper uninstalls cleanly. Same push also shipped the Helper v1.4.2 Microsoft-OAuth `bad_oauth_state` fix.

Rule to prevent recurrence: **Never cache a build toolchain dir** (`~\AppData\Local\electron-builder\Cache` / `~/Library/Caches/electron-builder` / `~/.cache/electron-builder`) in CI — only cache immutable dependency downloads. Full writeup: `docs/KNOWN_QUIRKS.md` #54.

---

## Resolved 2026-06-22: coolify-proxy lost its Docker socket again → nas-mcp 502 (now self-healing)

What happened: While rotating the MCP bearer tokens, redeploying the `nas-mcp` Coolify **Application** created a new container that returned `502` publicly — even though the container was healthy and `coolify-proxy` could reach it directly (`wget` inside the proxy → `405`). Traefik's logs showed sustained `Cannot connect to the Docker daemon at unix:///var/run/docker.sock` (docker provider down). `devops-mcp` survived because it's a **Service** routed via Traefik's **file** provider; `nas-mcp` is an **Application** routed via the **docker** provider, which was blind.

Impact: `nas-mcp.designflow.app` was 502 for ~15 min; other domains stayed up. (No data impact.)

Root cause: Same class as 2026-06-18 — after a Docker daemon event, `coolify-proxy`'s bind-mounted `/var/run/docker.sock` goes stale (old inode), so Traefik's docker provider can't see container events and keeps routing to the old (gone) container. The host socket is fine; only the proxy's view is stale.

Recovery: `docker restart coolify-proxy` (re-establishes the socket mount; Traefik re-reads all labels). All sites recovered within seconds.

Rule added to prevent recurrence: **Root cause = `unattended-upgrades` auto-upgrading `docker-ce`/`containerd`** (confirmed in `dpkg.log`: both incidents coincide with docker upgrades — 06-18 and 06-21). The daemon restart recreates `/var/run/docker.sock` (new inode), stranding coolify-proxy's read-only file mount. Compounded by **`live-restore: true`**, which keeps coolify-proxy running across the daemon restart so it holds a stale socket mount. **Primary fix (applied + verified 2026-06-22):** `coolify-proxy-reconnect.service` — a systemd unit `BindsTo`/`WantedBy=docker.service` that restarts only coolify-proxy after the daemon (re)starts, restoring routing in ~30s automatically. Docker stays **unheld** (auto-updates freely); apps stay up via live-restore, only the proxy blips. (`deploy/vps/restart-coolify-proxy-after-docker.sh`.) **Backstop:** a self-healing watchdog (`deploy/vps/coolify-proxy-socket-watchdog.sh`, systemd timer every 3 min, restarts the proxy only on *sustained* socket failure, rate-limited 1/15 min, logs to `/var/log/coolify-proxy-watchdog.log`) covers the rare manual-upgrade/crash case. Both documented in `deploy/vps/README.md`. Symptom to recognize: a **new/changed** container 502s while existing sites stay up → `docker logs coolify-proxy | grep "Cannot connect to the Docker daemon"`; auto-fixes in ~30s (reconnect unit) or ~3 min (watchdog), or `docker restart coolify-proxy`. **Full writeup: `deploy/vps/coolify-proxy-socket-fix.md`.**

---

## Resolved 2026-06-21: Bridge "Build mismatch" false alarm — self-update froze `build_sha` (and a wrong-project investigation detour)

What happened: After the bridge self-updated, the admin panel showed a red **"Build mismatch — reports v1.16.3 but running sha:8340ef9, not published sha:a35414d."** The bridge was in fact running the correct published image (verified: the running container's image OCI label `org.opencontainers.image.revision` matched `:stable`), but it self-reported a stale `build_sha`/`image_tag`. Separately, the first hour of investigation was misdirected because the default `mcp__supabase__*` tooling points at the **decommissioned Ohio project `ryltkzzernhwnojzouyb` ("popdam-prod.old")**, whose `agent_registrations` froze at the cutover — looking real but 16h stale. The live data is in **Virginia `qsllyeztdwjgirsysgai`**.

Impact: Cosmetic but alarming — the badge implied a failed/stale deploy fleet-wide while the agents were healthy and current. No functional outage. Risk was a wasted "fix" (`docker rm -f && compose up`) or chasing a dead database.

Root cause: `recreateViaDockerRun` (`apps/bridge-agent/src/index.ts`) clones the previous container's entire `.Config.Env` as explicit `-e` flags (to preserve `SUPABASE_URL`/`AGENT_KEY` on installs with no compose file). Explicit `-e` beats the new image's baked `ENV`, so `POPDAM_BUILD_SHA`/`POPDAM_IMAGE_TAG` were **frozen at the first-ever image's values** and re-inherited on every update. The drift detector reads `build_sha`, so it false-alarmed on every successful update. (This is the same mechanism behind the 2026-06-09 incident's contradictory identity, finally root-caused.)

Recovery: Bake build identity into an immutable `/app/build-info.json` at build time (Dockerfile) and read it via `readBuildInfo()` (file-first, env-fallback). A file can't be overridden by env-cloning, so the reported sha always matches the running image. Shipped as bridge **v1.16.4** (commit `fa26b14`); the fragile `recreateViaDockerRun` was left untouched. Self-heals on the next update — verified live: bridge reports `version 1.16.4 / build_sha fa26b14 / image_tag v1.16.4`, matching `BRIDGE_LATEST_BUILD`.

Rule added to prevent recurrence: Build/version identity for agents must come from an **immutable image file**, never from env vars that the self-updater clones forward. When diagnosing agent state, confirm you are querying the **live Virginia project** (`qsllyeztdwjgirsysgai`), not Ohio `.old` — the default Supabase MCP still points at the old one. To verify an image's true build at any time: `docker inspect <img> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`.

---

## Resolved 2026-06-18: Frontend CI was green enough to mislead, but production stayed old

What happened: PopSG frontend code was pushed to `main`, but the live site stayed on the old June 10 frontend image. The GitHub repository page showed a green `popdam / production` deployment, but that badge was Railway worker status, not frontend status. The frontend `Publish Frontend Image` workflow was failing at GHCR with `permission_denied: write_package`, so no new `ghcr.io/u2giants/popdam-frontend:latest` image reached Coolify. After GHCR publishing was fixed, Coolify accepted the deploy API call but failed to pull the private image because the VPS Docker credential file no longer had a valid GHCR login. After restoring the VPS GHCR login, Coolify deployed the new container, but both domains briefly returned 502 because `coolify-proxy` had a stale bind-mounted Docker socket and Traefik could not see the new Docker service until the proxy container was restarted.

Impact: `sg.designflow.app` and `dam.designflow.app` served stale frontend assets until the full chain was fixed. During the final rollout, both domains briefly returned 502 even though the app container itself was healthy.

Root cause: Three separate assumptions were wrong: (1) a green GitHub deployment badge was treated as frontend proof even though it was Railway; (2) successful GitHub Actions/Coolify API trigger was treated as deployment proof before checking Coolify's actual deployment record; (3) Traefik's Docker provider was assumed healthy despite a stale `/var/run/docker.sock` mount inside `coolify-proxy`.

Recovery: Added a valid package-write `GHCR_PAT` repo secret and updated `publish-frontend.yml` to use it for GHCR login when present; confirmed GHCR tags `latest`, `sha-5482fb7`, and `5482fb7`; restored the VPS GHCR Docker login used by Coolify's helper; reran the frontend workflow; confirmed Coolify deployment `bmkalsjd7d8feykdvacqkdld` finished; restarted `coolify-proxy` to refresh its Docker socket; verified both production domains returned HTTP 200 with `Last-Modified: Thu, 18 Jun 2026 22:35:55 GMT` and the running container labels included `org.opencontainers.image.revision=5482fb734c7a969406c4f00a21a454f58bb1f890`.

Rule added to prevent recurrence: For frontend deploys, success requires all four checks: (1) `Publish Frontend Image` is green; (2) GHCR has a fresh `latest` tag and `sha-<short-sha>` tag; (3) Coolify deployment status is `finished`, not merely "queued" by the API; (4) both `https://dam.designflow.app/library` and `https://sg.designflow.app/library` return HTTP 200 with a fresh `Last-Modified`/asset hash. If the public domains return 502 while the app container is healthy, check `docker logs coolify-proxy` for Docker provider errors and verify `/var/run/docker.sock` inside `coolify-proxy` matches the live host socket; restart only `coolify-proxy` if the socket mount is stale.

---

## Resolved 2026-06-10: Bridge agent crash loop (PDF_BACKFILL + missing `ok: true`)

What happened: `claim-pdf-backfill-batch` in `agent-api` returned JSON without `ok: true` in both return paths. `callApi()` in the bridge agent treats any response missing `ok: true` as an error and throws. The `runPdfBackfill()` call in `sendHeartbeat()` had `.finally()` but no `.catch()`, so the thrown error became an unhandled promise rejection — Node.js ≥15 terminates on these. With `PDF_BACKFILL` stuck in `"running"` state, every heartbeat triggered the backfill → threw → crashed the process → restarted → crashed again.

Impact: Bridge agent on `edgesynology2` crash-looped for several hours. Alternative Images (sibling folder scan) timed out for all users; all bridge agent work was offline.

Root cause: Missing `ok: true` in `handleClaimPdfBackfillBatch()` return values + missing `.catch()` on the fire-and-forget `runPdfBackfill()` call.

Recovery: Added `ok: true` to both return paths; added `.catch()` on `runPdfBackfill()`. Deployed as part of bridge agent v1.16.0. Follow-up (v1.16.1): added `unhandledRejection`/`uncaughtException` handlers in `apps/bridge-agent/src/index.ts` as a last-resort safety net; wrapped inner claim/complete loops in `apps/bridge-agent/src/pdf-backfill.ts` with try/catch so a mid-loop fault logs and breaks out instead of propagating. Same-day follow-up also: (1) **offloaded** the full-library backfill to the Windows agent (v0.16.0) behind a version/capability gate (see the "PDF text backfill runs on the Windows agent" quirk); (2) fixed the progress `total` to count `.pdf`+`.ai` via `count_pdf_backfill_remaining()` (was a `.pdf`-only undercount that would have falsely marked the run "completed" early) and made `complete-pdf-backfill-batch` accumulate per-method `stats` + `files_used_added`; (3) surfaced `claim-pdf-backfill-batch` RPC errors as 5xx instead of an opaque empty body; (4) added a completion summary + **stall/offline warning** to the admin Backfill card; (5) added `PDF_BACKFILL` to the `windows-render` heartbeat config keys (without it the Windows trigger was silently always-false); (6) follow-up commit `6325a37` made the UI show queued/processed/remaining, timestamps, Windows agent heartbeat, zero-work completion, method/error stats, and files-used rows added. That commit also made `admin-api/get-pdf-backfill-status` and `agent-api/complete-pdf-backfill-batch` use remaining-count normalization so a drained run cannot report no result.

Rule added to prevent recurrence: Every `json({...})` return in agent-api routes called by the bridge agent must include `ok: true`. The bridge agent's `callApi()` throws on any response where `data.ok` is falsy. All fire-and-forget async calls in `sendHeartbeat()` must have both `.catch()` and `.finally()`.

---

## Resolved 2026-06-09: Bridge agent ran a stale image while the panel showed "up to date"

What happened: After publishing bridge agent v1.16.0, the admin panel showed the agent "up to date" at v1.16.0, but it was still running the old v1.9.6 image. The agent reported a contradictory identity — `version: 1.16.0` (from `package.json`) but `image_tag: v1.9.6` / `build_sha: e0cc499` (the old image's baked env). A manual `docker compose pull && down && up` had pulled the new image but **`down` couldn't remove the running container** ("Running 0/0" — it had drifted out of compose's tracking), so the new container hit a name conflict and never started; the old container kept running.

Impact: The new receipt-verification code wasn't actually running, even though the UI said it was. Nearly activated `CHECKIN_VERIFICATION_ENABLED` against a dead code path (which would have hung Seafile check-ins). Caught because `build_sha` didn't match the published commit.

Root cause: (1) The admin panel computed "up to date" from the **version string**, which can match while the running image differs. (2) The agent's `docker run` self-update fallback creates a container outside the compose project (by design — the agent has no host compose file), so later `docker compose` commands can't manage it.

Recovery: `sudo docker rm -f popdam-bridge && sudo docker compose up -d --remove-orphans` on `edgesynology2` — force-removes the orphan by name, then recreates from the pulled image. Afterward all three identity fields agreed on the new commit.

Rule added to prevent recurrence: The admin Bridge Agents panel now detects drift by comparing `build_sha` to `BRIDGE_LATEST_BUILD.sha` (a red "Build mismatch" badge with the recovery command) — never trust the version string alone. The fragile self-updater was deliberately **not** modified (see `docs/KNOWN_QUIRKS.md` #26); detection, not surgery, is the chosen guard. Confirm an agent's true build via `agent_registrations.metadata->'version_info'` — `version`, `image_tag`, and `build_sha` must all match the intended commit.

---

## Resolved 2026-06-07/08: Seafile-aware Helper + SeaDrive self-host + CI gate

- Seafile/SeaDrive Helper first slice (provider selection, hydration, prefix-based library mapping, `helper-api` config/heartbeat/complete-checkin) — Helper v1.4.x; migration `20260607120639` (nullable `asset_checkouts` source columns).
- Worker `seadrive-mirror` (Spaces, weekly) + Downloads page pinned latest — worker v1.3.0.
- Frontend production deploy now gated on `verify` (`publish-frontend.yml`); `ipc.ts` `storeSession` import bug fixed.

## Resolved 2026-05-31: style_groups.asset_count stale counts

17 style groups had stale `asset_count` values including 2 (MF162DYPN01, MFZ93DYNX03) with `asset_count=1` but zero actual assets. Root cause: the asset count reconciliation trigger was only added 2026-05-15 (migration `20260515080654`); pre-existing drift from before that date was never cleaned up. Fixed by:
1. Bulk SQL fix via `execute_sql` MCP to correct all 17 rows.
2. Adding pg_cron job `nightly-reconcile-sg-asset-counts` (migration `20260531142011`) running at 03:45 UTC daily — calls `refresh_style_group_counts_batch(array_agg(id))` over all style groups.

## Resolved 2026-05-26: Style group rebuild timeout on "Compute counts" stage

After a full "Start Fresh" rebuild, the `finalize_stats` stage called `run_full_reconcile_style_group_stats` — a function with no `SET statement_timeout` that does a single unbounded UPDATE+JOIN across all style groups. The DB-level role timeout killed it (~33 minutes in). Fixed by driving `reconcile_style_group_stats_batch` in batches instead. Worker v1.2.12.

## Resolved 2026-05-15: CI/CD migration to Coolify API

Frontend deploy migrated from SSH-based (`docker run` on VPS) to Coolify API trigger. `VPS_SSH_KEY` secret removed. See `SELFHOST.md` and `docs/KNOWN_QUIRKS.md` #41–42.

---
