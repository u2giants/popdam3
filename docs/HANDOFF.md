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

### PopSG render pipeline — full pass (Windows Agent v0.14.2)

All coding work on the render pipeline is now done. Windows Agent is on **v0.14.2**.

| Change | Detail |
|--------|--------|
| **EPS support** | `'eps'` added to `queue_sg_render_jobs_by_ids`, `get_sg_preview_stats`, `retry_sg_render_errors`. Render path: GS → Inkscape → sibling. Migration: `20260507231540_sg_render_eps_support.sql`. Was: 23,242 files classified as `unsupported`. |
| **`shouldSkipPath` removed from `processSgJob`** | The shared blocklist includes `_old`, which blocked 517 style guide files in `_Old/` season folders. Fix: removed `shouldSkipPath` from the render agent — the crawler is the gatekeeper. If it ingested a file, the renderer renders it. Windows agent v0.14.1 |
| **CMYK/Lab PSD fix** | Added `-colorspace sRGB` to `renderWithImageMagick`. IM was exiting 1 with no stderr for CMYK PSDs. Fixes ~683 files. Windows agent v0.14.2 |
| **CMYK native image fallback** | `renderNativeImage` now falls back to ImageMagick (with `-colorspace sRGB`) when Sharp fails. Fixes ~47 CMYK TIFFs/JPEGs. Windows agent v0.14.2 |
| **`renderNativeImage` long-path fix** | Switched from `withLongPathPrefix` on Sharp to temp-copy pattern for paths >230 chars (Sharp/libvips doesn't reliably support `\\?\` prefix). Windows agent v0.13.2 |
| **Retry All batching** | `retry_sg_render_errors(p_limit int DEFAULT 500)` — client loops in 500-file batches. Migration: `20260507000346_retry_sg_render_errors_batched.sql` |
| **DB indexes** | `idx_sgf_render_errored` + `idx_sgrq_file_status`. Migration: `20260506152614_sg_render_retry_indexes.sql` |

### Settings reorganization, PDF text extraction, checkout/check-in bar

- Settings: 9 tabs → 7 tabs with search bar
- PDF text: "Run Full Scan" button, placeholder candidates grid, live OpenRouter vision model picker
- Asset cards: right-click context menu + checkout/check-in bar in detail panel header

### Helper app auth + icon

- Email+password sign-in flow (anon key from `dam-config.json`, creds in `safeStorage`)
- `HelperPasswordCard` for Google SSO users to attach a password
- `icon.png` upscaled to 512×512 (electron-builder converts to `.ico`/`.icns` internally — no separate icon files needed)

### Auto-update

`electron-updater` is already installed and wired. `main.ts` calls `autoUpdater.checkForUpdatesAndNotify()`. The only remaining step is external: get code signing certs and set GitHub Actions secrets.

---

## What is NOT done yet

### 1. PopSG — run Retry All (operational, not coding)

Windows Agent is on **v0.14.2** with all render fixes deployed. The next step is operational:

1. **Confirm windows-agent is on v0.14.2** — check Settings → Agents → Windows Agent version.
2. **Run Retry All** — PopSG Settings → Files with Render Errors → "Retry All". It loops in 500-file batches automatically.
3. **Also queue the EPS files** that were previously `unsupported_extension` (not `render_failed`) — these need a separate queue pass, not just a retry. Use `queue_sg_render_jobs_by_ids` or the "Queue All Renderable" button if one exists.
4. **Check results** — expect EPS, CMYK PSD, long-path native images, and `_Old` folder files to resolve substantially.

**Remaining unresolvable categories (accept as-is):**
- `render_failed` — AI no PDF compat layer (~25): Inkscape also fails
- `missing_file_on_disk` (~3,264): Fresh crawl will mark `is_active = false`
- `unsupported_extension` — ZIP, fonts, video, 3D (~2,076): intentional
- `other_error` — multi-channel TIFF (non-4-channel) (~30): Sharp limitation; ImageMagick may help for 4-channel CMYK but exotic channel counts are hopeless
- `other_error` — corrupt JPEG/TIFF (~17): genuinely corrupt

**Relevant DB objects:**
- `retry_sg_render_errors(p_file_ids uuid[] DEFAULT NULL, p_limit int DEFAULT 500)` — clears `thumbnail_error`, re-queues
- `queue_sg_render_jobs_by_ids(p_file_ids uuid[])` — inserts into `style_guide_render_queue`; checks allowlist
- `get_sg_preview_stats()` — returns `total_active`, `has_preview`, `renderable_no_preview`, `render_errored`, `unsupported`, `queued_now`

Supabase project: `ryltkzzernhwnojzouyb` (popdam-prod).

---

### 2. Auto-update (blocked on code signing)

`electron-updater` is wired. The `publish` block in `electron-builder.yml` is ready. Blocked on certs.

| Platform | Requirement | Cost |
|----------|-------------|------|
| macOS | Apple Developer account + notarization | $99/yr |
| Windows OV cert | Auto-update works; SmartScreen warns on first install | ~$60–$150/yr |
| Windows EV cert | No SmartScreen warning, silent updates | ~$300–$500/yr |

**To activate once signed:**
1. Add GitHub Actions secrets: `CSC_LINK`, `CSC_KEY_PASSWORD` (Windows); `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (Mac)
2. Remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from CI env (`publish-popdam-helper.yml`)

### 3. macOS notarization not set up

Gatekeeper blocks the app on macOS 10.15+. Users right-click → Open to bypass. Blocked on same Apple Developer account as auto-update.

### 4. PDF text extraction — not yet production-validated

The pipeline is built. To run it:
- Set `OPENROUTER_API_KEY` in `admin_config` (Settings → AI Models)
- Select AI vision model in Settings → Processing → PDF Text → AI Vision Config
- Run full scan: Settings → Processing → PDF Text → "Run Full Scan"
- Review placeholder candidates grid for false positives

---

## Key architectural decisions (not obvious from code)

- **Port 47380** is hardcoded in both `localServer.ts` and `DirectoryBrowserTab.tsx`. See Known Quirks #32.
- **`helperAvailable` starts as `null`** in DirectoryBrowserTab — prevents double-load on mount. See Known Quirks #31.
- **No SQLite, no keytar** — JSON files for queue, `safeStorage` for creds. See Known Quirks #29, #30.
- **`extraResources`** in electron-builder.yml copies `apps/popdam-helper/resources/` into `process.resourcesPath`.
- **`ia32` permanently removed** from Windows targets. Building ia32 on a 64-bit CI runner causes incomplete Electron download.
- **Supabase proxy enforces statement timeout externally** — `SET LOCAL statement_timeout = 0` inside PL/pgSQL is invisible to it. Batch at client layer. See Known Quirks #33.
- **Windows MAX_PATH (260-char)** hits the Windows Render Agent but not the bridge agent (Linux). Fixed with `\\?\` prefix for PDF/AI; temp-copy for native images (Sharp doesn't reliably support `\\?\`). See Known Quirks #34.
- **SG crawler has its own path filter** (`style-guide-crawler.ts`) — does NOT use the shared `shouldSkipPath` from `packages/path-filters`. The render agent used to run `shouldSkipPath` on SG jobs too, blocking `_Old` folders that the crawler had already ingested. This was fixed in v0.14.1: render agent no longer calls `shouldSkipPath` for SG jobs.
- **EPS render path skips AI compat pre-check** — all EPS start with `%!PS-Adobe-` without `%PDF-`, which `isAiWithoutPdfCompat` would falsely flag as "no PDF compat", causing GS to be skipped. The EPS branch in `renderFile` bypasses this check entirely.
- **CMYK fix via `-colorspace sRGB`** — added to both `renderWithImageMagick` (PSDs) and `renderWithImageMagickNative` (TIFFs/JPEGs). Without this flag, IM exits 1 with no stderr on CMYK inputs.
- **OpenRouter-only AI models** — the PDF text AI vision config no longer reads from `AI_MODELS` / `admin_config`. It calls `get-openrouter-vision-models` live.
- **Nightly crawl fires at 02:00 UTC** — 9pm EST / 10pm EDT. `cron.timezone` can't be changed without a server restart.
- **Both apps share one Supabase project** (`ryltkzzernhwnojzouyb`). Mode switching is UI-only.
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
PAT=$(git remote get-url github | grep -oP 'ghp_[^@]+')
curl -s -H "Authorization: token ${PAT}" \
  "https://api.github.com/repos/u2giants/popdam3/actions/runs?branch=main&per_page=3" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for run in data['workflow_runs']:
    print(f\"{run['id']} | {run['name']} | {run['status']} | {run['conclusion']} | {run['head_sha'][:8]}\")
"
```
