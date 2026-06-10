# Handoff

_Last updated: 2026-06-10. Delete this file once the pilot, code signing, and PopSG render pass are done._

Read `AGENTS.md` first. This file is self-contained — a developer with **zero prior context** should be able to continue from here. Background detail lives in `docs/SEAFILE_INTEGRATION.md` and `docs/POPDAM_HELPER.md`.

---

## 0. Prerequisites a new developer needs

- **Apps & URLs:** PopDAM web = `https://dam.designflow.app`; PopSG = `https://sg.designflow.app` (same Docker image, mode by hostname). Seafile server = `https://seafile.designflow.app` (a **separate** system, repo `u2giants/seafile` — do not edit it from here).
- **Admin access:** you need a PopDAM admin account (Microsoft SSO or email/password). Admin UI is Settings (gear). Authentik SSO still exists in the backend but the "Sign in with company account" button is hidden in `src/pages/LoginPage.tsx` as of 2026-06-08. For the Seafile side you need the Seafile admin account.
- **Database / config:** prod Supabase project `ryltkzzernhwnojzouyb`. `admin_config` is a key/value table read by edge functions and agents. Changes to it are plain SQL `UPDATE/INSERT` (Supabase dashboard → SQL editor, or the Supabase MCP). DB **schema** changes go through committed migrations in `supabase/migrations/` — see `CLAUDE.md` for the timestamp discipline.
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
- **Seafile check-in receipt verification** (bridge agent **v1.16.1**, 2026-06-10): `helper-api/complete-checkin` now parks Seafile check-ins at `status: 'verifying'` instead of `complete`. The bridge agent claims them via `claim-checkin-verifications`, checks size + quick-hash on the on-disk file (~128 KB read), and calls `report-checkin-verification`. T1 = 30 min flag, T2 = 2h auto-resolve; deadlines freeze during bridge agent downtime. Code: `apps/bridge-agent/src/checkin-verifier.ts`, `agent-api` (2 new routes), `helper-api` (Seafile branch in complete-checkin), migration `20260609120000_asset_checkouts_receipt_verification.sql`.

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

---

## 6. Exact next action
The single most unblocked, in-repo next step is **5.3 (add the Apple signing secrets and run the Helper workflow)** — it depends on nothing else. The pilot (5.2) is also unblocked — SSO (5.1) is fixed and receipt verification (bridge agent v1.16.1) is deployed.

## 7. Known risks / unknowns
- Seafile is a **partial mirror** of the NAS; unsynced files rely on the Synology/Tailscale fallback — verify fallback works during the pilot.
- Three Seafile **infra secrets** were exposed in an earlier chat (MySQL root + seafile-user passwords, JWT private key) and **should be rotated** — owner action; no values are in this repo.
- The Developer ID cert needs the Apple **Account Holder** role; an Admin/Member can't create it.
- USA SMB-mount path (5.4) is unconfirmed.
