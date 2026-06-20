# Handoff

_Last updated: 2026-06-18. Delete this file once the pilot, code signing, PopSG render/backfill work, GHCR package access, style-guide archival readiness work, and production PO sync auth handoff are done._

Read `AGENTS.md` first. This file is self-contained — a developer with **zero prior context** should be able to continue from here. Background detail lives in `docs/SEAFILE_INTEGRATION.md` and `docs/POPDAM_HELPER.md`.

---

## 0. Prerequisites a new developer needs

- **Apps & URLs:** PopDAM web = `https://dam.designflow.app`; PopSG = `https://sg.designflow.app` (same Docker image, mode by hostname). Seafile server = `https://seafile.designflow.app` (a **separate** system, repo `u2giants/seafile` — do not edit it from here).
- **Admin access:** you need a PopDAM admin account (Microsoft SSO or email/password). Admin UI is Settings (gear). Authentik SSO still exists in the backend but the "Sign in with company account" button is hidden in `src/pages/LoginPage.tsx` as of 2026-06-08. For the Seafile side you need the Seafile admin account.
- **Database / config:** prod Supabase project `qsllyeztdwjgirsysgai` (Virginia; old Ohio project was `ryltkzzernhwnojzouyb`). `admin_config` is a key/value table read by edge functions and agents. Changes to it are plain SQL `UPDATE/INSERT` (Supabase dashboard → SQL editor, or the Supabase MCP). DB **schema** changes go through committed migrations in `supabase/migrations/` — see `CLAUDE.md` for the timestamp discipline.
- **Git:** trunk-based, commit straight to `main`, push to both `origin` and `github` (see `CLAUDE.md`).
- **The Helper** (desktop app) is distributed via GitHub Release tag `popdam-helper-latest` and linked from `dam.designflow.app/downloads`.

---

## 1. What this work is and why

**Thread A — Seafile/SeaDrive for WFH designers.** Eight designers in Brazil need fast access to a 28 TB NAS library that lives in the NYC office. The chosen transport is **Seafile + the SeaDrive virtual-drive client** (files appear on-demand, not fully synced). The **POP DAM Helper** desktop app *supervises* SeaDrive — at checkout it resolves the file in `~/SeaDrive`, waits for it to hydrate, copies it into a private workspace, opens it, and checks it back in. PopDAM/Supabase stays the checkout/audit plane. Full design: `docs/SEAFILE_INTEGRATION.md`.

**Thread B — Helper code signing.** The Helper installers are unsigned, so macOS Gatekeeper / Windows SmartScreen warn on first launch and auto-update can't work. Goal: sign + notarize so installs are clean.

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
- **macOS signing runs on CI's `macos-latest` runner** — no Mac is needed locally; you only produce a Developer ID `.p12` (OpenSSL works on Windows/Linux).

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
On one Brazil Mac: (1) install official **SeaDrive** (`dam.designflow.app/downloads` → SeaDrive card, or seafile.com) and sign in with the designer's Microsoft account; (2) confirm the `Character Licensed` + `Generic Decor` libraries appear under `~/SeaDrive` and sync; (3) install the **Helper** (`dam.designflow.app/downloads`), sign in, and in Helper **Settings → Seafile/SeaDrive** confirm "Preferred source for checkout" is **Seafile** and confirm the mount root; (4) in PopDAM web, **Check Out & Open** a Decor asset and confirm the Helper resolves it from `~/SeaDrive`, hydrates, and opens it; check it back in. Provider auto-selection by region is **not built** (5.4); the default is Seafile, and office/USA users manually switch to Synology. Success = checkout/check-in round-trips a real file via Seafile, with the Synology/Tailscale fallback covering any not-yet-synced file.

