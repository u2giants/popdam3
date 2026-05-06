# Infrastructure Reference

This document covers the cloud infrastructure underlying PopDAM: the Supabase project, all Edge Functions, the scheduled job system (pg_cron + pg_net), secrets management (Vault), and the DigitalOcean Spaces thumbnail store.

---

## Supabase Project

PopDAM runs on a single Supabase project. All database tables, edge functions, RLS policies, database functions, and triggers live here.

**Project URL:** `https://ryltkzzernhwnojzouyb.supabase.co`

**Database:** PostgreSQL (managed by Supabase). Extensions in use:
- `pg_cron` — scheduled SQL jobs (in `extensions` schema)
- `pg_net` — HTTP requests from inside PostgreSQL (in `extensions` schema)
- `pg_trgm` — trigram indexes for full-text search on filenames
- `pgcrypto` — used for `gen_random_uuid()`
- `pgsodium` / Vault — secrets management

---

## DigitalOcean Spaces (Thumbnail Storage)

Thumbnails are NOT stored in Supabase Storage. They are uploaded directly by the Bridge Agent and Windows Render Agent to DigitalOcean Spaces (S3-compatible).

- **Bucket:** `popdam` (configured in `admin_config.SPACES_CONFIG`)
- **Region:** `nyc3`
- **Public base URL:** `https://popdam.nyc3.digitaloceanspaces.com`
- **Path format:** `thumbnails/{asset_id}.jpg`
- **Cache headers set by agent:** `Cache-Control: public, max-age=31536000, immutable`

The full URL is stored in `assets.thumbnail_url`. The UI always loads thumbnails from this URL — it never proxies through Supabase.

**Secrets:** `DO_SPACES_KEY` and `DO_SPACES_SECRET` are stored only in the agent's local `.env` file on the NAS. They are never stored in `admin_config` and are never returned by any API.

---

## Railway Worker

All batch AI operations are handled by a persistent Node.js worker running on Railway, **not** by Supabase edge functions. The edge functions (`ai-tag`, `bulk-job-runner`) are legacy stubs or supporting roles.

**Repo path:** `apps/worker/`

**Deployment:** Railway auto-deploys from the `main` branch on every push. No manual step required. Railway detects changes and rebuilds.

**Operations handled by the Railway worker:**
- AI image tagging (`ai-tag-untagged`, `ai-tag-all`, `ai-tag-groups`)
- Style group rebuild, reconcile, cleanup-mega-group-tags, relink-orphaned-assets
- Tag propagation (`propagate-group-tags`)
- ERP enrichment and ERP AI classification
- Metadata reprocessing and SKU backfill (worker calls admin-api per batch)

**How it works:** The worker polls `admin_config.BULK_OPERATIONS` every 5 seconds, picks up any operation with `status: "running"`, executes one batch, and writes progress back. The UI writes `status: "running"` to start an op; the worker detects it and runs it.

### Railway Environment Variables

The worker reads configuration from Railway environment variables, **not from `admin_config`**. The following must be set in Railway → your worker service → Variables:

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `OPENROUTER_API_KEY` | Yes | OpenRouter key for AI tagging and ERP classification |
| `GOOGLE_AI_API_KEY` | No | Legacy fallback if no OpenRouter key |

**Critical:** `OPENROUTER_API_KEY` in Railway and `OPENROUTER_API_KEY` in `admin_config` are **two separate things** that serve different consumers:

| Location | Consumer | How it gets there |
|---|---|---|
| `admin_config.OPENROUTER_API_KEY` | Bridge/Windows agents | Sent in agent-api heartbeat response |
| Railway ENV `OPENROUTER_API_KEY` | Railway worker | Read directly from `process.env` at startup |

If you set the key in the popdam admin UI (Settings → AI Models), it only updates `admin_config`. The Railway worker will NOT pick it up until you also set it in Railway's dashboard.

### AI Model Configuration

The worker reads `admin_config.AI_TASK_MODELS` for the model to use per task:

```json
{
  "vision_tagging": "google/gemini-2.0-flash-001",
  "text_classification": "anthropic/claude-3.5-haiku",
  "pdf_extraction": "google/gemini-2.0-flash-001"
}
```

These are OpenRouter model IDs. If not set, the worker falls back to `DEFAULT_VISION_MODEL = "google/gemini-2.0-flash-001"`. Configure via Settings → AI Models in the admin UI — the dropdowns are populated live from your OpenRouter account's enabled models.

---

## Scheduled Jobs (pg_cron + pg_net)

### Setup

