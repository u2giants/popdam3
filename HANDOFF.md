# Handoff

_Last updated: 2026-06-08. Delete this file once the pilot, code signing, and PopSG render pass are done._

Read `AGENTS.md` first, then this. Self-contained — no prior chat context required.

---

## Context

Two threads are in flight on top of the stable PopDAM/PopSG system:
1. **Seafile/SeaDrive Helper integration** — give Brazil (WFH) designers fast file access via the SeaDrive virtual drive, with the desktop Helper supervising it. Background + design: `docs/SEAFILE_INTEGRATION.md`.
2. **POP DAM Helper code signing** — make the Mac/Windows installers run without Gatekeeper/SmartScreen warnings and enable auto-update.

---

## Done (2026-06-07/08, on `main`)

- **Seafile-aware Helper, first slice** (Helper → **v1.4.1**): `seafileAdapter.ts` (SeaDrive-only detection, hydration wait, **longest-path-prefix** library mapping, optional REST `obj_id`); provider selection in `checkoutManager.ts` with the `synologyFallbackAllowed` gate; provenance recorded in `.pop-checkout.json` + DB.
- **helper-api**: `/config` returns `HELPER_SEAFILE_PREFERRED` / `HELPER_SEAFILE_LIBRARIES` / `HELPER_SEAFILE_SERVER_URL` / `HELPER_SYNOLOGY_FALLBACK_ALLOWED`; `/heartbeat` sets `last_helper_heartbeat_at`; `/complete-checkin` persists `source_provider` + `source_version`.
- **Migration `20260607120639`** — 6 nullable `asset_checkouts` columns (source provenance + heartbeat). Applied to prod; partial unique index untouched.
- **`admin_config` seeded**: `HELPER_SEAFILE_LIBRARIES` (Character Licensed `177cf9de…` + Generic Decor `1b116ab7…`, both under root `Decor`), `HELPER_SEAFILE_SERVER_URL=https://seafile.designflow.app`, `HELPER_SYNOLOGY_FALLBACK_ALLOWED=true`, `SEADRIVE_LATEST` (v3.0.22, mirrored to Spaces).
- **SeaDrive self-host mirror** (worker → **v1.3.0**): `seadrive-mirror` handler weekly-mirrors the latest installer to the `popdam` Spaces bucket; Downloads page serves it.
- **CI**: frontend production deploy now gated on a `verify` job; fixed pre-existing `ipc.ts` missing-`storeSession` import.
- **Helper macOS signing wiring**: `publish-popdam-helper.yml` reads `CSC_LINK`/`CSC_KEY_PASSWORD` + `APPLE_*`; unsigned until secrets added.

---

## Remaining work

### 1. Brazil/Seafile pilot (next concrete step)
Server-side config is complete. To pilot on one Brazil Mac: install official **SeaDrive** + the **Helper**, sign into SeaDrive with the Microsoft account, let `Character Licensed` + `Generic Decor` sync, pick **Seafile** in Helper Settings, then test a checkout/check-in. Provider auto-selection by region is **not built yet** (see #3) — the pilot uses the manual Settings toggle.

### 2. Helper code signing (wiring done; needs certs)
macOS — no Mac required (CI's `macos-latest` runner signs):
1. Create a **Developer ID Application** cert (OpenSSL CSR → developer.apple.com → download `.cer` → bundle `.p12`).
2. Add GitHub secrets: `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
3. Run **Publish PopDAM Helper** → signed + notarized.
Windows: separate OV/EV cert for SmartScreen (not started).

### 3. Seafile follow-on features (designed, not built)
- **Region automation**: installer geolocation + per-device region (on `helper_devices`) editable in the PopDAM admin panel → Helper auto-selects provider (Brazil→Seafile, USA→Synology). Decided approach: installer asks, prepopulated by IP geolocation, viewable/settable in admin.
- **USA direct-SMB write**: switch USA check-in from Synology File Station API to a direct copy into the mounted `edgesynology1` share.

### 4. PopSG render pass (operational)
Windows Agent on **v0.15.0**. Run **Retry All** (PopSG Settings → Files with Render Errors), queue previously-`unsupported_extension` EPS files, then check `get_sg_preview_stats()`. Accept-as-is categories: AI-no-PDF-compat (~25), missing-on-disk (~3,264), unsupported ZIP/fonts/video/3D (~2,076), exotic-channel TIFF (~30), corrupt JPEG/TIFF (~17).

---

## Cross-repo note
The **Seafile server** itself lives in `u2giants/seafile` (do not edit it from this repo). Its `seahub_settings.py` still needs the direct-Microsoft OAuth block enabled (the Entra app `8d9da03c…` is ready); until then its SSO is misconfigured.

## Risks / unknowns
- Seafile is a **partial mirror** of the NAS — unsynced files rely on the Synology/Tailscale fallback; verify fallback works during the pilot.
- Three Seafile infra secrets were exposed earlier in a chat and should be rotated (MySQL root + seafile-user passwords, JWT private key) — owner action.
