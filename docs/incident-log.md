# Critical incidents

Moved verbatim from `AGENTS.md` on 2026-09-18 to keep the router under its size cap. Add new entries here, then add a one-line title to the index in `AGENTS.md` → Critical incidents.

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
