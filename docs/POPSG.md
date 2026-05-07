# PopSG — Licensor Style Guide Library

## What is PopSG?

PopSG is the licensor-facing side of the Designflow platform. Where PopDAM is a licensed-product DAM (SKUs, ERP, render pipeline), PopSG is a read-only style guide library: licensors browse PDF/AI style guides organised by licensor → property → folder.

**One Docker image, two tenants, one Supabase project.** Both `dam.designflow.app` and `sg.designflow.app` run from the same container and connect to the same Supabase project (`ryltkzzernhwnojzouyb`). Mode detection in `src/lib/app-mode.ts` reads `window.location.host` and switches routes and UI — it does **not** switch Supabase clients.

| | PopDAM | PopSG |
|---|---|---|
| Host | `dam.designflow.app` | `sg.designflow.app` |
| Supabase project | `ryltkzzernhwnojzouyb` | `ryltkzzernhwnojzouyb` (same) |
| Edge functions | `supabase/functions/` | `supabase/functions/` (same) |
| Deploy workflow | `deploy-supabase.yml` (push-triggered) | `deploy-supabase.yml` (same) |
| Main table | `assets` | `style_guide_files` |
| Agent job | Thumbnail render + AI tag | Style guide crawl |

> **`supabase-popsg/` is dead code.** It was a separate Supabase project (`eeueczxhezfhyrhdmidg`) that predates consolidation. The directory still exists in the repo but its edge functions are not deployed and its workflow (`deploy-popsg-supabase.yml`) is not used. Do not edit or deploy from it.

---

## PopSG Schema

Key tables in the shared Supabase project:

| Table | Purpose |
|---|---|
| `style_guide_files` | One row per file discovered on NAS. `is_active=true` = present in latest crawl. |
| `style_guide_folders` | View returning DISTINCT `licensor_name, property_folder` pairs for the sidebar tree. |
| `style_guide_crawl_runs` | One row per crawl run (started, completed, file count). |
| `agent_registrations` | Bridge agents that have paired. Keyed by `agent_key_hash`. |
| `agent_pairings` | One-time pairing codes (15-min TTL). |
| `admin_config` | Key/value config store. PopSG keys: `scan_roots`, `STYLE_GUIDE_CRAWL_REQUEST`, `SCAN_PROGRESS`, `POLLING_CONFIG`. |
| `app_access` | Per-user app entitlement. Values: `popdam`, `styleguides`. |

### `style_guide_files` columns

The server derives most metadata from the file path on ingest — the agent only sends raw file data:

| Column | Source |
|---|---|
| `root_label` | Agent — name of the scan root (e.g. `styleguides-nas`) |
| `relative_path` | Agent — path relative to scan root |
| `filename` | Agent |
| `size_bytes`, `modified_at`, `quick_hash` | Agent |
| `path_segments` | Server-derived: `relative_path.split("/")` |
| `directory_path` | Server-derived: all segments except filename |
| `licensor_name` | Generated column: `split_part(relative_path, '/', 1)` |
| `property_folder` | Server-derived: second path segment |
| `style_guide_folder` | Server-derived: third path segment |
| `depth` | Server-derived: segment count |
| `normalized_name` | Server-derived: lowercased, non-alphanum stripped |
| `thumbnail_url` | Set by Windows Render Agent on success; `null` = no preview yet |
| `thumbnail_error` | Set by Windows Render Agent on failure; see KNOWN_QUIRKS.md #23 for breakdown of failure categories |

---

## Edge Functions

All PopSG edge functions live in `supabase/functions/` — the same directory as PopDAM's. The same `deploy-supabase.yml` workflow deploys them.

### `agent-api` (no JWT verify — uses x-agent-key)

| Action | Auth | Description |
|---|---|---|
| `pair` | none | Consume pairing code, register agent, return permanent `agent_key` |
| `heartbeat` | agent key | Update agent health, return `scan_roots` + any pending crawl command |
| `scan-progress` | agent key | Write `SCAN_PROGRESS` to `admin_config` |
| `claim-style-guide-crawl` | agent key | Claim `STYLE_GUIDE_CRAWL_REQUEST`, create `style_guide_crawl_runs` row |
| `complete-style-guide-crawl` | agent key | Upsert file batches, finalize run on `done=true` |

### `admin-api` (JWT + admin role)

| Action | Description |
|---|---|
| `doctor` | Returns agents, last crawl run, active file count, current config |
| `trigger-scan` | Writes `STYLE_GUIDE_CRAWL_REQUEST` to `admin_config` |
| `get-scan-status` | Returns crawl request state, scan progress, and 5 most recent runs |

---

## Pairing a Bridge Agent

The same bridge agent binary serves PopSG. It uses the PopDAM project's `agent-api` edge function.

