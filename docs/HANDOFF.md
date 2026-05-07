# Session Handoff

_Last updated: 2026-05-07_

This file captures decisions made and work left to do that aren't obvious from the code or git log. Delete sections once the work is complete.

---

## Recently completed (2026-05-06 / 05-07)

### PopSG — render pipeline fixes

| Problem | Fix |
|---------|-----|
| "Retry All" statement timeout | `retry_sg_render_errors` now accepts `p_limit int DEFAULT 500`; client loops in batches until return = 0 |
| "Retry All (500)" misleading count | Button label uses `previewStats.render_errored` (real total from `get_sg_preview_stats()`), not the display-capped list |
| Windows MAX_PATH failures | `withLongPathPrefix()` in `renderer.ts` prepends `\\?\` to paths > 230 chars for all Win32 API callsites |
| DB indexes for retry query | Added `idx_sgf_render_errored` (partial) and `idx_sgrq_file_status` (composite) |

### PopDAM Helper — email/password auth

The Helper previously had no sign-in flow (or a "Sign in with Google" OAuth redirect that was later removed). It now uses email + password matching the user's existing PopDAM account.

- `ipc.ts` `sign-in` handler POSTs to Supabase Auth `/token?grant_type=password`
- Anon key is discovered at runtime from `${damUrl}/dam-config.json` (field `supabase_anon_key`)
- Tokens stored in OS keychain via `safeStorage`
- `TrayPanel.tsx` and `SettingsPanel.tsx` both show an email + password form when not signed in
- `popdam://auth` deep link removed — the protocol is now used only for checkout links

### Helper app password for Google SSO users

Users who log into the PopDAM web app with Google OAuth have no Supabase password. Added `HelperPasswordCard` component in `src/pages/SettingsPage.tsx` (visible to all users, above the tab layout). It calls `supabase.auth.updateUser({ password })` to attach email+password auth to the existing account — no new user is created.

### Mac CI build fix

`apps/popdam-helper/resources/icon.png` upscaled from 256×256 to 512×512 (electron-builder requires min 512×512 for Mac builds).

---

## What is NOT done yet

### 1. Files without previews — PopSG (61,605 files as of 2026-05-07)

**Handoff prompt for a new session:**

---

You are continuing work on the popdam3 codebase (repo: u2giants/popdam3, working dir: /worksp/popdam/app). Always commit and push directly to `main` — never use feature branches. Push to both `origin main` and `github main`. See CLAUDE.md for full git workflow.

#### Current state

PopSG has ~61,605 active `style_guide_files` rows with `thumbnail_url IS NULL`. A full root-cause analysis was done. Here is the breakdown:

| Category | Count | Status |
|---|---|---|
| `render_failed` — file path > 260 chars (Windows MAX_PATH) | ~9,606 | Fix deployed (windows-agent v0.13.1), **need retry after agent updates** |
| `render_failed` — file missing, short path (stale Y:\ errors) | ~19,013 | **Need Retry All** after confirming agent updated |
| `render_failed` — PSD/AI unsupported color mode (CMYK/Lab) | ~6,344 | Ongoing — Sharp and ImageMagick can't handle these |
| `render_failed` — AI no PDF compat layer | ~25 | Minor — Inkscape also fails on these |
| `missing_file_on_disk` — pre-render check, genuinely missing | ~3,264 | Need re-crawl to mark `is_active = false` |
| `unsupported_extension` — **EPS** (biggest opportunity) | ~23,242 | EPS not in allowlist; GS already installed — quick win |
| `unsupported_extension` — ZIP, fonts, video, 3D, etc. | ~2,076 | Intentional — not renderable |
| `other_error: Skipped` — renderable files blocked by path filter | 517 | Needs investigation — see `shouldSkipPath()` |
| `other_error` — old-format PDF GS error (no prefix) | 582 | Need retry after agent update |
| `other_error` — multi-channel TIF (`linear: vector must have 1 or N elements`) | 43 | Sharp limitation — multi-channel TIFF |
| `other_error` — corrupt JPEG / fetch failed | ~18 | Minor |

#### What was already fixed in the previous session

1. **DB indexes** (`20260506152614_sg_render_retry_indexes.sql`): `idx_sgf_render_errored` and `idx_sgrq_file_status`.
2. **Retry All batching** (`20260507000346_retry_sg_render_errors_batched.sql`): `retry_sg_render_errors(p_limit int DEFAULT 500)`. Client loops until return = 0.
3. **Retry All count**: Button reads `previewStats.render_errored` from `get_sg_preview_stats()`.
4. **Windows MAX_PATH fix** (`apps/windows-agent/src/renderer.ts` v0.13.1): `withLongPathPrefix()` applied to all Win32 callsites. Shell commands unaffected.

#### Immediate next steps