### 5.3 Helper code signing (wiring done; needs certs) — no Mac required
1. Create a **Developer ID Application** cert (this requires the Apple Developer **Account Holder** role). On Windows use **Git Bash** (ships OpenSSL): `openssl genrsa -out popdam_key.pem 2048` then `openssl req -new -key popdam_key.pem -out popdam.csr` (set Common Name = `POP Creations`). Upload `popdam.csr` at developer.apple.com → Certificates → **Developer ID Application** → download `developerID_application.cer`. Bundle: `openssl x509 -inform DER -in developerID_application.cer -out popdam_cert.pem` then `openssl pkcs12 -export -out popdam.p12 -inkey popdam_key.pem -in popdam_cert.pem -name "Developer ID Application"`; `base64 -w0 popdam.p12`.
2. Add **GitHub repo secrets**: `CSC_LINK` (the base64 .p12), `CSC_KEY_PASSWORD` (.p12 export password), `APPLE_ID` (Apple ID email), `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com → App-Specific Passwords), `APPLE_TEAM_ID` (10-char, developer.apple.com → Membership).
3. Run **Actions → Publish PopDAM Helper → Run workflow**. The Mac job signs + notarizes via `scripts/notarize.cjs`. Windows SmartScreen needs a **separate** OV/EV cert (not started).

### 5.4 Seafile follow-on features (designed, not built)
- **Region automation:** the installer asks the user's region (prepopulated by IP geolocation) and it's viewable/settable in the PopDAM admin panel; the Helper then auto-sets `preferredProvider`. Not built — would need: a `region` field on `helper_devices` (new migration), `helper-api` `register-device` to accept/store it, an admin-panel UI to view/edit per device, and installer/first-run geolocation in `apps/popdam-helper`.
- **USA direct-SMB write:** USA check-in currently uploads via Synology File Station HTTP (`apps/popdam-helper/src/main/synologyClient.ts` / `uploadQueue.ts`). The decision is to switch USA to a direct file copy into the SMB-mounted `edgesynology1` share. Not built; the mount path convention on USA machines is still unconfirmed.

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
- Because `admin-api` and the migration were manually deployed from the session, commit and push the source changes promptly so GitHub/Supabase deployment state matches production.

### 5.9 `quick_hash` collision → asset flip-flapping, history bloat, and hidden files

Status:
Partial — move-detection guards landed 2026-06-19; historical cleanup remains after deploy verification.

Done:
- ✅ **Move-detection guard** (`agent-api` `process-asset`): a move now requires `quick_hash` **AND filename** to match AND a **unique** candidate, is **skipped for 0-byte files**, and is skipped whenever the incoming path already has a row. Different-filename hash collisions now insert as their own asset instead of stealing/flip-flapping the shared row. Forward-only.
- ✅ **Same-filename duplicate-copy guard** (bridge agent v1.16.2 + `agent-api`): the bridge collects scan candidates before ingest, `check-changed` returns unchanged existing `(quick_hash, filename)` identities across the scan, and changed/new files send `skip_move_detection=true` when that identity was already seen. This stops byte-identical same-name copies from moving one shared row between folders.
- ✅ `idx_asset_path_history_asset_id_detected_at` (migration `20260619131239`) — detail-panel path-history read 30.5s → 16ms despite the 4.7M-row table.
- Root cause + full analysis: `docs/KNOWN_QUIRKS.md` #51; caveat in `docs/PROJECT_BIBLE.md` §9.

Next action (two independent tracks):
1. **Deploy/verify bridge v1.16.2 + agent-api**: watch moved counts and same-filename path-history growth after a full scan.
2. **Heavier-sample hash** (optional, closes only the residual: two *different* files sharing both a sampled hash and a filename). `apps/bridge-agent/src/hasher.ts` — add middle-chunk samples, bump `quick_hash_version`. **Must be a coordinated release**: the Helper (`apps/popdam-helper/src/main/hash.ts`) computes the same hash and it is the check-in `expected_hash`; needs synchronized bridge+Helper deploy, a full re-scan to migrate stored hashes, and in-flight-checkout handling. Do NOT bundle casually.
3. **Historical cleanup** (needs approval after generator is verified stopped): backfill so already-hidden N−1 files get their own asset rows; prune the self-reversing `asset_path_history` churn.

Risks / watchouts:
- The guard is forward-only: the ~4.7M existing history rows and already-hidden files persist until track 2 runs.
- `quick_hash` is shared by scan + check-in verification + the Helper — never change the algorithm on one side alone (the Helper's `hash.ts` carries an explicit lockstep warning).
- Re-measure scope: `select count(*) from (select asset_id from asset_path_history group by asset_id having count(*) >= 100) z;` (was 15,151; should stop growing now, then drop after cleanup).

---

## 6. Exact next action
The most urgent repo hygiene next step is to commit/push the production PO sync changes because migration `20260615183000` and `admin-api` were already deployed manually. The single most unblocked non-PO step remains **5.3 (add the Apple signing secrets and run the Helper workflow)**.

## 7. Known risks / unknowns
- Seafile is a **partial mirror** of the NAS; unsynced files rely on the Synology/Tailscale fallback — verify fallback works during the pilot.
- Three Seafile **infra secrets** were exposed in an earlier chat (MySQL root + seafile-user passwords, JWT private key) and **should be rotated** — owner action; no values are in this repo.
- The Developer ID cert needs the Apple **Account Holder** role; an Admin/Member can't create it.
- USA SMB-mount path (5.4) is unconfirmed.
- Production PO sync cannot run reliably until PLM provides durable server-to-server app-layer auth; copied browser JWTs are known-expiring.