pg_cron and pg_net are enabled via migration:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
```

These extensions are still present but pg_cron is **not used for bulk job scheduling** — see note below.

### bulk-job-runner Schedule — REMOVED

The pg_cron job that called `bulk-job-runner` every minute was **removed in migration `20260322000000_disable-bulk-job-runner-cron`**. All bulk processing is now handled by the persistent Railway worker (`apps/worker/`), which polls every 5 seconds and has no 60-second timeout constraint.

The historical cron definition was:
```sql
-- REMOVED — kept here for reference only. Do not re-add.
select cron.schedule(
  'invoke-bulk-job-runner',
  '* * * * *',
  $$ select net.http_post(url := '...bulk-job-runner', ...) $$
);
```

The `bulk-job-runner` edge function itself is still deployed as a no-op stub (returns `{ ok: true }`). Do not add logic to it — it would conflict with the Railway worker.

### Vault Secret Setup

The service role key is stored in Supabase Vault for use by any pg_cron jobs that may be added in the future:

1. Supabase Dashboard → Settings → Vault
2. New Secret → Name: `SUPABASE_SERVICE_ROLE_KEY` → Value: your service role key
3. Access via `vault.decrypted_secrets` in SQL

---

## Edge Functions

There are 11 Edge Functions. All are deployed to Supabase Edge Runtime (Deno).

---

### 0. `helper-api`

**Purpose:** All communication between the POP DAM Helper (Electron desktop app) and the cloud, plus token generation from the web DAM.

**Auth:** User JWT (Bearer token) for all routes. No agent key — the Helper authenticates as the logged-in user.

**Routes:**

| Method | Path | Caller | Purpose |
|--------|------|--------|---------|
| `POST` | `/register-device` | Helper | Register or update this device on first run / version change |
| `GET` | `/config` | Helper | Fetch root mappings + Synology URL + DAM URL on startup |
| `POST` | `/tokens` | Web DAM | Generate a short-lived `popdam://` one-time token for a checkout/checkin action |
| `POST` | `/checkouts/start` | Helper | Validate token, check for conflicting checkout, create `asset_checkouts` row |
| `POST` | `/checkouts/prepare-checkin` | Helper | Validate snapshot hash, return upload path instructions |
| `POST` | `/checkouts/complete-checkin` | Helper | Record final hash + file size, set checkout to `complete`, unlock asset |
| `POST` | `/checkouts/discard` | Helper or web | Abandon a checkout, set status to `discarded` |
| `POST` | `/checkouts/heartbeat` | Helper | Keep checkout alive, update `last_heartbeat_at` |
| `GET` | `/checkouts/open` | Helper | List user's active checkouts on startup (to resume watchers) |
| `POST` | `/logs` | Helper | Store audit / error events |

**Token flow:** The web DAM calls `POST /tokens` with `{ action, asset_id }`. The function writes a row to `helper_tokens` (32-char random hex, 5-minute TTL) and returns a `popdam://action?token=X&assetId=Y` URL. The OS hands this URL to the running Helper. The Helper calls `/checkouts/start` with the token — which validates it is unused and unexpired, then marks it consumed.

**Race condition on start:** If two users click "Check Out" simultaneously, `/checkouts/start` handles the race via a unique partial index on `asset_checkouts(asset_id) WHERE status IN ('active', 'checkin_queued', 'uploading', 'verifying')`. The second request gets a `23505` unique violation and returns a `409 Conflict` with the existing checkout's owner info.

**DB tables:** `helper_devices`, `helper_tokens`, `asset_checkouts` (added in migration `20260506004845`). See `docs/SCHEMA.md` for column details.

---

### 1. `admin-api`

**Purpose:** Central admin command router. All admin UI operations call this function.

**Auth:** User JWT + admin role check. Server-to-server calls may use the service role key.

**Pattern:** Single endpoint, action-based routing. Body must contain `"action": "<action-name>"`.

**Handler modules** (in `supabase/functions/_shared/admin-handlers/`):
- `agent-handlers.ts` — agent management, scan control, render queue, clear-failed-sg-renders
- `ai-tagging-handlers.ts` — count-untagged-assets (bulk tagging ops moved to Railway worker)
- `tag-propagation-handlers.ts` — bulk-propagate-group-tags, count-groups-for-propagation
- `erp-handlers.ts` — apply-erp-enrichment, classify-erp-categories
- `erp-browse-handlers.ts` — trigger-erp-sync, erp-sync-runs, erp-review-queue, erp-review-action, erp-items-browse
- `metadata-handlers.ts` — reprocess-asset-metadata, backfill-sku-names
- `purge-handlers.ts` — purge-old-assets
- `install-bundle-handler.ts` — generate-install-bundle
- `tiff-handlers.ts` — TIFF scan and optimization
- `sibling-scan-handlers.ts` — sibling image discovery and ingest
- `hygiene-handlers.ts` — file hygiene scanning
- `coldlion-handlers.ts` — ColdLion API integration

