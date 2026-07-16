# DATABASE SCHEMA (Postgres / Supabase)

This document is the single source of truth for tables, columns, constraints, indexes, and visibility rules.

Key principle:
- The DB must enforce correctness (especially timestamps and required fields) so the system fails loudly instead of silently drifting.

> **Triggers and functions** are documented in `docs/INFRASTRUCTURE.md`.

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
- `app_name`: `popdam`, `styleguides` — used by `app_access` and `invitations.apps`
- `app_role`: `admin`, `user`

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
- `usage_count int NOT NULL DEFAULT 0`
- `is_priority boolean NOT NULL DEFAULT false`
- timestamps

`is_priority` is a PopDAM usage shortcut, not an authoritative licensor flag.
`rebuild-character-stats` resets all characters to `is_priority=false`, counts
non-deleted `asset_characters` links, then marks characters whose count meets
the threshold as priority. Rare/new characters can be real taxonomy rows while
still having `is_priority=false`.

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
- `ai_description text NULL` — AI-generated search-friendly summary for designers/salespeople.
- `scene_description text NULL` — AI-generated literal visual description of what is visible.
- `tags text[] NOT NULL DEFAULT '{}'::text[]`
- `workflow_status workflow_status DEFAULT 'other'`
- `status asset_status DEFAULT 'pending'`
- Path-derived attributes (see PATH_ATTRIBUTES.md) — inferred from `relative_path` by a BEFORE INSERT/UPDATE trigger, **not** the same as `workflow_status`:
  - `stage text NULL` (lifecycle bucket directly under `____New Structure`)
  - `customer text NULL` / `program text NULL` (only set in the In Development → Customer Adopted branch)
- Visibility Guard: Add is_deleted boolean DEFAULT false.
- Integrity Guard: Add UNIQUE(share_id, relative_path) to the assets table to prevent duplicate ingestion.
- **File-level classification + facets (2026-07-15):**
  - `content_type text NULL` — CHECK-constrained file kind assigned by image tagging (`source_art`, `style_guide_art`, `tech_pack`, `licensing_sheet`, `product_photo`, … 14 values). shared-db migration `20260714203200`.
  - `product_material text[] NULL` / `product_dimensions text NULL` — projected from the SKU group's `rich_metadata` (rich-PDF extraction) onto each member asset for filtering; `product_material` is uppercase-normalized. GIN index `idx_assets_product_material_gin`. shared-db migrations `20260715183000` / `214500`.

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
- `stage text NULL` / `customer text NULL` / `program text NULL` — path-derived from `folder_path` by a BEFORE INSERT/UPDATE trigger (see PATH_ATTRIBUTES.md)
- licensing + taxonomy summary fields (licensor/property/category/division/MG/size)
- Designer rollup (from member assets, with conflict detection):
  - `designer_name text NULL`
  - `technical_designer_name text NULL`
  - `freelancer_name text NULL`
  - `designer_conflict boolean NOT NULL DEFAULT false` (true when member assets have differing designer names)
- **Two-level product metadata (2026-07-15):**
  - `item_description text NULL` / `item_description_source text NULL` — authoritative product-level description shared by every member asset (seeded from Master Data via `dam.sku_human_description`; shared-db migration `20260714203100`).
  - `rich_metadata jsonb NULL` / `rich_metadata_source text NULL` / `rich_metadata_updated_at timestamptz NULL` — merged structured data extracted from tech-pack/licensing-sheet PDFs, computed by `public.refresh_style_group_rich_metadata()` (shared-db migration `20260715183000`). See `docs/RICH_PDF_EXTRACTION.md`.

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
- `SPACES_CONFIG` — DigitalOcean Spaces non-secret config (bucket, region, endpoint, public_base_url)
- `BULK_OPERATIONS` — state for all bulk jobs (see `docs/BULK_JOBS.md`)
- `SCAN_REQUEST` — pending scan trigger flags for agents
- `ERP_LAST_SYNC_DATE` — watermark for incremental ERP sync
- `ERP_SYNC_ENDPOINT` — override ERP API URL
- `ERP_CATEGORY_CUTOFF_DATE` — items before this date have mg_category nulled (legacy)
- taxonomy endpoint URLs
- NAS mapping keys (host/ip/share/mount root)
- AI tagging custom instructions

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

### 2.15 Production PO Tables

Production PO headers are synced from the PLM API and associated to PopDAM styles by SKU/style number. The PLM API returns SKU/item data under `details[]`; PopDAM flattens each header/detail pair into one current row.