### Step 1 — Generate a pairing code in the UI

In the PopSG Settings page (`sg.designflow.app/settings`), enter an agent name and click "Generate code". A 15-minute pairing code appears.

### Step 2 — Configure the agent

The bridge agent reads `TENANTS` env var or individual `TENANT_n_*` vars. Point it at the PopDAM project's agent-api endpoint:

```yaml
TENANT_1_NAME: bridge-nas
TENANT_1_API_URL: https://ryltkzzernhwnojzouyb.supabase.co/functions/v1/agent-api
TENANT_1_PAIRING_CODE: "ABCD-EFGH-IJKL-MNOP"   # from Settings page
TENANT_1_AGENT_KEY: ""                            # filled by agent after pairing
NAS_MOUNT: /nas
```

### Step 3 — Restart the container

```bash
docker compose up -d bridge-agent
```

The agent pairs on first start, stores the key, and begins heartbeating. Trigger the first crawl from the PopSG Settings page.

---

## Agent Crawl Flow

```
Admin UI / admin-api "trigger-scan"
  └─► writes STYLE_GUIDE_CRAWL_REQUEST { status: "pending" } to admin_config

Bridge agent heartbeat (every 5–30s)
  └─► receives commands.trigger_crawl = true
  └─► calls claim-style-guide-crawl
        ─► creates style_guide_crawl_runs row (status: running)
        ─► returns run_id + roots

Agent walks NAS roots, batching 200 files at a time:
  └─► calls complete-style-guide-crawl { run_id, files: [...], done: false }
        ─► upserts into style_guide_files (server derives path metadata)
  └─► calls scan-progress { session_id, status: "running", counters }

Agent finishes:
  └─► calls complete-style-guide-crawl { run_id, files: [], done: true, total_files: N }
        ─► marks run completed
        ─► marks stale files is_active = false
        ─► updates STYLE_GUIDE_CRAWL_REQUEST { status: "completed" }
  └─► calls scan-progress { session_id, status: "completed" }
```

---

## PopSG Render Pipeline

The Windows Render Agent generates thumbnails for `style_guide_files`. The pipeline is triggered from the PopSG Settings page:

1. Admin clicks "Queue Render Jobs" → calls `queue_sg_render_jobs_by_ids()` (or the queue-all variant) → inserts rows into `style_guide_render_queue`.
2. Windows Agent polls `style_guide_render_queue` for `status = 'pending'` jobs, claims one, renders the file (Sharp / Ghostscript / ImageMagick / Inkscape / Poppler depending on extension), uploads the thumbnail to Supabase Storage, and updates `thumbnail_url` on the file row.
3. Failures set `thumbnail_error` on the file row and the queue job to `status = 'failed'`.
4. Admin clicks "Retry All" on the "Files with Render Errors" tab → calls `retry_sg_render_errors()` in 500-file batches until it returns 0.

**Extension allowlist** (in `queue_sg_render_jobs_by_ids` and `get_sg_preview_stats`): `pdf`, `ai`, `psd`, `jpg`, `jpeg`, `png`, `tif`, `tiff`, `svg`, `indd`, `eps`. Files with unlisted extensions get `thumbnail_error = 'unsupported_extension'` immediately on queue attempt. Note: EPS was added 2026-05-07 (migration `20260507173844`) — about 23,242 files need to be queued and rendered.

**Known large failure categories**: see Known Quirks #23 and #34 for the full breakdown and fixes.

---

## Nightly Crawl

A `pg_cron` job (`nightly-sg-crawl`) fires at **02:00 UTC every day** (= 9pm EST / 10pm EDT). It upserts `STYLE_GUIDE_CRAWL_REQUEST = { status: "pending" }` into `admin_config`. The bridge agent picks this up on its next heartbeat and begins a full crawl.

- The cron expression is UTC-fixed (see Known Quirks #38 for why `cron.timezone` can't be changed)
- Manual trigger still works: Settings → File Health → Style Guide Crawl → "Trigger Crawl"
- The crawl marks stale files `is_active = false` at completion via `sg_staleness_cleanup()`

---

## Auth Configuration

- **Google OAuth**: Enabled.
- **Email/password**: Enabled. Users who sign in via Google OAuth and also need to use the PopDAM Helper can set a password in PopDAM Settings → "Helper App Password" (calls `supabase.auth.updateUser({ password })` — same account, no new user created).
- **Redirect URLs**: Verify `https://sg.designflow.app/**` and `https://sg.designflow.app/auth/callback` are listed under Auth → URL Configuration in the Supabase Dashboard.
- **App access**: Users need an `app_access` row with `app = 'styleguides'` to enter PopSG. The invite flow grants this automatically when the invitation `apps` array includes `'styleguides'`.
