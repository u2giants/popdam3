# PopSG — Licensor Style Guide Library

## What is PopSG?

PopSG is the licensor-facing side of the Designflow platform. Where PopDAM is a licensed-product DAM (SKUs, ERP, render pipeline), PopSG is a read-only style guide library: licensors browse PDF/AI style guides organised by licensor → property → folder.

**One Docker image, two tenants.** Traefik routes `dam.designflow.app` to PopDAM and `sg.designflow.app` to PopSG. The app reads `window.location.host` at runtime and switches Supabase client, routes, and UI. See `src/lib/app-mode.ts`.

| | PopDAM | PopSG |
|---|---|---|
| Host | `dam.designflow.app` | `sg.designflow.app` |
| Supabase project | `ryltkzzernhwnojzouyb` | `eeueczxhezfhyrhdmidg` |
| Edge functions | `supabase/functions/` | `supabase-popsg/functions/` |
| Deploy workflow | `deploy-supabase.yml` (push-triggered) | `deploy-popsg-supabase.yml` (manual only) |
| Main table | `assets` | `style_guide_files` |
| Agent job | Thumbnail render + AI tag | Style guide crawl |

---

## PopSG Supabase Schema

Key tables in the popsg Supabase project (`eeueczxhezfhyrhdmidg`):

| Table | Purpose |
|---|---|
| `style_guide_files` | One row per file discovered on NAS. `is_active=true` = present in latest crawl. |
| `style_guide_crawl_runs` | One row per crawl run (started, completed, file count). |
| `agent_registrations` | Bridge agents that have paired. Keyed by `agent_key_hash`. |
| `agent_pairings` | One-time pairing codes (15-min TTL). Created by the admin UI; consumed by the agent. |
| `admin_config` | Key/value config store. Keys used by PopSG: `scan_roots`, `STYLE_GUIDE_CRAWL_REQUEST`, `SCAN_PROGRESS`, `POLLING_CONFIG`. |
| `profiles`, `user_roles`, `app_access` | Auth/RBAC — same pattern as PopDAM. |

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
| `licensor_name` | Server-derived: `path_segments[0]` |
| `property_name` | Server-derived: `path_segments[1]` |
| `depth` | Server-derived: segment count |
| `normalized_name` | Server-derived: lowercased, non-alphanum stripped |

---

## Edge Functions

Functions live in `supabase-popsg/functions/` — a **separate directory** from `supabase/functions/` so the popdam deploy workflow never picks them up.

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

> Note: Pairing code creation and agent listing are done directly from the UI via the Supabase JS client with RLS — no edge function needed for those reads/writes.

---

## Deploying Edge Functions

### Prerequisites — GitHub Secrets

Add these three secrets to the `u2giants/popdam3` repo before triggering the workflow:

| Secret | Value |
|---|---|
| `POPSG_SUPABASE_ACCESS_TOKEN` | Personal access token from supabase.com → Account → Access Tokens |
| `POPSG_SUPABASE_PROJECT_ID` | `eeueczxhezfhyrhdmidg` |
| `POPSG_SUPABASE_DB_PASSWORD` | Database password for the popsg project |

### Triggering

Go to Actions → "Deploy PopSG Supabase (Edge Functions)" → Run workflow. It is **manual only** — no push trigger — so it will never run automatically.

---

## Pairing a Bridge Agent

The same binary that runs as the PopDAM bridge agent can serve PopSG as a second tenant. The agent reads a `TENANTS` environment variable listing one config block per tenant.

### Step 1 — Generate a pairing code in the UI

In the PopSG Settings page (`sg.designflow.app/settings`), enter an agent name (e.g. `bridge-popsg-nas`) and click "Generate code". A 15-minute pairing code appears.

### Step 2 — Add the PopSG tenant to docker-compose.yml

Add a second entry in the bridge agent's `TENANTS` env var. The agent will call `pair` on startup for any tenant that doesn't yet have a stored key.

```yaml
# Example addition to your Synology NAS docker-compose.yml
services:
  bridge-agent:
    image: ghcr.io/u2giants/popdam3/bridge-agent:latest
    environment:
      # Existing PopDAM tenant
      TENANT_1_NAME: bridge-nas
      TENANT_1_API_URL: https://ryltkzzernhwnojzouyb.supabase.co/functions/v1/agent-api
      TENANT_1_PAIRING_CODE: ""          # leave empty after first pair
      TENANT_1_AGENT_KEY: "..."          # stored after first pair

      # New PopSG tenant
      TENANT_2_NAME: bridge-popsg-nas
      TENANT_2_API_URL: https://eeueczxhezfhyrhdmidg.supabase.co/functions/v1/agent-api
      TENANT_2_PAIRING_CODE: "ABCD-EFGH-IJKL-MNOP"   # from Settings page
      TENANT_2_AGENT_KEY: ""             # filled by agent after pairing

      # Shared NAS mount
      NAS_MOUNT: /nas
    volumes:
      - /volume1:/nas:ro
```

### Step 3 — Restart the container

```bash
docker compose up -d bridge-agent
```

The agent pairs against the popsg project on first start, stores the key, and begins heartbeating. Trigger the first crawl from the PopSG Settings page or via the admin-api `trigger-scan` action.

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
- **Email/password**: No email/password users in the DB. Enable in the Dashboard (Auth → Providers) if needed.
- **Redirect URLs**: Verify `https://sg.designflow.app/**` and `https://sg.designflow.app/auth/callback` are listed under Auth → URL Configuration in the Supabase Dashboard.
