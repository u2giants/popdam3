# DATABASE SCHEMA (Postgres / Supabase)

This document is the single source of truth for tables, columns, constraints, indexes, and visibility rules.

Key principle:
- The DB must enforce correctness (especially timestamps and required fields) so the system fails loudly instead of silently drifting.

---
## Timestamp Audit (Recommended)
Store the timestamps the worker observed on disk during ingest:
- `modified_at` and `file_created_at` (already required)
Additionally recommended fields for audit/debug:
- `last_stat_observed_at` (when the worker last checked timestamps)
- `original_mtime_at_processing` / `original_birthtime_at_processing` (optional)
If a timestamp mutation incident occurs, record it in a `worker_incidents` table or an `asset_processing_events` log.


## 1) Enums (Create First)
- `file_type`: `psd`, `ai`
- `asset_status`: `pending`, `processing`, `tagged`, `error`
- `queue_status`: `pending`, `claimed`, `processing`, `completed`, `failed`
- `asset_type`: `art_piece`, `product`
- `art_source`: `freelancer`, `straight_style_guide`, `style_guide_composition`
- `workflow_status`:
  `product_ideas`, `concept_approved`, `in_development`, `freelancer_art`,
  `discontinued`, `in_process`, `customer_adopted`, `licensor_approved`, `other`

---

## 2) Core Tables

### 2.1 licensors
- `id uuid PK`
- `name text NOT NULL`
- `external_id text UNIQUE NULL`
- `created_at timestamptz DEFAULT now()`
- `updated_at timestamptz DEFAULT now()`

### 2.2 properties
- `id uuid PK`
- `licensor_id uuid FK NOT NULL`
- `name text NOT NULL`
- `external_id text UNIQUE NULL`
- timestamps

### 2.3 characters
- `id uuid PK`
- `property_id uuid FK NOT NULL`
- `name text NOT NULL`
- `external_id text UNIQUE NULL`
- timestamps

### 2.4 product_categories / product_types / product_subtypes
As in the build spec (taxonomy tables with optional external_id).

### 2.5 assets (main)
Canonical path storage uses `relative_path` (see PATH_UTILS.md).

Required columns:
- `id uuid PK`
- `filename text NOT NULL`
- `relative_path text NOT NULL`  (canonical, POSIX relative)
- `file_type file_type NOT NULL`
- `file_size bigint DEFAULT 0`
- `width int DEFAULT 0`
- `height int DEFAULT 0`
- `artboards int DEFAULT 1`
- `thumbnail_url text NULL` (full public URL)
- `thumbnail_error text NULL`
- `is_licensed boolean DEFAULT false`
- `licensor_id uuid FK NULL`
- `property_id uuid FK NULL`
- `product_subtype_id uuid FK NULL`
- `asset_type asset_type NULL`
- `art_source art_source NULL`
- `big_theme text NULL`
- `little_theme text NULL`
- `design_ref text NULL`
- `design_style text NULL`
- `ai_description text NULL`
- `scene_description text NULL`
- `tags text[] NOT NULL DEFAULT '{}'::text[]`
- `workflow_status workflow_status DEFAULT 'other'`
- `status asset_status DEFAULT 'pending'`
- Visibility Guard: Add is_deleted boolean DEFAULT false.
- Integrity Guard: Add UNIQUE(share_id, relative_path) to the assets table to prevent duplicate ingestion.

Hashing + scan bookkeeping:
- `quick_hash text NOT NULL`
- `quick_hash_version int NOT NULL DEFAULT 1`
- `last_seen_at timestamptz NOT NULL`
- `modified_at timestamptz NOT NULL`  **NO DEFAULT** (must be supplied by agent from disk)
- `file_created_at timestamptz NULL`  (agent supplies birthtime if available else = modified_at)
- `ingested_at timestamptz DEFAULT now()`
- `created_at timestamptz DEFAULT now()`

Designer metadata (extracted by AI from Tech Pack thumbnails):
- `designer_name text NULL`
- `technical_designer_name text NULL`
- `freelancer_name text NULL`

Hard constraints:
- `modified_at` must be NOT NULL and have no default.
- `relative_path` must be NOT NULL.