Note: `style-group-handlers.ts` was deleted — rebuild-style-groups, reconcile-style-group-stats, cleanup-mega-group-tags, and relink-orphaned-assets are now handled directly by the Railway worker (`apps/worker/src/handlers/style-groups.ts`, `relink-orphaned.ts`).

See `docs/ADMIN_OPERATIONS.md` for the complete route reference.

---

### 2. `agent-api`

**Purpose:** All communication from the Bridge Agent (NAS) and Windows Render Agent flows through this function. It is the only entry point for agents.

**Auth:** `x-agent-key` header (raw key hashed with SHA-256 and compared against `agent_registrations.agent_key_hash`). No JWT.

**Key routes:**
- `POST /agent/register` — first-time registration with raw key
- `POST /agent/bootstrap` — pairing-code based first-time registration
- `POST /agent/heartbeat` — liveness signal + counter update. Returns full config payload including scanning roots, resource limits, DigitalOcean Spaces config (non-secret fields), scan commands, and update requests.
- `POST /agent/ingest` — ingest or update a single asset (idempotent)
- `POST /agent/scan-progress` — report scan session progress
- `POST /agent/queue-render` — queue a file for Windows Render Agent
- `POST /agent/claim-render` — Windows agent claims next pending render job
- `POST /agent/complete-render` — Windows agent reports render result

---

### 3. `ai-tag`

**Status: Legacy / PDF extraction only.**

This edge function originally handled AI tagging but that work was moved to the Railway worker (`apps/worker/`). The `ai-tag` function now serves as a helper called by the Windows agent for PDF text extraction (via `Deno.env.get("GOOGLE_AI_API_KEY")`). It calls Google's Gemini API directly — it does **not** use OpenRouter.

**Do not add batch AI tagging logic here.** All batch operations belong in the Railway worker.

---

### 4. `bulk-job-runner`

**Status: No-op stub.** Returns `{ ok: true, message: "replaced by railway worker" }`.

The pg_cron schedule that called this function every minute was removed via migration `20260322000000_disable-bulk-job-runner-cron`. All batch processing is now handled by the persistent Railway worker (`apps/worker/`), which has no 60-second timeout constraint and runs continuously.

The stub is kept deployed so any stale references to this function URL return a clean 200 rather than a 404.

---

### 5. `erp-sync`

**Purpose:** Fetches item data from the DesignFlow ERP API and stages it in the local database.

**Auth:** Service role key (triggered by `trigger-erp-sync` admin-api action).

**ERP source:** `https://api.item.designflow.app/lib/getApiAllItems`

**Process:**
1. Create an `erp_sync_runs` row with status `running`.
2. Fetch all items from the ERP API (or incremental from watermark date in `admin_config.ERP_LAST_SYNC_DATE`).
3. Validate each item with Zod schema.
4. Insert raw payloads into `erp_items_raw` (immutable audit log, one row per item per sync).
5. Upsert normalized data into `erp_items_current` (one row per `external_id`).
6. Extract MG01–MG06 codes, size code, licensor code, property code, division code.
7. Items before `ERP_CATEGORY_CUTOFF_DATE` have `mg_category` set to NULL (legacy items need AI classification).
8. Items before `INGESTION_MIN_DATE` ("2020-01-01") are filtered out.
9. Update watermark `ERP_LAST_SYNC_DATE` on success.
10. Update `erp_sync_runs` row with final counts and status.

---

### 6. `send-invite-email`

**Purpose:** Sends an invitation email to a new user via the Brevo transactional email API.

**Auth:** Service role key (called internally by admin-api `invite-user` action).

**Requires:** `BREVO_API_KEY` environment variable.

**Input:** `{ email, invitation_id }`

---

### 7. `sync-external`

**Purpose:** Synchronizes licensors, properties, and characters from external taxonomy APIs.

**Auth:** User JWT + admin role.

**Sources:** Configurable via `admin_config`; defaults to Disney, Marvel, WWE via `https://api.sandbox.designflow.app/api/autofill/properties-and-characters`.

**Process:**
- Upserts licensors (by `external_id`).
- Upserts properties in batches of 200 (by `external_id`).
- Upserts characters in batches of 200 (by `external_id`).

**Actions:** `sync-all` (all licensors) or `sync-one` (single licensor by external_id).

---

### 8. `export-sql-dump`

**Purpose:** Exports the database as chunked SQL INSERT files for cloud-to-cloud migration.

**Auth:** Admin JWT or service role key.

**Usage:**
- `GET ?action=manifest` — returns JSON with table names and row counts.
- `GET ?table=<name>&offset=<n>` — returns a SQL file with `INSERT` statements for that chunk.