1. **Confirm windows-agent is on v0.13.1** — check Settings → Agents → Windows Agent version.
2. **Run Retry All** — press "Retry All" in PopSG Settings → Files with Render Errors. It loops automatically.
3. **Check results** — expect ~9,606 long-path files and many of ~19,013 stale-error files to resolve.
4. **EPS support (23,242 files, biggest quick win)** — Ghostscript is installed. Add `'eps'` to the extension allowlist in `queue_sg_render_jobs_by_ids` and `get_sg_preview_stats`. Add EPS rendering in `renderer.ts` — GS handles EPS the same as AI/PDF.
5. **"Skipped: excluded by path filter" (517 files)** — investigate `shouldSkipPath()` in `apps/windows-agent/src/index.ts` and `packages/path-filters/index.ts` to see which paths are excluded and whether it's intentional.
6. **CMYK/Lab PSD/AI (~6,344 files)** — consider color space conversion before rendering, or accept as unrenderable.
7. **Re-crawl for genuinely missing files** — files with short-path "Input file is missing" may be moved/deleted. A fresh bridge agent crawl will mark them `is_active = false`.

#### Relevant DB objects

- `retry_sg_render_errors(p_file_ids uuid[] DEFAULT NULL, p_limit int DEFAULT 500)` — clears `thumbnail_error`, re-queues files
- `queue_sg_render_jobs_by_ids(p_file_ids uuid[])` — inserts into `style_guide_render_queue`; checks extension allowlist
- `get_sg_preview_stats()` — returns `total_active`, `has_preview`, `renderable_no_preview`, `render_errored`, `unsupported`, `queued_now`
- `style_guide_files` — `is_active`, `thumbnail_url`, `thumbnail_error`, `file_extension`, `relative_path`, `root_label`
- `style_guide_render_queue` — `style_guide_file_id`, `status` (pending/claimed/completed/failed), `error_message`

Supabase project: `ryltkzzernhwnojzouyb` (popdam-prod).

---

### 2. Auto-update (blocked on code signing)

`electron-updater` is not wired up. The `publish` block in `electron-builder.yml` is ready, but auto-update requires a code-signed build.

| Platform | Requirement | Cost |
|----------|-------------|------|
| macOS | Apple Developer account + notarization | $99/yr |
| Windows OV cert | Auto-update works; SmartScreen warns on first install | ~$60–$150/yr |
| Windows EV cert | No SmartScreen warning, silent updates | ~$300–$500/yr |

**To implement once signed:**
1. `npm install electron-updater` in `apps/popdam-helper/`
2. In `main.ts`, after `app.whenReady()`:
   ```typescript
   import { autoUpdater } from "electron-updater";
   autoUpdater.checkForUpdatesAndNotify();
   ```
3. Add GitHub Actions secrets: `CSC_LINK`, `CSC_KEY_PASSWORD` (Windows); `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (Mac)
4. Remove `CSC_IDENTITY_AUTO_DISCOVERY=false` and `SKIP_NOTARIZATION=true` from CI env

### 3. Windows `.ico` and macOS `.icns` icon files

`apps/popdam-helper/resources/icon.png` (512×512) is used for the system tray. However, `electron-builder.yml` references `icon.ico` and `icon.icns` for installer/Dock/Finder icons — these don't exist yet. Electron-builder falls back gracefully but shows a generic icon in those contexts.

### 4. macOS notarization not set up

`SKIP_NOTARIZATION=true` in CI. Gatekeeper blocks the app on macOS 10.15+. Users right-click → Open to bypass.

---

## Key architectural decisions (not obvious from code)

- **Port 47380** is hardcoded in both `localServer.ts` and `DirectoryBrowserTab.tsx`. See Known Quirks #32.
- **`helperAvailable` starts as `null`** in DirectoryBrowserTab — prevents double-load on mount. See Known Quirks #31.
- **No SQLite, no keytar** — native modules, CI complexity. JSON files for queue, `safeStorage` for creds. See Known Quirks #29, #30.
- **`extraResources`** in electron-builder.yml copies `apps/popdam-helper/resources/` into `process.resourcesPath`. Tray icon and static assets must live there.
- **`ia32` permanently removed** from Windows targets. Building ia32 on a 64-bit CI runner causes incomplete Electron download.
- **Supabase proxy enforces statement timeout externally** — `SET LOCAL statement_timeout = 0` inside PL/pgSQL is invisible to the proxy. Batch at client layer instead. See Known Quirks #33.
- **Windows MAX_PATH (260-char)** hits the Windows Render Agent but not the bridge agent (Linux). Fixed with `\\?\` prefix. See Known Quirks #34.

---

## GitHub release structure (Helper)

Tag: `popdam-helper-latest`

| File | Platform |
|------|----------|
| `POP-DAM-Helper-Windows-Setup.exe` | Windows x64 |
| `POP-DAM-Helper-Mac-arm64.dmg` | macOS Apple Silicon |
| `POP-DAM-Helper-Mac-x64.dmg` | macOS Intel |