#### `prod_order_sync_runs`
Metadata per PLM production-order sync execution.
- `id uuid PK`, `status text`, `started_at`, `ended_at`
- `total_fetched int`, `total_upserted int`, `total_errors int`, `error_samples jsonb`
- `run_metadata jsonb`, `created_by text`

#### `prod_order_headers_raw`
Immutable snapshot of every normalized PLM production-order header/detail pair.
- `id uuid PK`, `external_id text`, `raw_payload jsonb`, `sync_run_id uuid FK`, `fetched_at timestamptz`

#### `prod_order_headers_current`
Latest normalized production PO header/detail row.
- `id uuid PK`, `external_id text UNIQUE NOT NULL`
- `prod_order_number text NOT NULL` — from header fields such as `Prod Reference #` / `Prod Order No`
- `style_number text NOT NULL` — joins to `style_groups.sku`; from detail fields such as `Item #` / `matchedItemNumber`
- Optional display fields: `order_status`, `customer_code`, `customer_name`, `quantity`, `due_date`, `order_date`, `erp_updated_at`
- `raw_payload jsonb`, `synced_at`, `sync_run_id uuid FK`

### `dam` schema (worker-internal, NOT exposed to PostgREST)

Tables the frontend never queries; `dam` is deliberately absent from `pgrst.db_schemas`, so server-side code must reach these via `public` `SECURITY DEFINER` RPCs (a direct `.schema("dam").from(...)` fails with `Invalid schema: dam` — see `docs/KNOWN_QUIRKS.md` #64).

#### `dam.sku_human_description`
Latest human-authored Master Data description per SKU (seeds `style_groups.item_description`). Refreshed by `public.refresh_sku_human_description()`. shared-db migration `20260714203000`.

#### `dam.pdf_rich_extraction`
Raw structured extraction per source tech-pack/licensing-sheet PDF asset.
- `asset_id uuid PK FK assets`, `style_group_id uuid`, `sku text`, `doc_kind text` (`tech_pack`/`licensing_sheet`)
- `data jsonb` (canonical fields: source_files, production_specs, compliance, legal, colors, …), `source_text_sha256 text` (idempotency), `model`, `prompt_version`, `schema_version`, `confidence`, `parse_error`, `extracted_at`
- Written by the worker via `public.upsert_pdf_rich_extraction(...)`; rolled up to `style_groups.rich_metadata` by `public.refresh_style_group_rich_metadata()`. shared-db migrations `20260715183000` / `210000`. See `docs/RICH_PDF_EXTRACTION.md`.

### 2.16 Hygiene & Style Guide Tables

#### `hygiene_findings`
File naming/structure issues found during Windows Agent scans.
- `id uuid PK`, `scan_session_id uuid`, `file_path text`, `finding_type text`, `detail jsonb`, `found_at timestamptz`

#### `style_guide_crawl_runs`
Metadata for each licensor style guide crawl run.
- `id uuid PK`, `status text`, `agent_id text`, `started_at`, `completed_at`, `files_found int`, `error_message text`, `inaccessible_roots text[] NULL`

#### `style_guide_files`
Crawled style guide files from the NAS. Agent sends raw data; server derives path metadata on ingest.
- `id uuid PK`
- `root_label text` — scan root name (e.g. `styleguides-nas`)
- `relative_path text NOT NULL` — path relative to scan root
- `filename text NOT NULL`
- `size_bytes bigint`, `modified_at timestamptz`, `quick_hash text`
- `licensor_name text GENERATED` — `split_part(relative_path, '/', 1)`, stored, indexed
- `property_folder text NULL` — second path segment
- `style_guide_folder text NULL` — third path segment
- `normalized_style_guide_folder text NULL` — lowercased, non-alphanum stripped
- `path_segments text[]`, `directory_path text`, `depth int`
- `is_active boolean DEFAULT true` — false for files not present in latest crawl
- `thumbnail_url text NULL`, `thumbnail_error text NULL` — not populated (no thumbnail pipeline)
- `crawl_run_id uuid FK`

Unique constraint: `(root_label, relative_path)`. Indexes: `licensor_name`, `property_folder`, `style_guide_folder`, `is_active`, and `idx_style_guide_files_filename_trgm` — gin trigram on `lower(filename)` (added 2026-06-10 for fuzzy files-used resolution). `is_active` is set false by `deactivate_stale_sg_files(root_label, run_id)` at crawl completion for any file not in the latest run; it has **no low-count floor** (KNOWN_QUIRKS.md #46).

#### `style_guide_folders` (view)
DISTINCT `licensor_name, property_folder` pairs for the sidebar tree. `security_invoker = true` so RLS applies. Used by the frontend to build the folder tree without hitting the PostgREST 1000-row default cap on `style_guide_files`.

#### `sku_files_used`
"Style Guide Sources" for a SKU — licensor source files parsed from a design's licensing-sheet/tech-pack PDF. Full data flow + scoping rule: `docs/POPSG.md` → "Style Guide Sources".
- `id uuid PK`, `sku text`, `file_name text` (parsed name — plain text, permanent)
- `style_guide_file_id uuid FK style_guide_files **ON DELETE SET NULL**` — resolved link; null = unresolved/pending
- `source text` — provenance: `pdf_text` | `ai_tag` | `legacy_ungated` (all pre-2026-06-10 rows)
- `match_best_score real`, `match_attempts int`, `last_match_attempt_at timestamptz` — fuzzy-resolution tracking
- Unique `(sku, file_name)`. Rows written only for licensing/tech-pack PDFs (`is_style_guide_source_pdf()` gate); resolved by `resolve_sku_files_used_fuzzy()` (nightly cron `resolve-sku-files-used-nightly`, `0 4 * * *` UTC).

#### `sg_archive_usage` (view)
Per style guide (`licensor_name`, `property_folder`): most recent referencing design (`style_groups.latest_file_date`) + `archive_candidate` flag (unused by any design in 3 years). Reliability scales with `sku_files_used` resolution coverage — **not yet trustworthy** (see POPSG.md / HANDOFF.md).

#### `tiff_optimization_queue`
Queue for TIFF compression jobs run by the Windows Agent.
- `id uuid PK`, `asset_id uuid FK assets`, `status queue_status`, `claimed_by text`, `claimed_at`, `completed_at`, `error_message text`

---

## 3) Additional Tables

### 3.1 asset_tags
Normalized tag storage. The `assets.tags` text array is a denormalized copy maintained by trigger.

- `id uuid PK DEFAULT gen_random_uuid()`
- `asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE`
- `tag text NOT NULL`
- `source text NOT NULL DEFAULT 'manual'` — `'manual'` or `'ai'`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `created_by uuid NULL`
- `UNIQUE(asset_id, tag)`

Indexes: `idx_asset_tags_asset_id`, `idx_asset_tags_source`

### 3.2 AI Tag Bake-Off Tables

Non-destructive evaluation for vision tagging models. These tables store model trial outputs and human review choices without overwriting production `assets`, `asset_tags`, or `asset_characters`.

#### `ai_tag_bakeoff_runs`
- `id uuid PK`, `name text`, `status text` (`draft`, `queued`, `running`, `completed`, `failed`, `stopped`)
- `model_a text`, `model_b text`, `model_c text`, `model_d text`, `model_e text`
- `sample_size int`, `asset_ids uuid[]`
- `created_by uuid`, `created_at`, `updated_at`, `completed_at`

When no explicit `asset_ids` are supplied, the admin API selects a random sample
using random UUID pivots, then deduplicates candidates by `quick_hash`,
`sku + filename`, and filename. If a duplicate exists in a base folder and in a
`TECHPACK` folder, the base-folder asset is preferred.

#### `ai_tag_bakeoff_results`
One row per `(run, asset, model_slot)`.
- `run_id uuid FK`, `asset_id uuid FK`, `model_slot text` (`a`, `b`, `c`, `d`, `e`), `model_id text`
- `status text` (`pending`, `running`, `succeeded`, `failed`)
- Field outputs: `tags text[]`, `ai_description text`, `character_ids uuid[]`, `character_names text[]`, `property_id uuid`, `property_name text`
- Audit/debug fields: `raw_output jsonb`, `latency_ms int`, `prompt_tokens int`, `completion_tokens int`, `total_tokens int`, `cost_usd numeric`, `pricing_snapshot jsonb`, `error_message text`, timestamps

The bake-off worker validates model-supplied taxonomy before storing it:
conflicting `property_id` / `character_ids` are rejected, exact character names
from the model can be resolved against `characters`, and rejected or unresolved
taxonomy choices are recorded under `raw_output._popdam_debug`. Stale `running`
rows older than 10 minutes are normalized to `failed`.

`raw_output` also carries PopDAM-owned audit keys:
- `_popdam_output_mode` — one of `tool`, `tool_content_json`, `json_schema`, or `json_object`
- `_popdam_retry_count` — currently `0` or `1`; JSON mode gets one repair retry after malformed/invalid JSON
- `_popdam_provider` — best-effort OpenRouter route metadata, including provider, endpoint/model, generation id, selected router metadata, response headers, and `/api/v1/generation` enrichment when available
- `_popdam_failure_stage` — present on failed rows when the worker can identify the structured-output stage

Provider metadata is intentionally stored in `raw_output` instead of dedicated
columns. It is useful for the bake-off UI's provider-pattern summary, but it is
best-effort: old rows, OpenRouter cache hits, and some failures can show
`unknown`.

#### `ai_tag_bakeoff_reviews`
Human scoring for the matrix UI.
- `run_id uuid FK`, `asset_id uuid FK`, `field text` (`tags`, `description`, `characters`, `property`, `overall`)
- `winner_slot text`, `scores jsonb`, `notes text`, `reviewed_by uuid`, `reviewed_at`

### 3.3 tiff_optimization_queue
Tracks TIFF files on the NAS that are candidates for compression optimization.

- `id uuid PK DEFAULT gen_random_uuid()`
- `relative_path text NOT NULL UNIQUE`
- `filename text NOT NULL`
- `file_size bigint NOT NULL`
- `file_modified_at timestamptz NOT NULL`
- `file_created_at timestamptz NULL`
- `compression_type text NULL` — `none`, `zip`, `lzw`, `packbits`, `jpeg`, `deflate`
- `status text NOT NULL DEFAULT 'scanned'` — `scanned`, `queued_test`, `queued_process`, `processing`, `completed`, `failed`
- `mode text NULL` — `test` or `process`
- `new_file_size bigint NULL` — size after compression
- `new_filename text NULL`
- `new_file_modified_at timestamptz NULL`
- `new_file_created_at timestamptz NULL`
- `original_backed_up boolean DEFAULT false`
- `original_deleted boolean DEFAULT false`
- `error_message text NULL`
- `scan_session_id text NULL`
- `claimed_by text NULL` — agent_id of agent processing this file
- `claimed_at timestamptz NULL`
- `processed_at timestamptz NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`

Indexes: `idx_tiff_opt_status`, `idx_tiff_opt_compression`

### 3.3 hygiene_findings
File quality issues found during hygiene scans (embedded rasters, oversized layers, etc.).

- `id uuid PK DEFAULT gen_random_uuid()`
- `asset_id uuid NULL REFERENCES assets(id) ON DELETE CASCADE`
- `relative_path text NOT NULL`
- `filename text NOT NULL`
- `check_type text NOT NULL` — `ai_embedded_raster`, `tiff_uncompressed`, `psd_oversized_layer`
- `severity text NOT NULL DEFAULT 'warning'` — `info`, `warning`, `critical`
- `status text NOT NULL DEFAULT 'open'` — `open`, `dismissed`, `resolved`
- `details jsonb NOT NULL DEFAULT '{}'` — check-specific detail payload
- `scan_session_id text NULL`
- `found_by_agent text NULL`
- `found_at timestamptz NOT NULL DEFAULT now()`
- `reviewed_by uuid NULL`
- `reviewed_at timestamptz NULL`
- `review_notes text NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`

Indexes: `idx_hygiene_findings_check_type`, `idx_hygiene_findings_status`, `idx_hygiene_findings_asset_id`, `idx_hygiene_findings_relative_path`

Unique: `(relative_path, check_type) WHERE status != 'resolved'` — prevents duplicate open findings for the same file + check type.

### 3.4 erp_sync_runs
Job metadata for each ERP sync run.

- `id uuid PK DEFAULT gen_random_uuid()`
- `status text NOT NULL DEFAULT 'running'` — `running`, `completed`, `failed`
- `started_at timestamptz NOT NULL DEFAULT now()`
- `ended_at timestamptz NULL`
- `total_fetched int DEFAULT 0`
- `total_upserted int DEFAULT 0`
- `total_errors int DEFAULT 0`
- `error_samples jsonb DEFAULT '[]'`
- `run_metadata jsonb DEFAULT '{}'`
- `created_by text NULL`

### 3.5 erp_items_raw
Immutable audit snapshots of ERP API responses. One row per item per sync run. Never updated — append-only.

- `id uuid PK DEFAULT gen_random_uuid()`
- `external_id text NOT NULL` — ERP item ID
- `raw_payload jsonb NOT NULL` — full raw API response for this item
- `sync_run_id uuid NULL REFERENCES erp_sync_runs(id) ON DELETE SET NULL`
- `fetched_at timestamptz NOT NULL DEFAULT now()`

Indexes: `idx_erp_items_raw_external_id`, `idx_erp_items_raw_sync_run_id`

### 3.6 erp_items_current
Latest normalized row per ERP item (upserted on each sync). One row per `external_id`.

- `id uuid PK DEFAULT gen_random_uuid()`
- `external_id text UNIQUE NOT NULL`
- `style_number text NULL`
- `item_description text NULL`
- `mg_category text NULL` — top-level product category (NULL for legacy items pre-cutoff-date)
- `mg01_code` through `mg06_code text NULL` — merchandise group codes (6 tiers)
- `size_code text NULL`
- `licensor_code text NULL`
- `property_code text NULL`
- `division_code text NULL`
- `erp_updated_at timestamptz NULL` — timestamp from the ERP system
- `synced_at timestamptz NOT NULL DEFAULT now()`
- `sync_run_id uuid NULL REFERENCES erp_sync_runs(id) ON DELETE SET NULL`
- `source_system text NOT NULL DEFAULT 'designflow'`
- `raw_mg_fields jsonb DEFAULT '{}'` — raw MG field values before normalization
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`

Indexes: `idx_erp_items_current_style_number`, `idx_erp_items_current_mg_category`, `idx_erp_items_current_synced_at`

### 3.7 product_category_predictions
AI classification results for ERP items that couldn't be categorized deterministically.

- `id uuid PK DEFAULT gen_random_uuid()`
- `erp_item_id uuid NULL REFERENCES erp_items_current(id) ON DELETE CASCADE`
- `external_id text NOT NULL`
- `predicted_category text NOT NULL` — `Wall`, `Tabletop`, `Clock`, `Storage`, `Workspace`, `Floor`, `Garden`
- `confidence real NOT NULL` — 0.0 to 1.0
- `rationale text NULL` — AI explanation of the classification
- `classification_source text NOT NULL DEFAULT 'ai'`
- `ai_model text NULL` — model identifier used
- `ai_prompt_version text NULL`
- `status text NOT NULL DEFAULT 'pending'` — `pending`, `low_confidence`, `auto_applied`, `approved`, `rejected`, `unclassifiable`
- `reviewed_by uuid NULL`
- `reviewed_at timestamptz NULL`
- `input_context jsonb NULL` — context passed to AI for audit
- `created_at timestamptz NOT NULL DEFAULT now()`

Status lifecycle:
- `pending` — newly classified, awaiting review
- `low_confidence` — confidence < 0.65, needs human review
- `auto_applied` — confidence ≥ 0.65, automatically applied to assets
- `approved` — manually approved by admin
- `rejected` — manually rejected; item will be re-classified or left uncategorized
- `unclassifiable` — AI determined it cannot be classified

Indexes: `idx_pcp_status`, `idx_pcp_erp_item_id`

### 3.8 agent_pairings
One-time pairing codes for Bootstrap registration of new agents.

- `id uuid PK DEFAULT gen_random_uuid()`
- `pairing_code text NOT NULL UNIQUE`
- `agent_type text NOT NULL CHECK (agent_type IN ('bridge', 'windows-render'))`
- `agent_name text NOT NULL DEFAULT ''`
- `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'expired'))`
- `created_by uuid NULL REFERENCES auth.users(id)`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `expires_at timestamptz NOT NULL`
- `consumed_at timestamptz NULL`
- `consumed_by_agent_id uuid NULL`
- `agent_registration_id uuid NULL REFERENCES agent_registrations(id)`

Indexes: `idx_agent_pairings_code WHERE status = 'pending'`

Pairing codes are short-lived (default 15 minutes). A new agent reads the code from its `.env`, calls `POST /agent/bootstrap`, and the code is consumed. The generate-install-bundle action creates a pairing code automatically and embeds it in the downloaded config files.

### 3.9 app_access
Per-user entitlement for each app (`popdam` or `styleguides`). Controls which UI the user can access after login.

- `id uuid PK DEFAULT gen_random_uuid()`
- `user_id uuid NOT NULL`
- `app app_name NOT NULL` — `'popdam'` or `'styleguides'`
- `granted_at timestamptz NOT NULL DEFAULT now()`
- `granted_by uuid NULL`
- `UNIQUE (user_id, app)`

RLS: users read their own rows (for app-switcher logic); admins manage all rows. Helper: `has_app_access(user_id, app_name) → bool`. New users get `app_access` rows from `handle_new_user()` based on the `invitations.apps` array.

### 3.10 helper_devices
One row per desktop device that has the POP DAM Helper installed. Created/updated via `POST /helper-api/register-device`.

- `id uuid PK DEFAULT gen_random_uuid()`
- `user_id uuid NOT NULL REFERENCES auth.users(id)`
- `device_name text NOT NULL`
- `device_os text NOT NULL CHECK (device_os IN ('windows', 'macos'))`
- `helper_version text NOT NULL`
- `last_seen_at timestamptz NOT NULL DEFAULT now()`
- `created_at timestamptz NOT NULL DEFAULT now()`

### 3.11 helper_tokens
Short-lived one-time tokens embedded in `popdam://` URLs. Generated by the web DAM, consumed by the Helper on first use.

