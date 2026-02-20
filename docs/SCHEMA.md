# DATABASE SCHEMA (Postgres / Supabase)

This document is the single source of truth for tables, columns, constraints, indexes, and visibility rules.

Key principle:
- The DB must enforce correctness (especially timestamps and required fields) so the system fails loudly instead of silently drifting.

---

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

### 2.10 agent_registrations
- `id uuid PK`
- `agent_name text NOT NULL`
- `agent_key_hash text UNIQUE NOT NULL`
- `last_heartbeat timestamptz`
- `metadata jsonb NOT NULL DEFAULT '{}'`

### 2.11 profiles / user_roles / invitations
Invitation-only access model:
- profiles: `user_id uuid UNIQUE`, `email text`, `full_name text`, timestamps
- user_roles: `user_id uuid`, `role text`, `UNIQUE(user_id, role)`
- invitations: `id uuid PK`, `email text UNIQUE NOT NULL`, `role text DEFAULT 'user'`, `invited_by uuid NULL`, `created_at`, `accepted_at NULL`

### 2.12 admin_config
- `key text PK`
- `value jsonb NOT NULL`
- `updated_at timestamptz DEFAULT now()`
- `updated_by uuid NULL`

Stores:
- `THUMBNAIL_MIN_DATE`
- `SCAN_MIN_DATE`
- DO Spaces base URL
- taxonomy endpoints
- NAS mapping keys (host/ip/share/mount root)

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