### 2.6 asset_characters (join table)
- `asset_id uuid FK ON DELETE CASCADE`
- `character_id uuid FK`
- `UNIQUE(asset_id, character_id)`

### 2.7 asset_path_history
- `id uuid PK`
- `asset_id uuid FK`
- `old_relative_path text`
- `new_relative_path text`
- `detected_at timestamptz DEFAULT now()`

### 2.8 processing_queue
- `id uuid PK`
- `asset_id uuid FK`
- `job_type text`
- `status queue_status DEFAULT 'pending'`
- `agent_id text NULL`
- `claimed_at timestamptz NULL`
- `completed_at timestamptz NULL`
- `error_message text NULL`

### 2.9 render_queue (optional windows render)
- `id uuid PK`
- `asset_id uuid FK`
- `status queue_status DEFAULT 'pending'`
- `claimed_by text NULL`
- `claimed_at timestamptz NULL`
- `completed_at timestamptz NULL`
- `error_message text NULL`

### 2.10 style_groups
- `id uuid PK`
- `sku text NOT NULL`
- `folder_path text NOT NULL`
- `primary_asset_id uuid FK NULL`
- `primary_asset_type text NULL` (mirrors selected primary asset `asset_type` for direct filtering)
- `asset_count int DEFAULT 0`
- `latest_file_date timestamptz NULL`
- `workflow_status workflow_status DEFAULT 'other'`
- licensing + taxonomy summary fields (licensor/property/category/division/MG/size)
- Designer rollup (from member assets, with conflict detection):
  - `designer_name text NULL`
  - `technical_designer_name text NULL`
  - `freelancer_name text NULL`
  - `designer_conflict boolean NOT NULL DEFAULT false` (true when member assets have differing designer names)

### 2.11 agent_registrations
- `id uuid PK`
- `agent_name text NOT NULL`
- `agent_key_hash text UNIQUE NOT NULL`
- `last_heartbeat timestamptz`
- `metadata jsonb NOT NULL DEFAULT '{}'`

### 2.12 profiles / user_roles / invitations
Invitation-only access model:
- profiles: `user_id uuid UNIQUE`, `email text`, `full_name text`, timestamps
- user_roles: `user_id uuid`, `role text`, `UNIQUE(user_id, role)`
- invitations: `id uuid PK`, `email text UNIQUE NOT NULL`, `role text DEFAULT 'user'`, `invited_by uuid NULL`, `created_at`, `accepted_at NULL`

### 2.13 admin_config
- `key text PK`
- `value jsonb NOT NULL`
- `updated_at timestamptz DEFAULT now()`
- `updated_by uuid NULL`

Stores:
- `THUMBNAIL_MIN_DATE`
- `SCAN_MIN_DATE`
- `ERP_LAST_SYNC_DATE` (watermark for incremental ERP sync)
- `ERP_SYNC_ENDPOINT` (override ERP API URL)
- `BULK_OPERATIONS` (JSONB blob tracking all persistent operation state)
- DO Spaces base URL
- taxonomy endpoints
- NAS mapping keys (host/ip/share/mount root)

### 2.14 ERP Tables

#### `erp_sync_runs`
Metadata per sync execution.
- `id uuid PK`, `status text` (running/completed/failed), `started_at`, `ended_at`
- `total_fetched int`, `total_upserted int`, `total_errors int`, `error_samples jsonb`
- `run_metadata jsonb` (sync_mode, start_date, end_date), `created_by text`

#### `erp_items_current`
Latest normalized row per ERP item. Upserted on each sync.
- `id uuid PK`, `external_id text UNIQUE NOT NULL`
- `style_number text`, `item_description text`
- `mg_category text` — category from ERP API ("Wall", "Storage", etc.) — may be null
- `mg01_code text`, `mg02_code text`, `mg03_code text` — **single-character letter/digit codes** resolved from the API
- `mg04_code`, `mg05_code`, `mg06_code` — additional MG levels (rarely populated)
- `size_code`, `licensor_code`, `property_code`, `division_code`, `prepack_code`, `prepack_codes text[]`
- `erp_updated_at timestamptz` — ERP's own last-modified (used as "Created Date" in the browser)
- `synced_at timestamptz`, `sync_run_id uuid FK erp_sync_runs`
- `raw_mg_fields jsonb` — original API values: `mg01`/`mg02`/`mg03` (may be descriptions or codes), plus `mg01_code`/`mg02_code`/`mg03_code` (resolved) and other metadata fields
- `dismissed boolean DEFAULT false` — soft-hide from browser