- `id uuid PK DEFAULT gen_random_uuid()`
- `token text NOT NULL UNIQUE` — 32-char random hex
- `user_id uuid NOT NULL REFERENCES auth.users(id)`
- `action text NOT NULL CHECK (action IN ('checkout', 'checkin', 'open', 'reveal', 'discard'))`
- `asset_id uuid NULL REFERENCES assets(id)`
- `checkout_id uuid NULL REFERENCES asset_checkouts(id)`
- `expires_at timestamptz NOT NULL` — 5 minutes from creation
- `consumed_at timestamptz NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`

### 3.12 asset_checkouts
Tracks the lifecycle of a file checked out to a local machine. The unique partial index enforces one active checkout per asset.

- `id uuid PK DEFAULT gen_random_uuid()`
- `asset_id uuid NOT NULL REFERENCES assets(id)`
- `user_id uuid NOT NULL REFERENCES auth.users(id)`
- `device_id uuid NOT NULL REFERENCES helper_devices(id)`
- `status checkout_status NOT NULL DEFAULT 'active'`
- `local_path text NULL`
- `snapshot_hash text NULL` — SHA-256 at checkout time
- `final_hash text NULL` — SHA-256 of the checked-in file
- `file_size bigint NULL`
- `last_heartbeat_at timestamptz NULL`
- `error_message text NULL`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()` — trigger-maintained

**`checkout_status` enum:** `active` → `checkin_queued` → `uploading` → `verifying` → `complete` (or `discarded` / `error` / `conflict` at any stage)

**Unique partial index:** `UNIQUE (asset_id) WHERE status IN ('active', 'checkin_queued', 'uploading', 'verifying')` — the `/checkouts/start` handler catches `23505` (unique violation) and returns 409 with the existing owner's info.

---

## 4) Indexes (Performance-Critical)
- btree: `assets(file_type)`, `assets(status)`, `assets(workflow_status)`,
  `assets(is_licensed)`, `assets(modified_at)`, `assets(file_created_at)`,
  `assets(licensor_id)`, `assets(property_id)`, `assets(product_subtype_id)`,
  `assets(quick_hash)`
- GIN: `assets(tags)`
- GIN full-text search:
  - `idx_assets_full_text_search` on asset filename/path/product-description/search metadata (`assets`, partial where `is_deleted = false`)
  - `idx_style_groups_full_text_search` on SKU/folder/product-description/search metadata (`style_groups`)
  - `idx_pdf_text_samples_extracted_text_search` on `pdf_text_samples.extracted_text`
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
- path-derived attributes (see PATH_ATTRIBUTES.md): `infer_path_attrs(path)` (IMMUTABLE) + `trg_set_path_attrs` triggers on `assets`/`style_groups`; `get_path_facets(customer)` for the customer/program filter combos
- library search: `dam_search_documents` is the flattened search table for assets and style groups. Its stored generated `search_tsv` column is GIN-indexed; SKU/path-style substring fields use trigram indexes; optional `embedding vector(384)` supports Supabase `gte-small` semantic search. `dam_search_synonyms` stores curated business-language aliases, and `expand_dam_search_queries(query)` normalizes punctuation/spacing before `search_dam_documents(...)` ranks matches. `search_assets_full_text(query, limit)` and `search_style_groups_full_text(query, limit)` remain compatibility wrappers for the frontend.

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