Each chunk is a self-contained transaction. Tables are exported in dependency order (parents before children). Default chunk size: 5,000 rows, max 10,000.

---

### 9. `export-table`

**Purpose:** Exports individual tables as CSV or JSON, bypassing the 1,000-row Supabase/Lovable Cloud limit.

**Auth:** Admin JWT or service role key.

**Supported tables:** `assets`, `style_groups`, `erp_items_current`, `erp_items_raw`, `hygiene_findings`, and 50+ others.

**Output:** CSV with headers or JSON array. Internally paginates with 1,000 rows per page.

---

### 10. `export-thumbnail-manifest`

**Purpose:** Exports a flat CSV manifest of all asset thumbnail URLs for migration.

**Auth:** Admin JWT or service role key.

**Output columns:** `old_asset_id`, `relative_path`, `filename`, `quick_hash`, `thumbnail_url`.

Filters to non-deleted assets with non-null `thumbnail_url`.

---

## Database Triggers

Eight triggers maintain derived data automatically:

### `trg_compute_primary_sort_tier`
- **Table:** `assets`
- **Fires:** BEFORE INSERT OR UPDATE of `thumbnail_url`, `file_type`, `filename`
- **Action:** Computes `assets.primary_sort_tier` (integer 1–8) based on filename patterns and thumbnail presence. Lower = better. Used by group stat reconciliation to select the primary asset. See `docs/STYLE_GROUPS.md` for tier definitions.

### `trg_sync_asset_tags`
- **Table:** `asset_tags`
- **Fires:** AFTER INSERT OR DELETE
- **Action:** Rebuilds the `assets.tags` text array from the `asset_tags` table for the affected asset. This keeps a denormalized array on the asset row for fast filtering without joining.

### `trg_sync_designer_to_style_group`
- **Table:** `assets`
- **Fires:** AFTER UPDATE of `designer_name`, `technical_designer_name`, `freelancer_name`
- **Action:** Rolls up designer names to the `style_groups` row. Sets `designer_conflict = true` if member assets disagree. See `docs/STYLE_GROUPS.md`.

### `trg_sync_cover_description_to_style_group`
- **Table:** `assets`
- **Fires:** AFTER UPDATE of `cover_description`
- **Action:** Propagates the primary asset's `cover_description` to `style_groups.cover_description`.

### `trg_auto_queue_render`
- **Table:** `assets`
- **Fires:** AFTER INSERT OR UPDATE of `thumbnail_error`
- **Action:** When `thumbnail_error` is set (non-null), automatically inserts a `render_queue` row for the asset so the Windows Render Agent can process it. Skips if a pending or claimed render job already exists.

### `trg_sync_primary_on_thumbnail`
- **Table:** `assets`
- **Fires:** AFTER UPDATE of `thumbnail_url`
- **Action:** When a thumbnail URL is set on an asset, recalculates whether that asset should become the `primary_asset_id` for its style group (using `primary_sort_tier` order).

### `update_style_groups_updated_at`
- **Table:** `style_groups`
- **Fires:** BEFORE UPDATE
- **Action:** Sets `updated_at = now()`.

### `set_erp_items_current_updated_at`
- **Table:** `erp_items_current`
- **Fires:** BEFORE UPDATE
- **Action:** Sets `updated_at = now()`.

---

## Key PostgreSQL Functions

### `propagate_group_tags_batch(p_cursor uuid, p_batch_size int)`
Propagates AI tags, characters, and metadata from the primary asset to all sibling assets in a batch of style groups. Uses `FOR UPDATE SKIP LOCKED` on the assets UPDATE CTE to avoid lock contention with concurrent AI tagging.

See migration `20260405213154_propagate_group_tags_batch_skip_locked.sql` and `docs/BULK_JOBS.md`.

### `assign_assets_to_style_groups()`
Called during `rebuild-style-groups` Stage 3. Extracts the SKU from each asset's filename, creates style_groups rows, and sets `assets.style_group_id`.

### `update_bulk_operation(p_key, p_state, p_only_if_status)`
Atomic JSON merge for `admin_config` `BULK_OPERATIONS` state. Supports an optimistic `p_only_if_status` guard to prevent a stale write from overwriting a user stop.

### `claim_jobs(job_type, agent_id, batch_size)`
Claims pending processing_queue or render_queue jobs using `FOR UPDATE SKIP LOCKED`. Used by the Bridge Agent and Windows Render Agent.

### `reset_stale_jobs(job_type, stale_minutes)`
Releases jobs that have been in `claimed` or `processing` status for longer than `stale_minutes` back to `pending`.

### `has_role(user_id, role_name)`
Helper used in RLS policies. Returns true if the user has the specified role.
