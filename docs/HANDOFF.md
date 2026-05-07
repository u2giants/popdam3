# Session Handoff

_Last updated: 2026-05-07_

This file captures decisions made and work left to do that aren't obvious from the code or git log. Delete sections once the work is complete.

---

## Session context (2026-05-07)

### CRITICAL: Supabase MCP is now configured — use it

`.claude/settings.json` was written this session with the Supabase MCP server config pointing at `ryltkzzernhwnojzouyb` (popdam-prod). **The MCP server is only loaded at session startup.** If you are starting fresh, the tools `execute_sql`, `apply_migration`, `list_migrations`, `list_tables`, `get_logs` etc. should be available immediately.

Always verify before any DB work:
```bash
# Check you're on main and up to date:
git fetch github main && git checkout main && git reset --hard github/main
```

---

## Recently completed (2026-05-07)

### PopSG — EPS support + render pipeline fixes

| Change | Detail |
|--------|--------|
| **EPS added to extension allowlist** | `queue_sg_render_jobs_by_ids` and `get_sg_preview_stats` now include `'eps'`. Previously 23,242 active EPS files were silently excluded. Migration: `20260507173844_add_eps_to_sg_render_allowlist.sql` |
| **`renderNativeImage` long-path fix** | Switched from `withLongPathPrefix` on Sharp to temp-copy pattern for paths >230 chars (Sharp/libvips doesn't reliably support `\\?\` prefix). Resolves ~7,500 long-path native image failures. Windows agent v0.13.2 |
| **Staleness cleanup** | `sg_staleness_cleanup()` edge function updated for reliability. Migration: `20260507191146_sg_crawl_staleness_cleanup_fn.sql` |
| **Nightly crawl at 9pm ET** | `pg_cron` job `nightly-sg-crawl` fires at 02:00 UTC (= 9pm EST / 10pm EDT). Upserts `STYLE_GUIDE_CRAWL_REQUEST=pending` in `admin_config`. Migration: `20260507154819_schedule_nightly_sg_crawl.sql` |
| **DB timezone** | `ALTER DATABASE` sets default session timezone to `America/New_York`. Migration: `20260507194811_set_db_timezone_new_york.sql` |

### Settings reorganization (7 tabs)

`src/pages/SettingsPage.tsx` reorganized from 9 tabs to 7:
- **General** (new): Users + Invitations + Helper App Password
- **Processing** (new): AI Tagging + PDF Text + ERP Sync + Taxonomy
- **File Health** (was Hygiene): TIFF Compression + File Quality + Style Guide Crawl
- **Maintenance** (was Operations): same content, renamed
- **Agents**: PDF Text and Style Guide Crawl sub-tabs removed (moved to Processing/File Health)
- **Storage**: unchanged
- **Diagnostics**: unchanged

Added a settings **search bar** in the page header — searches by label/description across all sections, clicking navigates to the correct tab + sub-tab.

### PDF Text Extraction — full scan + vision model picker

`src/components/settings/PdfTextSamplesTab.tsx`:
- **"Run Full Scan" button**: triggers `admin-api trigger-pdf-text-sample` with `mode: "full"` — queues all PDFs in the library (not just a random 25-file sample)
- **Placeholder candidates grid**: after any scan, PDFs classified as `likely_scanned` or `failed` that have a `thumbnail_url` are shown as an image grid for visual confirmation of Illustrator "no PDF compat" placeholder pages
- **AI vision model dropdown** now fetches live from OpenRouter via `admin-api get-openrouter-vision-models` — filters to models whose `architecture.input_modalities` includes `"image"`. No longer depends on `AI_MODELS` table/config. Shows count of available models. Results cached 5 min.

`supabase/functions/admin-api/index.ts` — new routes:
- `get-openrouter-vision-models`: calls `https://openrouter.ai/api/v1/models`, filters to vision-capable, returns list
- `trigger-pdf-text-sample`: now accepts `mode: "sample"|"full"`
- `get-pdf-text-samples`: enriches rows with `thumbnail_url` joined from `assets`; limit raised from 25 to 5000

### Right-click context menu + checkout/check-in bar (PopDAM UI)

- Asset cards have a right-click context menu (`296d0cc`)
- Detail panel headers now show a prominent checkout/check-in bar (`1549e27`)

### Previous session (also landed on main)

- **Retry All batching** (`retry_sg_render_errors(p_limit int DEFAULT 500)`): loops in 500-file batches. Client loops until return = 0.
- **DB indexes**: `idx_sgf_render_errored` (partial) and `idx_sgrq_file_status` (composite)
- **Windows MAX_PATH**: `withLongPathPrefix()` in `renderer.ts` — applied to all Win32 callsites. Windows agent v0.13.1 (superseded by v0.13.2 which uses temp-copy for native images)
- **Helper email/password auth**: `ipc.ts sign-in` POSTs to Supabase `/token?grant_type=password`. Anon key discovered from `${damUrl}/dam-config.json`.
- **Helper App Password card**: `HelperPasswordCard` in `SettingsPage.tsx` calls `supabase.auth.updateUser({ password })` so Google OAuth users can attach email+password auth.

---

## What is NOT done yet

### 1. PopSG — files without previews (status as of 2026-05-07)

Windows Agent is now on **v0.13.2**. EPS is in the allowlist. The next action is to run Retry All and see how many resolve.

**Updated breakdown:**

| Category | Approx count | Status |
|---|---|---|
| `render_failed` — long path (was ~9,606) | ~2,100 est. remaining | v0.13.2 fixes `renderNativeImage` long paths via temp-copy. PDF/AI long paths were already fixed in v0.13.1. Run Retry All. |
| `render_failed` — stale Y:\ errors (was ~19,013) | ~19,013 | Retry All after agent confirmed updated |
| `render_failed` — CMYK/Lab PSD/AI | ~6,344 | Ongoing — Sharp and ImageMagick can't handle CMYK/Lab |
| `render_failed` — AI no PDF compat layer | ~25 | Minor — Inkscape also fails |
| `missing_file_on_disk` — genuinely missing | ~3,264 | Fresh crawl will mark `is_active = false` |
| `unsupported_extension` — **EPS** | ~23,242 | **NOW FIXED** — EPS in allowlist. Queue render jobs and retry. |
| `unsupported_extension` — ZIP, fonts, video, 3D | ~2,076 | Intentional — not renderable |
| `other_error: Skipped` — path filter excluded | 517 | Needs investigation — see `shouldSkipPath()` |
| `other_error` — old-format PDF GS error | ~582 | Retry after agent update |
| `other_error` — multi-channel TIFF | ~43 | Sharp limitation |
| `other_error` — corrupt JPEG / fetch fail | ~18 | Minor |

**Immediate next steps:**
1. Confirm windows-agent is on v0.13.2 — check Settings → Agents.
2. For EPS files: in PopSG Settings → Files with Render Errors, click "Retry All" (loops in 500-file batches automatically). Also queue the ~23,242 newly-eligible EPS files that never got a render job (they'll have `thumbnail_error = 'unsupported_extension'`, not `render_failed` — may need a separate queue operation).
3. Run Retry All for all other `render_failed` rows.
4. Check results — expect EPS + long-path native images to resolve substantially.
5. Investigate the 517 "Skipped: excluded by path filter" files — see `shouldSkipPath()` in `apps/windows-agent/src/index.ts` and `packages/path-filters/index.ts`.
6. For CMYK/Lab (~6,344): consider color space conversion before rendering, or accept as unrenderable.
7. Fresh bridge agent crawl for genuinely missing files to mark `is_active = false`.

**Relevant DB objects:**
- `retry_sg_render_errors(p_file_ids uuid[] DEFAULT NULL, p_limit int DEFAULT 500)` — clears `thumbnail_error`, re-queues
- `queue_sg_render_jobs_by_ids(p_file_ids uuid[])` — inserts into `style_guide_render_queue`; checks allowlist
- `get_sg_preview_stats()` — returns `total_active`, `has_preview`, `renderable_no_preview`, `render_errored`, `unsupported`, `queued_now`

Supabase project: `ryltkzzernhwnojzouyb` (popdam-prod).

---

### 2. PDF text extraction — not yet production-validated

The PDF text extraction pipeline (mupdf → OCR → AI vision cascade) is built and the Settings UI is complete. However:
- The **OpenRouter API key** must be set in `admin_config` (`OPENROUTER_API_KEY`) for the vision model dropdown to populate and AI vision to function.
- The **AI vision model** must be selected and saved in Settings → Processing → PDF Text → AI Vision Config.
- No production run against the full asset library has been done yet. Run a full scan (Settings → Processing → PDF Text → "Run Full Scan") and review the placeholder candidates grid.
- OCR (Tesseract) may or may not be deployed in the edge function runtime — verify if `ocr_text` results appear in practice.

---

### 3. Auto-update (blocked on code signing)

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

### 4. Windows `.ico` and macOS `.icns` icon files

`apps/popdam-helper/resources/icon.png` (512×512) is used for the system tray. `electron-builder.yml` references `icon.ico` and `icon.icns` for installer/Dock/Finder icons — these don't exist yet. Electron-builder falls back gracefully but shows a generic icon.

### 5. macOS notarization not set up

`SKIP_NOTARIZATION=true` in CI. Gatekeeper blocks the app on macOS 10.15+. Users right-click → Open to bypass.

---

## Key architectural decisions (not obvious from code)

- **Port 47380** is hardcoded in both `localServer.ts` and `DirectoryBrowserTab.tsx`. See Known Quirks #32.
- **`helperAvailable` starts as `null`** in DirectoryBrowserTab — prevents double-load on mount. See Known Quirks #31.
- **No SQLite, no keytar** — JSON files for queue, `safeStorage` for creds. See Known Quirks #29, #30.
- **`extraResources`** in electron-builder.yml copies `apps/popdam-helper/resources/` into `process.resourcesPath`.
- **`ia32` permanently removed** from Windows targets. Building ia32 on a 64-bit CI runner causes incomplete Electron download.
- **Supabase proxy enforces statement timeout externally** — `SET LOCAL statement_timeout = 0` inside PL/pgSQL is invisible to it. Batch at client layer. See Known Quirks #33.
- **Windows MAX_PATH (260-char)** hits the Windows Render Agent but not the bridge agent (Linux). Fixed with `\\?\` prefix for PDF/AI; temp-copy for native images (Sharp doesn't reliably support `\\?\`). See Known Quirks #34.
- **OpenRouter-only AI models** — the PDF text AI vision config no longer reads from `AI_MODELS` / `admin_config`. It calls `get-openrouter-vision-models` live. `OPENROUTER_API_KEY` must be set in `admin_config`.
- **Nightly crawl fires at 02:00 UTC** — this is 9pm EST / 10pm EDT. The `cron.timezone` GUC can't be changed without a server restart on this Supabase version, so the schedule is fixed UTC. 1-hour EDT drift is acceptable.
- **Both apps share one Supabase project** (`ryltkzzernhwnojzouyb`). Mode switching is UI-only (reads `window.location.host`). No separate Supabase client per mode.
- **`supabase-popsg/` is dead code** — don't edit or deploy from it.

---

## GitHub release structure (Helper)

Tag: `popdam-helper-latest`

| File | Platform |
|------|----------|
| `POP-DAM-Helper-Windows-Setup.exe` | Windows x64 |
| `POP-DAM-Helper-Mac-arm64.dmg` | macOS Apple Silicon |
| `POP-DAM-Helper-Mac-x64.dmg` | macOS Intel |

---

## Session start checklist

```bash
# 1. Ensure on main and up to date:
git fetch github main
git checkout main
git reset --hard github/main

# 2. Check Supabase MCP is available:
# (tools like execute_sql, apply_migration, list_migrations should appear in tool list)

# 3. Check CI status:
source .env.local 2>/dev/null
curl -s -H "Authorization: token ${GITHUB_PAT}" \
  "https://api.github.com/repos/u2giants/popdam3/actions/runs?branch=main&per_page=3" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for run in data['workflow_runs']:
    print(f\"{run['id']} | {run['name']} | {run['status']} | {run['conclusion']} | {run['head_sha'][:8]}\")
"
```
