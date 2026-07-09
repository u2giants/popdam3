# Handoff

_Last updated: 2026-06-25. Delete this file once the pilot, PopSG render/backfill work, GHCR package access, style-guide archival readiness work, and production PO sync auth handoff are done. Helper code signing is **permanently abandoned** — installers stay unsigned forever (§5.3), not a blocker. (The quick_hash/move-detection and bridge build-identity work in §5.9 is **done and deployed** — kept only for the optional history-row cleanup.)_

Read `AGENTS.md` first. This file is self-contained — a developer with **zero prior context** should be able to continue from here. Background detail lives in `docs/SEAFILE_INTEGRATION.md` and `docs/POPDAM_HELPER.md`.

---

## 0. Prerequisites a new developer needs

- **Apps & URLs:** PopDAM web = `https://dam.designflow.app`; PopSG = `https://sg.designflow.app` (same Docker image, mode by hostname). Seafile server = `https://seafile.designflow.app` (a **separate** system, repo `u2giants/seafile` — do not edit it from here).
- **Admin access:** you need a PopDAM admin account (Microsoft SSO or email/password). Admin UI is Settings (gear). Authentik SSO still exists in the backend but the "Sign in with company account" button is hidden in `src/pages/LoginPage.tsx` as of 2026-06-08. For the Seafile side you need the Seafile admin account.
- **Database / config:** prod Supabase project is **`qsllyeztdwjgirsysgai` (Virginia, "popdam")**. ⚠️ **Tooling trap:** the old Ohio project `ryltkzzernhwnojzouyb` ("popdam-prod.old") is **decommissioned** but still ACTIVE, and the default `mcp__supabase__*` MCP / `get_project_url` point at it — querying it returns real-looking data **frozen at the 2026-06-20 cutover**. For live data use `mcp__claude_ai_Supabase__execute_sql` with `project_id: "qsllyeztdwjgirsysgai"`. Agents self-migrate via `migrateSupabaseUrl()` in `apps/{bridge,windows}-agent/src/config.ts`. `admin_config` is a key/value table read by edge functions and agents; changes are plain SQL `UPDATE/INSERT`. DB **schema** changes go through committed migrations in `supabase/migrations/` — see `CLAUDE.md` for the timestamp discipline.
- **Git:** trunk-based, commit straight to `main`, push to both `origin` and `github` (see `CLAUDE.md`).
- **The Helper** (desktop app) is distributed via GitHub Release tag `popdam-helper-latest` and linked from `dam.designflow.app/downloads`.

---

## 1. What this work is and why

**Thread A — Seafile/SeaDrive for WFH designers.** Eight designers in Brazil need fast access to a 28 TB NAS library that lives in the NYC office. The chosen transport is **Seafile + the SeaDrive virtual-drive client** (files appear on-demand, not fully synced). The **POP DAM Helper** desktop app *supervises* SeaDrive — at checkout it resolves the file in `~/SeaDrive`, waits for it to hydrate, copies it into a private workspace, opens it, and checks it back in. PopDAM/Supabase stays the checkout/audit plane. Full design: `docs/SEAFILE_INTEGRATION.md`.

**Thread B — Helper code signing (ABANDONED).** The Helper installers are unsigned and **will stay unsigned permanently** — macOS Gatekeeper / Windows SmartScreen warn on first launch, and that is the accepted permanent UX. The certificate/identity-provider hurdle is too high to justify. Signing/notarization wiring remains in CI but is dormant by choice; see §5.3. This is **not** pending work.

**The checkout flow (so "test a checkout" is meaningful):** in PopDAM web, open an asset → **Check Out & Open** → that mints a `popdam://` URL → the running Helper handles it, resolves the source (Seafile or Synology per config), copies it to its workspace, and opens it. Check-in is from the Helper tray. Architecture: `docs/POPDAM_HELPER.md`.

---

## 2. What is fully done (on `main`, 2026-06-07/10)

