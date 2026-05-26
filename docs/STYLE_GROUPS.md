# Style Groups

Style groups are the central organizational unit in PopDAM. A style group represents a single product SKU — all the design files (PSD, AI) and associated images that belong to the same product line item.

---

## What Is a Style Group?

Every asset in the library belongs to a style group. The group is identified by two keys:

- **SKU** — a short alphanumeric code (e.g. `MQK8ASESC01`) extracted from the asset's filename. This is the canonical identifier used in ERP systems, licensor communication, and licensor submissions.
- **Folder Path** — the NAS relative path to the folder containing the assets (e.g. `Decor/Projects/MQK8ASESC01`).

A style group is created (or updated) during the `rebuild-style-groups` bulk operation. It aggregates metadata from all its member assets so the library can be filtered, searched, and browsed by group rather than by individual file.

---

## How Groups Are Built

`rebuild-style-groups` is a 4-stage operation orchestrated by `bulk-job-runner`:

### Stage 1: `clear_assets`
Sets `style_group_id = NULL` on every asset row, in adaptive batches (default 1000, halves on timeout). This dissociates all assets from their current groups before the rebuild.

### Stage 2: `delete_groups`
Deletes every row from the `style_groups` table in batches of 200. After this stage the table is empty.

### Stage 3: `rebuild_assets`
Calls the `rebuild_style_groups_batch` PostgreSQL RPC function in batches (default 100 assets/batch). This function:
- Walks each asset's `relative_path` to find the first segment matching the SKU pattern (`^[A-Za-z]{1,6}[0-9]`, length ≥ 10, not the last segment).
- Groups assets by SKU.
- Upserts a `style_groups` row for each distinct SKU (inheriting metadata from the first asset in the batch for that SKU).
- Sets `assets.style_group_id` for every asset in the batch.

Assets whose path contains no matching SKU segment are left ungrouped.

### Stage 4: `finalize_stats`
Drives `reconcile_style_group_stats_batch` in two sub-stages, **in batches** (100 groups/batch for counts, 25 groups/batch for primaries):

- **`counts`** — updates `asset_count` and `latest_file_date` for each group.
- **`primaries`** — selects the best asset in each group to be `primary_asset_id` (see Primary Asset Selection below).

Each call to `reconcile_style_group_stats_batch` has `SET statement_timeout = '120s'`. The stage runs as many batch ticks as needed until all groups are processed.

This stage is also independently runnable as the `reconcile-style-group-stats` operation, which is safe to run on a live system without doing a full rebuild.

---

## Primary Asset Selection

Each style group has one designated primary asset (`primary_asset_id`). The primary asset is the one whose AI tags, metadata, and characters are propagated to all other assets in the group via `propagate-group-tags`.

Primary asset selection uses `primary_sort_tier`, a computed column maintained by the `trg_compute_primary_sort_tier` database trigger. The tier is assigned automatically whenever an asset is inserted or updated:

| Tier | Condition |
|------|-----------|
| 1 | Has thumbnail AND filename matches a "front view" pattern (e.g. `_FT`, `_Front`) |
| 2 | Has thumbnail AND filename matches a design/main pattern |
| 3 | Has thumbnail AND is a PSD file |
| 4 | Has thumbnail AND is an AI file |
| 5 | Has thumbnail (any file type) |
| 6 | No thumbnail, PSD file |
| 7 | No thumbnail, AI file |
| 8 | All others |

Within the same tier, the asset that was AI-tagged earliest (`ai_tagged_at ASC`) is preferred. This means a newly-tagged asset in Tier 1 won't displace a previously-established primary — ties are broken by who was tagged first.

The `finalize_stats` / `reconcile-style-group-stats` operation queries:
```sql
SELECT id FROM assets
WHERE style_group_id = <group_id>
  AND is_deleted = false
  AND ai_tagged_at IS NOT NULL
ORDER BY primary_sort_tier ASC, ai_tagged_at ASC
LIMIT 1
```

---

## Tag Propagation

The `propagate-group-tags` bulk operation (and its inline counterpart `propagateGroupTags()` in the `ai-tag` Edge Function) copies:

- **AI tags** — all tags from `asset_tags` where `source = 'ai'`, **except** file-specific tags. File-specific tags describe the individual file (e.g. `front view`, `mockup`, `render`) and should not be applied to sibling files showing different views.

  File-specific tag exclusion list:
  ```
  art_piece, art piece, product, product shot, product photo,
  packaging, package, tech_pack, tech pack, technical pack,
  photography, photo, mockup, mock up, mock-up,
  front view, back view, side view, flat lay, flatlay,
  render, 3d render
  ```

- **Characters** — all rows from `asset_characters` for the primary asset.

- **Metadata fields** (only fills NULLs, never overwrites existing values):
  - `licensor_id`
  - `property_id`
  - `is_licensed`
  - `big_theme`
  - `little_theme`
  - `design_style`
  - `cover_description`