#### `erp_items_raw`
Immutable snapshot of every ERP API response row.
- `id uuid PK`, `external_id text`, `raw_payload jsonb`, `sync_run_id uuid FK`, `fetched_at timestamptz`

#### `product_category_predictions`
AI classification results for ERP items missing `mg_category`.
- `id uuid PK`, `external_id text`, `erp_item_id uuid FK erp_items_current`
- `predicted_category text`, `confidence real`, `rationale text`
- `classification_source text` (erp/rule/ai), `ai_model text`
- `status text` (pending/auto_applied/approved/rejected/unclassifiable)
- `reviewed_by uuid`, `reviewed_at timestamptz`, `input_context jsonb`

### 2.15 Hygiene & Style Guide Tables

#### `hygiene_findings`
File naming/structure issues found during Windows Agent scans.
- `id uuid PK`, `scan_session_id uuid`, `file_path text`, `finding_type text`, `detail jsonb`, `found_at timestamptz`

#### `style_guide_crawl_runs`
Metadata for each licensor style guide crawl run.
- `id uuid PK`, `status text`, `agent_id text`, `started_at`, `completed_at`, `files_found int`, `error_message text`

#### `style_guide_files`
Crawled style guide PDFs and images from licensors.
- `id uuid PK`, `crawl_run_id uuid FK`, `relative_path text`, `file_type text`, `thumbnail_url text`, `metadata jsonb`, `found_at timestamptz`

#### `tiff_optimization_queue`
Queue for TIFF compression jobs run by the Windows Agent.
- `id uuid PK`, `asset_id uuid FK assets`, `status queue_status`, `claimed_by text`, `claimed_at`, `completed_at`, `error_message text`

---

## 3) Indexes (Performance-Critical)
- btree: `assets(file_type)`, `assets(status)`, `assets(workflow_status)`,
  `assets(is_licensed)`, `assets(modified_at)`, `assets(file_created_at)`,
  `assets(licensor_id)`, `assets(property_id)`, `assets(product_subtype_id)`,
  `assets(quick_hash)`
- GIN: `assets(tags)`
- trigram (pg_trgm): `assets(filename)` and optionally `assets(relative_path)`

---

## 4) Visibility Logic (Centralized and Consistent)
**Visibility is NOT dependent on having a Property or Character link.**

Visible if ANY is true:
- `file_created_at >= THUMBNAIL_MIN_DATE`
- `modified_at >= THUMBNAIL_MIN_DATE`
- `thumbnail_url IS NOT NULL`

Create a single SQL function (or view) used everywhere:
- main asset list query
- filter counts
- total counts

---

## 5) Required Functions / Triggers (High Level)
- `has_role(user_id, role)` for RLS
- `handle_new_user()` trigger: invitation-only enforcement
- queue functions: `claim_jobs(...)` using `FOR UPDATE SKIP LOCKED`, `reset_stale_jobs(...)`
- optional: `get_filter_counts(filters)` and `get_asset_count(filters)` using the same visibility logic

---

## 6) RLS (Row-Level Security) Summary
- Frontend uses RLS-protected access.
- Agents operate through edge functions using service role inside the function.
- Policies must support:
  - authenticated users read visible assets
  - admins manage config/invitations

Uniqueness Guard: Add a UNIQUE constraint on the pair (share_id, relative_path). This is the ultimate defense against duplicate assets.

Soft Delete: Add is_deleted boolean DEFAULT false. This allows the Admin to "hide" unwanted folders from the UI without wiping their metadata history.


Audit Logs: Add last_scanned_at to the assets table to track which files are still "alive" on the disk during a scan.

---

## 7) Golden Rule: File Date Preservation
`modified_at` and `file_created_at` are filesystem-sourced timestamps. The DAM must NEVER cause these to change on the source file. The Bridge Agent must record original timestamps before touching a file and restore them after. If restoration fails, processing must halt. See PROJECT_BIBLE.md §15 for full details.