- **Seafile-aware Helper, first slice** (Helper **v1.4.1**): `apps/popdam-helper/src/main/seafileAdapter.ts` (SeaDrive-only detection, hydration wait, **longest-path-prefix** library mapping, optional Seafile REST `obj_id`); provider selection in `checkoutManager.ts` gated by `synologyFallbackAllowed`; provenance written to `.pop-checkout.json` + DB.
- **helper-api** (`supabase/functions/helper-api/index.ts`): `/config` returns `HELPER_SEAFILE_PREFERRED` / `HELPER_SEAFILE_LIBRARIES` / `HELPER_SEAFILE_SERVER_URL` / `HELPER_SYNOLOGY_FALLBACK_ALLOWED`; `/heartbeat` sets `last_helper_heartbeat_at`; `/complete-checkin` persists `source_provider` + `source_version`. The Helper consumes the Seafile catalog + fallback flag in `ipc.ts` (`fetch-server-roots`) — but **not** `preferredProvider` (that's per-machine; see Decisions).
- **Migration `20260607120639`** — 6 nullable `asset_checkouts` columns (`source_provider`, `source_local_path`, `seafile_library_id`, `seafile_path`, `source_version`, `last_helper_heartbeat_at`). Applied to prod; the partial unique index was untouched.
- **`admin_config` seeded** (verify with `SELECT key, value FROM admin_config WHERE key LIKE 'HELPER_SEAFILE%' OR key='SEADRIVE_LATEST';`):
  - `HELPER_SEAFILE_LIBRARIES` = two entries, both under PopDAM root `Decor`:
    - `Decor/Character Licensed` → library `177cf9de-3066-482e-956a-7ae8d8786c6d`, SeaDrive folder `Character Licensed`
    - `Decor/Generic Decor` → library `1b116ab7-d66b-4411-a691-21f34eadb731`, SeaDrive folder `Generic Decor`
  - `HELPER_SEAFILE_SERVER_URL` = `https://seafile.designflow.app`; `HELPER_SYNOLOGY_FALLBACK_ALLOWED` = `true`.
  - `SEADRIVE_LATEST` = v3.0.22, mirrored to Spaces.
- **SeaDrive self-host mirror** (worker **v1.3.0**, `apps/worker/src/handlers/seadrive-mirror.ts`, called weekly from `operation-loop.ts` `tick()`): scrapes the official download page, mirrors the latest `.pkg`/`.msi` to the `popdam` Spaces bucket (creds from `admin_config.DO_SPACES_*`), records `SEADRIVE_LATEST`. The Downloads page reads it. Verified: byte-exact mirror, public.
- **CI**: frontend production deploy gated on a `verify` job (`.github/workflows/publish-frontend.yml`); fixed a pre-existing `ipc.ts` missing-`storeSession` import.
- **Helper macOS signing wiring** (`.github/workflows/publish-popdam-helper.yml`): the Mac job reads `CSC_LINK`/`CSC_KEY_PASSWORD` + `APPLE_*`; unsigned until secrets are added.
- **Helper Microsoft OAuth + USA SMB/local check-in** (commit `1cc3fd3`, 2026-06-24): the Helper now offers **Continue with Microsoft** using the system browser and a localhost Supabase PKCE callback at `http://127.0.0.1:47380/auth/callback`; email/password remains a fallback. USA/Synology-mode check-in now writes the snapshot through the configured local NAS folder mapping using temp-copy-then-rename and falls back to Synology File Station if the local SMB write fails. Supabase Auth callback allow-list was updated and verified on live project `qsllyeztdwjgirsysgai` on 2026-06-24. Verification: `npm run typecheck` in `apps/popdam-helper`.
- **Seafile check-in receipt verification** (bridge agent **v1.16.x**, 2026-06-09): `helper-api/complete-checkin` parks Seafile check-ins at `status: 'verifying'` instead of `complete`. The bridge agent claims them via `claim-checkin-verifications`, checks size + quick-hash on the on-disk file (~128 KB read), and calls `report-checkin-verification`. T1 = 30 min flag + re-drive (helper re-uploads the retained snapshot, up to 2×), T2 = 2h auto-resolve (releases the lock into `error` with diagnostics); deadlines freeze during bridge agent downtime. **Gated by `admin_config.CHECKIN_VERIFICATION_ENABLED`, now `true` (active).** Set it `false` for instant rollback. Code: `apps/bridge-agent/src/checkin-verifier.ts`, `agent-api` (2 new routes), `helper-api` (Seafile branch + flag in complete-checkin, `/redrive` + `/redrive-complete`), migration `20260609120000_asset_checkouts_receipt_verification.sql`. Full quirk + incident in `AGENTS.md`.
- **Admin build-drift detection** (2026-06-09): the Settings → Bridge Agents "Up to date" badge now compares the agent's `build_sha` to `BRIDGE_LATEST_BUILD.sha` (admin-api returns `sha`), showing a red "Build mismatch" when a stale image masquerades as current. The fragile self-updater itself was intentionally **not** touched (`docs/KNOWN_QUIRKS.md` #26). Code: `src/pages/SettingsPage.tsx`, `supabase/functions/admin-api/index.ts`.
- **PDF/.ai text backfill status UI** (commit `6325a37`, 2026-06-10): Settings → Processing → PDF Text now shows queued/processed/remaining counts, Windows agent heartbeat, timestamps, current file, stalled/offline warning, zero-work completion, method/error stats, and files-used rows added. Backend status was hardened too: `admin-api/get-pdf-backfill-status` returns `remaining_count` from `count_pdf_backfill_remaining()` and normalizes stale `status="running"` rows to `completed` when remaining is zero; `agent-api/complete-pdf-backfill-batch` marks completion from authoritative remaining count, not only `processed >= total`. Code: `src/components/settings/PdfTextSamplesTab.tsx`, `supabase/functions/admin-api/index.ts`, `supabase/functions/agent-api/index.ts`.
- **Repo hygiene fixes** (2026-06-11): root lint now ignores generated `dist/`/`out/` output, dependency audits are clean for root/worker/bridge/windows, Windows-agent build works locally after installing deps, Supabase edge functions pass Deno typecheck, `deploy-supabase.yml` now fails the workflow if any edge function deploy fails, and the dead `deploy-popsg-supabase.yml` workflow intentionally fails instead of deploying `supabase-popsg/`.

---

## 3. Decisions made (and why)

- **Provider is per-machine/region, not a global flag.** Brazil (WFH) → Seafile/SeaDrive; USA → Synology `edgesynology1` over SMB. The Helper now defaults local `config.preferredProvider` to `seafile` because the primary install audience is South America; USA/office users switch it manually in Settings. A single global `HELPER_SEAFILE_PREFERRED` does **not** fit and is intentionally not consumed into local config.
- **Brazil keeps a Synology fallback over Tailscale SMB.** (This reversed an earlier "no fallback for Brazil" assumption — Brazil *can* reach the NAS via Tailscale, so `HELPER_SYNOLOGY_FALLBACK_ALLOWED=true`.)
- **A library is matched by longest path-prefix** on `relative_path`, because one PopDAM root (`Decor`) contains multiple Seafile libraries as subfolders (`Character Licensed`, `Generic Decor`). Earlier code keyed on `root_id` and stripped only the first segment — that was wrong for this layout and was reworked (see Dead ends).
- **SeaDrive (virtual drive), never the Seafile *sync* client** — 28 TB can't fully download to a laptop. The Helper only detects SeaDrive; sync-client detection paths were removed.
- **Helper supervises SeaDrive, does not embed/fork it.** Designers install the official SeaDrive separately; the Helper detects + drives it.
- **SeaDrive installer is self-hosted + auto-mirrored** so we control the version and always offer the latest.
- **macOS signing is wired but permanently abandoned** — installers stay unsigned forever (§5.3). The CI wiring runs on `macos-latest` and no Mac is needed locally to produce a Developer ID `.p12` (OpenSSL works on Windows/Linux), but nobody intends to do it. Do not make signing a prerequisite for anything.

---

## 4. Dead ends / abandoned approaches (don't repeat these)

- **rootId-based library mapping** (`find by root_id`, strip first path segment) — abandoned once the data showed libraries are *subfolders* under a root. Replaced by longest-prefix matching in `seafileAdapter.resolveSeafileTarget`.
- **"No Seafile→Synology fallback for Brazil"** — abandoned; Tailscale gives Brazil a route to the NAS, so fallback is enabled.
- **Storage-transport alternatives** (LucidLink, Resilio, JuiceFS) were evaluated and rejected (cost / Windows-centric lock enforcement / running a custom filesystem platform) in favor of Seafile/SeaDrive. Notes: `future_improvements.md` here; `lucid.md` in `u2giants/seafile`.

---

## 5. Remaining work

### 5.1 ✅ DONE — Microsoft SSO on the Seafile server (fixed 2026-06-08)
Microsoft OAuth is live on `seafile.designflow.app`. The fix required two changes in the `u2giants/seafile` repo (committed to `main`):
1. `seahub_settings.py` — `OAUTH_ATTRIBUTE_MAP` corrected: `"email"` maps to `"contact_email"` (not `"email"`). Seahub 13's callback reads `oauth_user_info.get('contact_email', '')`, so the wrong key caused a 500 IntegrityError on `/oauth/callback/`. See `docs/SEAFILE_INTEGRATION.md` for the full config.
2. `nas-settings/app.py` — `is_seafile_admin()` rewritten to use the `seahub_auth` cookie (Token auth over HTTPS) instead of the `sessionid` cookie over `http://seafile`. The internal nginx issues a 308 HTTP→HTTPS redirect that drops the Cookie header, so session-cookie auth always returned 403, trapping authenticated users in a redirect loop (`ERR_TOO_MANY_REDIRECTS`).

### 5.2 Brazil/Seafile pilot (after 5.1)
**Helper v1.4.2 (2026-06-25) fixed two pilot blockers found while testing:** (a) "Continue with Microsoft" returned `bad_oauth_state` — the Helper was passing its own `state` to `/auth/v1/authorize`; removed it so GoTrue manages state (PKCE binds the flow). (b) Windows uninstall failed 100% with "NSIS Error: Error launching installer" — CI was caching the NSIS toolchain and shipped a corrupted uninstaller; fixed by not caching it (`docs/KNOWN_QUIRKS.md` #54). Both verified working. Supabase Auth allows the Helper redirect URL `http://127.0.0.1:47380/auth/callback` on live project `qsllyeztdwjgirsysgai` (verified 2026-06-24 via Supabase Management API). On one Brazil Mac: (1) install official **SeaDrive** (`dam.designflow.app/downloads` → SeaDrive card, or seafile.com) and sign in with the designer's Microsoft account; (2) confirm the `Character Licensed` + `Generic Decor` libraries appear under `~/SeaDrive` and sync; (3) install the **Helper** (`dam.designflow.app/downloads`), sign in with **Continue with Microsoft**, and in Helper **Settings → Seafile/SeaDrive** confirm "Preferred source for checkout" is **Seafile** and confirm the mount root; (4) in PopDAM web, **Check Out & Open** a Decor asset and confirm the Helper resolves it from `~/SeaDrive`, hydrates, and opens it; check it back in. Provider auto-selection by region is **not built** (5.4); the default is Seafile, and office/USA users manually switch to Synology. Success = checkout/check-in round-trips a real file via Seafile, with the Synology/Tailscale fallback covering any not-yet-synced file.

**Helper v1.4.3–1.4.8 (2026-06-26) — checkout/check-in hardening from a live test session.** A real Windows checkout attempt surfaced that **SeaDrive mounts vary per machine** (Windows: `C:\seadrive\<account>\My Libraries\<lib>`, plus `Shared with groups/all/me` — NOT `~/SeaDrive`), and the checkout was failing silently. Fixed across several versions, all on `main` and built green; detail in `docs/POPDAM_HELPER.md`:
- **Auto-discovery:** the Helper now searches every SeaDrive base + category folder for a library (bounded scan, cached) — the user no longer sets a mount path. Checkout gates on the mount existing + the *specific* library (not all libraries).
- **No silent failures:** a failed checkout releases the orphaned server lock + notifies; permanent upload failure pops a modal; missing Synology creds open Settings to the field; startup warns if SeaDrive/libraries aren't found.
- **Edit-aware safety:** an atomic-save-aware watcher tracks edited-but-not-checked-in files → hourly reminder + quit-guard + tray badge (covers "worked hours, never saved").
- **Photoshop plugin** (`apps/popdam-helper/resources/photoshop-plugin/`, Helper `POST /editor-event`): offers check-in when a checked-out file is closed in Photoshop. Illustrator dropped (no close event).

**Remaining pilot tests (next actions):**
1. On v1.4.8, retry **Check Out** of a `Decor/Character Licensed/…` asset — should now auto-find SeaDrive and open the workspace copy (no manual mount-path setup).
2. **Check-in needs Synology credentials** set in Helper Settings (the snapshot uploads to the NAS via File Station/Tailscale; Seafile mirrors it back). Confirm a full round-trip.
3. **Photoshop plugin is UNTESTED on-device** (no Photoshop in CI): load it via Adobe UXP Developer Tool (Settings → "Reveal Photoshop plugin folder"), close an edited checked-out PSD, confirm the "Check it in now?" prompt. Expect minor tuning of the PS event/path code in `resources/photoshop-plugin/index.js`.

### 5.3 Helper code signing (ABANDONED — installers stay unsigned permanently)
Status: **will not be done.** As confirmed by the user on 2026-06-25, the Helper installers (macOS + Windows) **will always remain unsigned** — the certificate/identity hurdle (Apple Developer **Account Holder** role for the Developer ID cert; a separate OV/EV cert for Windows) is too high to justify. Do **not** treat this as pending work, and do not reopen it in handoffs. The unsigned first-launch warnings (macOS Gatekeeper right-click→Open; Windows SmartScreen "More info → Run anyway") are the accepted, permanent UX. The CI wiring below is left in place only so a future maintainer *could* revive it if the calculus ever changes — not because anyone intends to.

If this is ever revived (not planned):
1. Create a **Developer ID Application** cert (this requires the Apple Developer **Account Holder** role). On Windows use **Git Bash** (ships OpenSSL): `openssl genrsa -out popdam_key.pem 2048` then `openssl req -new -key popdam_key.pem -out popdam.csr` (set Common Name = `POP Creations`). Upload `popdam.csr` at developer.apple.com → Certificates → **Developer ID Application** → download `developerID_application.cer`. Bundle: `openssl x509 -inform DER -in developerID_application.cer -out popdam_cert.pem` then `openssl pkcs12 -export -out popdam.p12 -inkey popdam_key.pem -in popdam_cert.pem -name "Developer ID Application"`; `base64 -w0 popdam.p12`.
2. Add **GitHub repo secrets**: `CSC_LINK` (the base64 .p12), `CSC_KEY_PASSWORD` (.p12 export password), `APPLE_ID` (Apple ID email), `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com → App-Specific Passwords), `APPLE_TEAM_ID` (10-char, developer.apple.com → Membership).
3. Run **Actions → Publish PopDAM Helper → Run workflow**. The Mac job signs + notarizes via `scripts/notarize.cjs`. Windows SmartScreen needs a **separate** OV/EV cert (not started).

### 5.4 Seafile follow-on features (designed, not built)
- **Region automation:** the installer asks the user's region (prepopulated by IP geolocation) and it's viewable/settable in the PopDAM admin panel; the Helper then auto-sets `preferredProvider`. Not built — would need: a `region` field on `helper_devices` (new migration), `helper-api` `register-device` to accept/store it, an admin-panel UI to view/edit per device, and installer/first-run geolocation in `apps/popdam-helper`.
- **USA direct-SMB write:** built in commit `1cc3fd3`. In Synology mode, check-in first writes through the configured local root mapping with temp-copy-then-rename, then falls back to Synology File Station. Future setup must still configure each machine's root mappings correctly: Windows can use UNC paths such as `\\edgesynology1\share\Decor`; macOS must mount the same SMB share and enter its `/Volumes/...` path.

### 5.5 PopSG render pass (operational, no code)
Windows Agent is on **v0.16.0** (bumped 2026-06-10 when the full-library PDF backfill loop was added to it). In **PopSG** (`sg.designflow.app`) admin: Settings → Files with Render Errors → **Retry All** (loops in 500-file batches); then queue the previously-`unsupported_extension` **EPS** files (`queue_sg_render_jobs_by_ids` or a "Queue All Renderable" button); then check `select * from get_sg_preview_stats()`. Accept-as-is: AI-no-PDF-compat (~25), missing-on-disk (~3,264), unsupported ZIP/fonts/video/3D (~2,076), exotic-channel TIFF (~30), corrupt JPEG/TIFF (~17).

### 5.6 Frontend deploy GHCR package access

Status:
Partial. Production was restored manually on the VPS, but the automated GitHub Actions → GHCR publish path remains blocked on GitHub Packages configuration.

Done:
`publish-frontend.yml` now supports `workflow_dispatch`, logs in with `GITHUB_TOKEN` first, retries with `GHCR_PAT` if push fails, and emits an explicit `write_package` remediation error. `Dockerfile.ci` now includes OCI source labels and `chmod -R a+rX /usr/share/nginx/html` so nginx can read locally built `dist/` files. During the 2026-06-10 PopSG incident, the shell was confirmed to be on the production VPS (`hetz`, `178.156.180.212`), the fixed frontend image was built locally, and the Coolify-managed service was recreated via `/data/coolify/applications/qxj8a0j3tpa9lq4q5rs6pezy/docker-compose.yaml`. Verified after the manual deploy: container healthy and `https://sg.designflow.app/library` returned `HTTP 200` with the new bundle.

Next action:
Grant repository `u2giants/popdam3` **Write** under the `ghcr.io/u2giants/popdam-frontend` package's Settings → Manage Actions access, or replace `GHCR_PAT` with a valid classic PAT with `write:packages` owned by a package admin. Then manually run `Publish Frontend Image` via `workflow_dispatch`.

Risks / watchouts:
Production is currently running a locally built image, not an image successfully pushed by the GitHub workflow. Verified failures: `GITHUB_TOKEN` push returns `permission_denied: write_package`; existing `GHCR_PAT` retry logs `denied`, so it is absent, invalid, or lacks package rights. Do not assume a passing Vite build means production deployed; compare the live header SHA / HTML asset timestamp to the latest successful `Publish Frontend Image` run. If another urgent deploy is needed before GHCR is fixed and the session is on the VPS, use the break-glass path in `docs/deployment.md`, then immediately keep the repo/Coolify state documented.

### 5.7 Style Guide Sources resolution + style-guide archival readiness

Status: **partial** — foundation shipped 2026-06-10; depends on a long-running backfill + two unbuilt features. Detail: `docs/POPSG.md` → "Style Guide Sources"; quirks `docs/KNOWN_QUIRKS.md` #46–#48.

Done (on `main`, Deploy Supabase green):
- `sku_files_used` scoped to licensing/tech-pack PDFs across all 3 write paths + `source` provenance column (`20260610070731`); backfill claim re-scoped to those PDFs (queue 52,862 → 13,819) and re-triggered.
- `normalize_for_sg_match()` uppercase-deletion bug fixed (`20260610100545`); trigram index `idx_style_guide_files_filename_trgm` (`20260610091711`); fuzzy resolver `resolve_sku_files_used_fuzzy()` (`20260610100856`, trigram-only) + nightly cron `resolve-sku-files-used-nightly` `0 4 * * *` UTC; `sg_archive_usage` view (`20260610104738`).
- Legacy cleanup: 863 `legacy_ungated` → 730 resolved (592 prior + 138 fuzzy), 88 pending (64 best-guess ≥0.4, 24 low-info), 45 deleted (titles + 1 self-SKU).

Next action:
1. **Let the licensing-PDF backfill finish** (~13.8k tech-pack PDFs left; runs on the Windows render agent; admin Backfill card) — prerequisite for everything else being trustworthy. The nightly resolver then clears the 88 pending automatically.
2. **Build a crawl-regression guard** for `deactivate_stale_sg_files` (refuse mass-deactivation when `files_found` drops sharply + alert) — do this *before* archiving (quirk #46).
3. **Build an `archived` state** (user req): remove old guides from NAS but keep name-only resolvable `style_guide_files` rows (flag distinct from `is_active`).
4. Optional: pending-review admin panel for the 64 ≥0.4 best-guess rows.

Risks / watchouts:
- **Do NOT archive style guides off `sg_archive_usage` yet** — it flags ~657/740 guides archivable but most are false positives until backfill #1 raises resolution coverage (only ~646 links resolved now).
- 730 resolved legacy rows are **kept**; `DELETE FROM sku_files_used WHERE source='legacy_ungated'` only after reviewing per-row `match_best_score` (most are real, OCR-typo'd).
- `\\edgesynology2\styleguides` failing to mount is **not** a missing crawl root — user confirmed `/mnt/nas/styleguides` is the complete library.

### 5.8 Production PO sync from PLM

Status:
Partial. Backend schema/function work was deployed manually during the session, but durable PLM app-layer auth is blocked.

Done:
- Migration `20260615183000_add_prod_order_headers.sql` was pushed to prod with Supabase CLI. It adds `prod_order_sync_runs`, `prod_order_headers_raw`, and `prod_order_headers_current`.
- `admin-api` was deployed manually after adding production PO routes: `trigger-prod-order-sync`, `prod-order-sync-runs`, and `prod-order-stats`.
- UI code exists locally for Settings → Processing → ERP Sync → Production POs and style group detail-panel PO display, but the normal frontend deployment path has not been run from this session.
- Supabase Edge Function secrets exist for `PROD_ORDER_GOOGLE_SERVICE_ACCOUNT_JSON`, `PROD_ORDER_API_TOKEN_2`, and `PROD_ORDER_CLOUD_RUN_AUDIENCE`. No secret values are documented here.
- Google/Cloud Run auth was verified on 2026-06-18. `gcloud auth print-identity-token --impersonate-service-account=designflow-bff-invoker@lithe-breaker-323913.iam.gserviceaccount.com --audiences=<origin>` works for prod and sandbox after Token Creator access was granted.
- The PLM data shape was verified from user screenshot and smoke tests: header PO fields are `Prod Reference #` / `Prod Order No`; SKU is nested in `details[]` as `Item #` / `matchedItemNumber`. Code now flattens header/detail rows.
- Temporary smoke-test edge functions used during verification were deleted, their temporary secret was unset, and zero-upsert diagnostic sync runs were deleted.

Next action:
Get a durable PLM app-layer authentication mechanism. Browser-copied `X-User-Authorization` JWTs expire; one supplied token expired on 2026-06-16 and the PLM API returned `403 Invalid Token` on 2026-06-18. Ask the PLM/BFF developer for one of: service-account allow-listing so `X-User-Authorization` is not required for this server-to-server route, a client-credentials/token-refresh endpoint, or a long-lived read-only API token for production-order reads.

Risks / watchouts:
- Do not treat `PROD_ORDER_API_TOKEN_2` as solved if it contains a browser JWT; it will expire and background sync will fail.
- Prod and sandbox require matching Cloud Run audiences and app tokens. The session restored `PROD_ORDER_CLOUD_RUN_AUDIENCE` to the prod origin and removed the temporary `admin_config.PROD_ORDER_API_ENDPOINT` sandbox override.
- `admin-api` service-role server-to-server auth was fixed to allow `userId === "system"` through `authenticateAdmin`; keep this if server-side admin actions are invoked by other edge functions.
- ✅ The source IS now in git (migration `20260615183000_add_prod_order_headers.sql` and the `trigger-prod-order-sync` routes in `admin-api` are committed on `main`), so GitHub/Supabase state matches production. The only blocker is the PLM app-layer auth above.

### 5.9 `quick_hash` collision → asset flip-flapping (FIXED + verified) + optional history-row cleanup

Status:
**Move-detection fix DONE and deployed; verified working on the live Virginia DB.** Only an *optional* historical-row cleanup remains. The bridge build-identity bug found while verifying this is also DONE (see below).

Done & verified:
- ✅ **Move-detection guard** (`agent-api` `process-asset`): a move now requires `quick_hash` **AND filename** to match AND a **unique** candidate, is **skipped for 0-byte files**, and is skipped whenever the incoming path already has a row. Different-filename hash collisions insert as their own asset instead of flip-flapping the shared row. Forward-only.
- ✅ **Same-filename duplicate-copy guard** (bridge **v1.16.3** + `agent-api`, commit `0fc3fc1`): the bridge collects all scan candidates before ingest, `check-changed` returns unchanged existing `(quick_hash, filename)` identities across the scan, and changed/new files send `skip_move_detection=true` when that identity was already seen. Stops byte-identical same-name copies from moving one shared row between folders.
- ✅ **Bridge build-identity fix** (bridge **v1.16.4**, commit `fa26b14`): unrelated to move-detection but found while verifying it. The self-updater's `recreateViaDockerRun` cloned the old container's env forward, freezing the reported `build_sha`/`image_tag` and producing a **false** "Build mismatch" badge. Fixed by baking identity into an immutable `/app/build-info.json` (`readBuildInfo()` in `index.ts`); `recreateViaDockerRun` left untouched. See `docs/KNOWN_QUIRKS.md` #26 + the 2026-06-21 critical incident in `AGENTS.md`. **Do not revert `readBuildInfo()` to `process.env.POPDAM_BUILD_SHA`.**
- ✅ `idx_asset_path_history_asset_id_detected_at` (migration `20260619131239`).
- **Verification (live Virginia `qsllyeztdwjgirsysgai`, 2026-06-21):** same-filename `asset_path_history` growth is now ~**2 rows / 6h** (was hundreds/hour pre-fix); **0** assets have ≥100 history rows. The fix works.
- Root cause + full analysis: `docs/KNOWN_QUIRKS.md` #51; caveat in `docs/PROJECT_BIBLE.md` §9.

Remaining (optional, low priority — growth has already stopped):
1. **Historical-row cleanup — mostly already done; likely nothing left to do.** The **big prune already ran** after v1.16.2 verification: `9,299,506` high-churn rows were deleted + `VACUUM (ANALYZE)` (see the move-detection quirk in `AGENTS.md` and `docs/KNOWN_QUIRKS.md` #51). Live Virginia now holds **81,013 rows** total (**77,321** same-filename), **0** assets with ≥100 history rows — i.e. the residual is spread thin and no longer growing (~2 rows/6h). Treat further pruning as discretionary housekeeping only; the residual same-filename rows may be legitimate historical moves. ⚠️ **Re-measure on the live Virginia project first** (the old "4.7M rows / 15,151 assets" figures were Ohio-era and wrong). Any bulk DELETE must go through the service role and be batched — RLS makes large deletes blow the 8s timeout (`docs/KNOWN_QUIRKS.md` #27); VACUUM after.
2. **Heavier-sample hash** (optional, closes only the residual: two *different* files sharing both a sampled hash and a filename). `apps/bridge-agent/src/hasher.ts` — add middle-chunk samples, bump `quick_hash_version`. **Must be a coordinated release**: the Helper (`apps/popdam-helper/src/main/hash.ts`) computes the same hash and it is the check-in `expected_hash`; needs synchronized bridge+Helper deploy, a full re-scan to migrate stored hashes, and in-flight-checkout handling. Do NOT bundle casually.

Risks / watchouts:
- `quick_hash` is shared by scan + check-in verification + the Helper — never change the algorithm on one side alone (the Helper's `hash.ts` carries an explicit lockstep warning).
- Re-measure scope on the **live Virginia** project (not Ohio `.old` — see §0 trap): `select count(*) from (select asset_id from asset_path_history group by asset_id having count(*) >= 100) z;` (0 as of 2026-06-21).

### 5.10 MCP token rotation + secrets → 1Password (server-side DONE; Windows clients pending)

Status: **partial** — server-side complete & verified; Windows machines need the updated scripts re-run.

Done (2026-06-22):
- Rotated the exposed `devops-mcp` + `synology-monitor` bearer tokens (old values were in git history). New tokens in 1Password `vibe_coding/designflow-mcp`; Coolify env updated (`TOKEN_ROOCODE`, `MCP_BEARER_TOKEN`) + redeployed; old tokens now rejected, new accepted (verified). `.mcp.json` → `${…}` placeholders; VPS Claude Code auto-resolves them via a `~/.bashrc` `op read` block. `synology-monitor` switched to `type:http` at `/mcp` (image upgraded off SSE). Full model: `docs/MCP_SERVERS.md`.
- VPS proxy/docker-socket failure fixed for real (event-driven reconnect unit; docker unheld). `deploy/vps/coolify-proxy-socket-fix.md`.
- Other infra secrets centralized into `vibe_coding` with notes (github-pat, ai-provider-api-keys, devops-mcp-client-tokens, nas-monitor-secrets, contextforge/cloudflare/coolify/directus).

Next action:
- **User must re-run the two updated PowerShell setup scripts on each Windows machine** (sent 2026-06-22). The old ones hardcode three now-dead secrets (devops bearer, nas bearer, AND the deleted 1Password SA token → the Windows `1password` MCP is broken too until re-run).

Risks / watchouts:
- The new 1Password **service account is scoped to `vibe_coding` only**; its token lives in `/root/.bashrc` + `/home/ai/.bashrc` on the VPS and in the Windows scripts. If it's ever recreated, update all three places.
- Do **not** paste real tokens back into `.mcp.json` (commits them to git).

### 5.11 Master Data style tracker / Google Sheet replica

Status:
**partial / live preview**. `https://master.designflow.app/styles` is running as a temporary standalone single-page Master Data app, but it is not yet the final PLM-backed implementation.

Read first:
- `docs/MASTER_DATA.md` for the detailed app/data-flow notes.
- `shared-db/docs/app-migration-notes/master-data-style-tracker-20260624.md` for shared-Supabase/backend implications.

Done:
- Imported the legacy Google Sheet into Supabase-backed Master Data tables and cleaned formula/default-only tail rows. Verified populated counts: `License.Style` 12,317 rows; `Generic.Style` 3,027 rows.
- Built `/styles` as an AG Grid table with Licensed/Generic tabs, newest-first loading, default latest-2,500 browser load for speed, `Show All`, `+1/+5/+10/+25` row creation through the DB RPC, and admin-only matching UI.
- Added AG Grid Enterprise without a license key, matching the PLM-style trial setup. **Important:** all AG Grid packages must stay on the same exact version. A previous version mismatch caused a blank page before React mounted.
- Added/used temporary backend objects: `public.style_tracker_rows`, `public.style_tracker_rows_with_bridge`, `plm.style_tracker_item_bridge`, `plm.style_tracker_value_resolution`, `public.add_style_tracker_rows`, `public.refresh_style_tracker_item_bridge`, `public.search_style_tracker_link_candidates`, `public.upsert_style_tracker_value_resolution`, and `public.style_tracker_user_views`.
- Matching UI now treats **Dismiss: Keep In Master Data** as **Master Data only** and removes approved/dismissed values from the review dropdown.
- Created 1Password item `DesignFlow PLM Canonical Master Data API` in `vibe_coding`; it stores the read-only PLM API key and endpoint notes without documenting the secret value.
- PLM-backed candidate matching is now live through `public.search_style_tracker_link_candidates(...)`: customer candidates come from `core.customer` joined through `core.company_source_ref` with `source_system='designflow_plm'`, and licensor/property candidates come through `core.taxonomy_source_ref`. The `core.company` → `core.customer` rename leftovers were repaired in shared-db PR #14 / migration `20260626170000_fix_core_customer_leftovers.sql`; preview and prod were both applied.
- Documented details in `docs/MASTER_DATA.md`.

Current source/runtime state:
- Source files that matter: `src/App.tsx`, `src/pages/StylesPage.tsx`, `package.json`, `package-lock.json`, `docs/MASTER_DATA.md`, and the style-tracker SQL migration files listed in the shared-db note.
- `src/App.tsx` must import `StylesPage` and route `/styles` inside the protected `AppLayout`; if the route is missing, `/styles#` mounts the React app but shows the 404 page.
- `src/pages/StylesPage.tsx` was reconstructed during the session after transient local source loss. It currently preserves the core experience but is simplified versus an earlier iteration: the `public.style_tracker_user_views` table exists, but the current page does **not** yet expose a finished **Save View** button. It exposes AG Grid's Columns panel only. If per-user saved default views matter next, implement that deliberately from `docs/MASTER_DATA.md` rather than assuming it is complete.
- AG Grid packages are pinned to exact `35.3.1` versions. Do not use caret ranges or mix `ag-grid-community`, `ag-grid-react`, and `ag-grid-enterprise` versions.
- The live preview bundle after the last deploy in this session was `index-BpPmUcrb.js`; newer work should verify the live bundle rather than relying on this value.

Recommended continuation sequence:
1. Re-run `public.refresh_style_tracker_item_bridge()` and test known cases:
   - `Customer: Ross` should prefer the PLM Ross customer and should not offer `Rossy` if PLM does not list it as a canonical customer.
   - customer values with trailing SKU text such as `Burlington - BG139DYLS01` should preserve the raw sheet value but match the canonical customer.
2. Restore/finish per-user saved grid views if needed; the database table exists but the current page only exposes the AG Grid Columns panel.
3. Move the temporary Master Data tables/RPCs into a cleaner PLM bridge namespace or replace them when PLM lands in the shared Supabase project.

Operational commands used for preview deploy:
```bash
npm run build
docker build -f Dockerfile.ci -t popdam-master-preview:local .
docker rm -f popdam-master-preview || true
docker run -d --name popdam-master-preview --network coolify --restart unless-stopped popdam-master-preview:local
curl -sS -I https://master.designflow.app/styles
```

Database verification snippets:
```sql
select source_sheet, count(*) as rows, max(source_row_number) as max_row_number
from public.style_tracker_rows
where source_sheet in ('License.Style', 'Generic.Style')
group by source_sheet
order by source_sheet;

select * from public.search_style_tracker_link_candidates('customer', 'Ross', 20, 'fuzzy');
select * from public.refresh_style_tracker_item_bridge();
```

Risks / watchouts:
- PLM, not arbitrary customer-looking strings, is canonical for customers/licensors/properties. Canonical customers now live in `core.customer`; confirmed PLM-backed customers have `is_potential = false` and a `designflow_plm` source ref. Email/domain noise belongs only in `crm.ingested_domain` and must never create, promote into, source-ref, FK to, or otherwise associate with customers.
- Do **not** put the PLM API key in browser code. Call it from server-side scripts/functions/workers, or sync/cache canonical values into Supabase with provenance.
- The current source tree has been reconstructed during the session after transient local source loss; verify `src/pages/StylesPage.tsx` and `src/App.tsx` before future deploys.
- The preview app is manually deployed as container `popdam-master-preview`, image `popdam-master-preview:local`, on the `coolify` Docker network. This is not the normal GHCR/Coolify frontend pipeline.
- The recent style-tracker backend objects were manually applied to the live Virginia Supabase project during rapid preview work; the live Supabase migration ledger did not show the recent style-tracker migration versions when checked. Formalize them in `shared-db` before treating them as durable shared-schema infrastructure.
- The review dropdown is derived from the latest rows loaded in the browser, not the entire table when the default 2,500-row limit is active. A value absent from the dropdown may still exist in older hidden rows.

### 5.13 `.ai` thumbnails / sentinel cleanup (2026-07-03)

**Status:** mostly done; one bulk job in flight, a few follow-ups open.

**Context / correction:** ".ai saved without PDF Content" files are **NOT empty placeholders** — they retain full native artwork; only the PDF preview is a boilerplate stub. See the AGENTS.md quirk "`.ai` 'no PDF compatibility' ≠ empty". The old ".ai Sentinel Cleanup" delete flow is unsafe (soft-deletes real art; ~1,319 already hidden but recoverable — NAS files untouched). Do not run it.

**Done + deployed:**
- `ai-sentinel-detect.ts` (shared PDF-layer detector) wired into bridge scanner/thumbnailer/pdf-text-sampler + windows renderer. `get_ai_sentinel_stats` re-homed to shared-db (exact-phrase match), applied to preview+prod (shared-db PR #33, migration `20260702220336`).
- `compat-audit.ts` rewritten: OCR → **perceptual-hash (dHash)** detection (OCR was broken: matched "compatibility", warning says "Compatible" → 0 flagged). Windows agent `0.16.3.150`.
- Windows self-update pipeline fixed: `publish-windows-agent.yml` now writes `WINDOWS_LATEST_BUILD` via PostgREST (was `notify-build`/`DEPLOY_WEBHOOK_KEY`, broke at the 2026-06-20 cutover). Agent unblocked (was frozen 2 weeks on `0.16.1.147`).

**In flight:** full **Compat Thumbnail Audit** fired 2026-07-03 (`COMPAT_AUDIT_REQUEST`). Preview found **547** boilerplate thumbnails across 45,841 `.ai`. The audit clears those + re-queues for native (Inkscape) render → real art.
**Next action:** confirm the audit completed and the 547 got real thumbnails: `render_queue` pending/claimed should drain; spot-check a few of the 547 asset thumbnails. Watch the Windows agent stays healthy under render load.

**Risks / watchouts:**
- **15 flagged `.ai` errored `ENOENT`** during a re-sample — their `assets.relative_path` is stale (files moved on the NAS). Separate move-reconciliation issue.
- Orphaned migration `supabase/migrations/20260702120000_ai_sentinel_stats_exact_match.sql` is inert; **do not try to delete it** (the `forbid-shared-db-bypass` guard fails CI on any `supabase/migrations/*.sql` change, incl. deletions).
- `DEPLOY_WEBHOOK_KEY` / `notify-build` path is still broken in prod — not used anymore, but don't route new deploy notifications through it.
- Consider retiring/repurposing the ".ai Sentinel Cleanup" card (delete → "needs PDF-compat re-save" list, or gate deletion on a confirmed sibling copy).

### 5.14 Style Groups `3fz` collapse / SKU extractor drift (2026-07-08)

Status:
**done / deployed.** Production DB migration is applied, `agent-api` is deployed, and the style-group rebuild completed successfully.

What happened:
- In PopDAM, selecting **Style Groups** and searching `3fz` returned one bogus group with **2,234 files**: `sku = 'B3M_3FZ - 3D Lenticular framed'`, `id = 33664017-187b-4599-872c-957c42e4017e`.
- That folder is a category/product-type folder, not a SKU. The production DB function `public.rebuild_style_groups_batch(uuid, integer)` still used the old loose regex `^[A-Za-z]{1,6}[0-9]`, so it matched the prefix `B3M` in `B3M_3FZ - 3D Lenticular framed`.
- The app-side extractor had already been stricter, but it was too strict for real digit-leading/short SKUs. Live samples showed valid SKU folders such as `3FZ93DYEC01`, `27W4AV4`, and `3DWC01JK`.

Done:
- Updated `supabase/functions/_shared/style-grouping.ts` to use the durable SKU rule: path segment is purely alphanumeric, length ≥ 7, contains both letters and digits, and is not the filename segment.
- Added regression test `src/test/style-grouping.test.ts` covering the `B3M_3FZ - 3D Lenticular framed` collapse and short/digit-leading SKUs.
- Updated `docs/STYLE_GROUPS.md`, `docs/ONBOARDING.md`, and this `AGENTS.md` quirk.
- Created canonical shared-db branch `codex/dam-fix-style-group-sku-regex` with migration `supabase/migrations/20260708150000_dam_strict_style_group_sku_regex.sql` replacing `public.rebuild_style_groups_batch(...)` with the matching DB rule.
- Applied that migration to the preview branch (`xjcyeuvzkhtzsheknaiu`) after dry-run. Preview also applied already-merged `20260707171500_masterdata_designer_resolution.sql`; it printed its expected skip notice because style-tracker bridge objects are absent there.
- Verified that the corrected expression would split the bad live 2,234-file group into **323 distinct SKU groups** with **0 ungrouped** assets.
- Refreshed Supabase CLI auth with the updated `Supabase CLI Personal Access Token` from 1Password. `supabase login --token ...` was required; simply setting `SUPABASE_ACCESS_TOKEN` still returned `Unauthorized` in the installed CLI.
- Relinked `/worksp/shared-db` to production project `qsllyeztdwjgirsysgai` using the updated `Supabase DB Password - shared POP database`.
- Brought already-applied production migration `20260708143000_crm_customer_logo_overrides.sql` from branch `codex/crm-logo-admin` into the shared-db branch so local migration history matched production.
- Production dry-run showed only `20260708150000_dam_strict_style_group_sku_regex.sql`; production apply succeeded.
- Deployed PopDAM `agent-api` to production with `supabase functions deploy agent-api --project-ref qsllyeztdwjgirsysgai`.
- Started the Railway worker `rebuild-style-groups` operation via `public.update_bulk_operation(...)`; it completed with `Created 86827 style groups, assigned 87236 assets`.
- Verified production search shape after rebuild: `3fz` matches **335** style groups, and `sku = 'B3M_3FZ - 3D Lenticular framed'` matches **0** groups.
- Updated the 1Password item `Supabase DB Password - shared POP database` with a `Migration usage notes` field containing direct/pooler connection guidance and the verified pooler host (`aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`).
- Follow-up frontend fix (commits `2189b25` and `70056f8`): Style Groups mode now computes the displayed group count from filtered `style_groups` and the displayed file count by summing matching groups' cached `asset_count`; it does not fire the all-assets list query while Groups mode is active. The Product Category = Wall filter also includes legacy folder signals (`WALL ART`, `3FZ`) so searching/filtering old framed 3D wall art does not drop rows that lack ERP `product_category`.

Verification:
- `npm test -- --run src/test/style-grouping.test.ts` passed.
- `deno check supabase/functions/agent-api/index.ts` passed.
- `/worksp/shared-db/scripts/check-sql.sh` passed.
- Frontend follow-up verification: `npm test -- --run src/test/asset-filters.test.ts src/test/product-category-filters.test.ts src/test/style-grouping.test.ts` and `npm run build` passed.
- Preview DB function definition contains `length(seg) >= 7`.
- Production dry-run after apply reports `Remote database is up to date`.
- Production function definition contains `length(seg) >= 7` and `^[A-Za-z0-9]+$`.
- Production rebuild op completed at `2026-07-08T15:47:01.674Z`.

Risks / watchouts:
- Do not reintroduce the old prefix regex. It collapses category folders.
- Do not require "starts with letters" or length ≥ 10. That drops valid live DAM SKUs.
- Shared-db branch `codex/dam-fix-style-group-sku-regex` still needs normal git finalization (commit, PR, merge) so the already-applied production migration is durable in `main`.

### 5.15 Rich tech-pack / licensing-sheet PDF extraction (2026-07-09)

Status:
**discovery spike done; implementation not started.** No code, migration, schema, RPC, worker, or production data changes were made for this feature. Durable notes were added to `docs/RICH_PDF_EXTRACTION.md` and `/worksp/shared-db/docs/app-migration-notes/popdam-rich-pdf-extraction-20260709.md`.

User goal:
For all new styles going forward, scrape tech-pack and licensor/licensing-sheet PDFs for relevant rich data, attach that data to the `style_group` and make it available/searchable through all member assets, then backfill existing styles.

Done:
- Verified the current system already has a narrow PDF text path: `pdf_text_samples.extracted_text`, `sku_files_used` parsing for Style Guide Sources, and full-text search over extracted PDF text if the shared-db search RPCs are live.
- Queried live production project `qsllyeztdwjgirsysgai` using service-role credentials from 1Password.
- Found current extracted-text corpus: **125 tech-pack PDFs** and **14 licensing-sheet PDFs**.
- Sampled 5 tech packs and 5 licensing sheets from live `pdf_text_samples`.
- Ran Qwen **`qwen3.7-plus`** through DashScope compatible-mode with `enable_thinking=false`.
- Generated local working reports:
  - `/tmp/popdam-rich-pdf-data-sample.md`
  - `/tmp/popdam-rich-pdf-data-sample.json`
- Verified the secrets touched in this session are already in 1Password:
  - `Supabase Runtime Keys - shared POP database (production)`
  - `OpenRouter API Key - The Oracle (local .env.local)`
  - `ai-provider-api-keys` (`dashscope` field)

Key findings:
- Useful recurring fields: source art/file refs, style-guide reference names, designer/technical designer names, approval/submission dates, product dimensions, production materials/finish/hardware/packaging, compliance/legal requirements, manufacturer/factory info, Pantone/color references, and retailer program/season values.
- Qwen produced many overlapping field names (`material_specs`, `production_material`, `production_materials`, `compliance_codes`, `compliance_standards`, `regulatory_compliance`). Collapse these into a small canonical schema before implementation.
- The available OpenRouter key is present in 1Password but returned a privacy/data-policy guardrail error for `qwen/qwen3.7-plus`. Direct DashScope worked. Future tests requiring this exact model should use the `dashscope` credential unless OpenRouter privacy settings are changed.

Recommended implementation direction:
- Design shared backend objects in canonical `/worksp/shared-db`, not this app repo's historical `supabase/migrations/`.
- Likely objects: source-level extraction table per PDF asset, style-group rollup table or jsonb field, flattened search projection/RPC update, and resumable backfill bookkeeping.
- Treat asset-level "attachment" as a projection/search concern first; avoid blindly duplicating mutable rich metadata onto every asset row unless query performance requires it.
- Keep provenance: source PDF asset ID, model ID, raw text reference, confidence, parse errors, and timestamps.

Next action:
Create a dedicated `/worksp/shared-db` branch for the backend design. Draft the migration/schema proposal for rich PDF extraction and a PopDAM worker/backfill plan. Then implement the app/worker side in `/worksp/popdam` only after the shared-db contract is clear.

Risks / watchouts:
- Do not create new PopDAM app-repo migrations for this feature.
- Existing extracted-text coverage is sparse; backfill must include both rich metadata extraction for existing `pdf_text_samples` and missing text extraction for eligible PDFs not yet sampled.
- `/tmp/popdam-rich-pdf-data-sample.*` are local artifacts and may not survive environment cleanup; the durable summary lives in docs.
- No new secret values were added to docs. Do not print 1Password credential values when re-running the test.

---

## 6. Exact next action
For the currently active user thread, continue **5.15 Rich tech-pack / licensing-sheet PDF extraction**: create a dedicated `/worksp/shared-db` branch, design the shared schema/RPC/backfill contract, then implement the PopDAM worker/app side against that contract.

Continue **5.11 Master Data style tracker** only if the user asks for Master Data polish: saved grid views and eventual cleanup/replacement of the temporary style-tracker backend objects are still open. PLM-backed candidate matching itself is done and deployed.

The most unblocked Helper next step is still **5.2 Brazil/Seafile pilot**: test a real checkout/check-in on one Brazil Mac using Microsoft OAuth. Code signing is permanently abandoned (§5.3) and does not block the pilot. The PO-sync thread (5.8) is blocked on the PLM team providing durable server-to-server auth. The §5.9 history-row prune is optional housekeeping with no urgency (growth has stopped); do it only if asked, and re-measure on the live Virginia project first (§0 trap).

## 7. Known risks / unknowns
- ⚠️ **Wrong-database trap:** the default `mcp__supabase__*` tooling points at the **decommissioned Ohio** project (`ryltkzzernhwnojzouyb`, "popdam-prod.old"), which is still ACTIVE but frozen at the 2026-06-20 cutover. Live prod is **Virginia `qsllyeztdwjgirsysgai`** — query it via `mcp__claude_ai_Supabase__execute_sql` with `project_id`. Burned ~1h of a session on 2026-06-21 (see §0 and the AGENTS.md 2026-06-21 incident).
- Seafile is a **partial mirror** of the NAS; unsynced files rely on the Synology/Tailscale fallback — verify fallback works during the pilot.
- Three Seafile **infra secrets** were exposed in an earlier chat (MySQL root + seafile-user passwords, JWT private key) and **should be rotated** — owner action; no values are in this repo.
- The Developer ID cert needs the Apple **Account Holder** role; an Admin/Member can't create it. Because of this (and the separate Windows OV/EV cert), signing is **permanently abandoned** as of 2026-06-25 — installers stay unsigned forever (§5.3).
- USA direct SMB write depends on correct per-machine Helper root mappings. Windows may use UNC paths; macOS must use the mounted `/Volumes/...` path.
- Production PO sync cannot run reliably until PLM provides durable server-to-server app-layer auth; copied browser JWTs are known-expiring.