The propagation runs through the `propagate_group_tags_batch` PostgreSQL function (see `supabase/migrations/20260405000000_propagate_group_tags_batch_skip_locked.sql`). It uses `FOR UPDATE SKIP LOCKED` on the `UPDATE assets` CTE to avoid row-lock contention with concurrent `ai-tag` writes — locked rows are skipped and will be caught on the next pg_cron tick (every minute).

---

## Designer Rollup

Three designer fields on `assets` are extracted by AI from Tech Pack thumbnails:
- `designer_name`
- `technical_designer_name`
- `freelancer_name`

The `trg_sync_designer_to_style_group` database trigger fires whenever any of these fields change on an asset. It:
1. Collects the distinct values of each designer field across all non-deleted members of the group.
2. If all members agree (one distinct value), writes that value to the `style_groups` row.
3. If members disagree (multiple distinct values), sets `designer_conflict = true` on the group and leaves the group-level fields as the most common value.
4. If all members have NULL, clears the group-level fields.

`designer_conflict = true` is surfaced in the UI as a warning badge on the style group card.

---

## Cover Description Rollup

The `trg_sync_cover_description_to_style_group` trigger fires when `assets.cover_description` changes. It propagates the non-null cover description from the primary asset to the `style_groups.cover_description` column.

---

## Style Group Columns Reference

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `sku` | `text UNIQUE NOT NULL` | Product SKU code |
| `folder_path` | `text NOT NULL` | NAS relative folder path |
| `primary_asset_id` | `uuid FK NULL` | References `assets(id)`, SET NULL on delete |
| `asset_count` | `int DEFAULT 0` | Count of non-deleted member assets |
| `latest_file_date` | `timestamptz NULL` | Most recent `modified_at` among members |
| `workflow_status` | `workflow_status DEFAULT 'other'` | Mirrors primary asset's status |
| `is_licensed` | `boolean DEFAULT false` | True if any member is licensed |
| `licensor_code` | `text NULL` | Licensor short code (from ERP or metadata) |
| `licensor_name` | `text NULL` | Licensor display name |
| `property_code` | `text NULL` | Property short code |
| `property_name` | `text NULL` | Property display name |
| `product_category` | `text NULL` | Top-level product category |
| `division_code` | `text NULL` | Division code (from ERP) |
| `division_name` | `text NULL` | Division display name |
| `mg01_code` through `mg06_code` | `text NULL` | Merchandise group codes (6 tiers) |
| `mg01_name` through `mg06_name` | `text NULL` | Merchandise group names (6 tiers) |
| `size_code` | `text NULL` | Size code |
| `size_name` | `text NULL` | Size display name |
| `cover_description` | `text NULL` | AI-generated product description |
| `designer_name` | `text NULL` | Rolled up from member assets |
| `technical_designer_name` | `text NULL` | Rolled up from member assets |
| `freelancer_name` | `text NULL` | Rolled up from member assets |
| `designer_conflict` | `boolean NOT NULL DEFAULT false` | True when members disagree on designer |
| `primary_asset_type` | `text NULL` | Mirrors `asset_type` of primary asset |
| `created_at` | `timestamptz DEFAULT now()` | |
| `updated_at` | `timestamptz DEFAULT now()` | |

---

## Zombie Groups

A zombie group is a style group whose `primary_asset_id` points to an asset that has moved to a different group, or whose `asset_count` is stale (non-zero in the DB but zero actual members). Zombies occur when:

1. A rebuild is run that clears assets but crashes before finalizing stats.
2. An asset is manually reassigned via SQL without updating group counts.
3. A group's only asset is deleted but `reconcile-style-group-stats` hasn't run yet.

**Symptom:** The style group detail panel shows no metadata, no primary image, and no asset list.

**Fix:** Run `reconcile-style-group-stats` (or the full `rebuild-style-groups` for a thorough cleanup). This resets `asset_count` to the true count and clears stale `primary_asset_id` references.

---

## Conflict: rebuild-style-groups ↔ ai-tag-*

Running `rebuild-style-groups` while `ai-tag-*` is running creates a data integrity risk: rebuild clears `style_group_id` on every asset mid-scan, causing tag propagation to apply to the wrong group or be lost entirely.

These operations are listed as cross-lane conflicts in `OP_CONFLICTS` (`operation-constants.ts`). The system will refuse to promote one if the other is running, and the admin-api returns HTTP 409 if the UI tries to force it. See `docs/BULK_JOBS.md` for full conflict map details.

---

## Reconcile vs Rebuild

| | `reconcile-style-group-stats` | `rebuild-style-groups` |
|---|---|---|
| Rebuilds groups from scratch | No | Yes |
| Recalculates asset_count | Yes | Yes (stage 4) |
| Recalculates primary_asset_id | Yes | Yes (stage 4) |
| Clears style_group_id on assets | No | Yes (stage 1) |
| Deletes all style_groups rows | No | Yes (stage 2) |
| Safe to run on live system | Yes | Caution — see conflicts |
| Duration | Minutes | Minutes to hours |
| Use when | Counts are stale or primary is wrong | SKU assignments are wrong or groups are wrong |
