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
| `thumbnail_url` | Not populated — no thumbnail pipeline for PopSG (see KNOWN_QUIRKS.md) |
| `thumbnail_error` | Not populated |

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

## Auth Configuration

- **Google OAuth**: Enabled — `u2giants@gmail.com` successfully signed in.
- **Email/password**: No email/password users in the DB. Enable in Auth → Providers if needed.
- **Redirect URLs**: Verify `https://sg.designflow.app/**` and `https://sg.designflow.app/auth/callback` are listed under Auth → URL Configuration in the Supabase Dashboard.
- **App access**: Users need an `app_access` row with `app = 'styleguides'` to enter PopSG. The invite flow grants this automatically when the invitation `apps` array includes `'styleguides'`.
