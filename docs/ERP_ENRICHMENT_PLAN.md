# ERP Integration — Current State

> This document replaced the original implementation plan (now fully built). It describes how the ERP pipeline actually works as of May 2025.

---

## Overview

PopDAM syncs product master data from the DesignFlow ERP API into a local `erp_items_current` table, enriches assets and style groups with that data, and provides an admin UI to browse, filter, and review ERP items.

---

## 1. Database Tables

### `erp_items_current`
Latest normalized row per ERP item. Upserted on every sync.

Key columns:
- `external_id` — unique ERP item identifier
- `style_number` — parsed SKU
- `item_description` — product name from ERP
- `mg_category` — category string from ERP API (e.g. "Wall", "Storage") — may be null
- `mg01_code`, `mg02_code`, `mg03_code` — **single-character letter/digit codes** (e.g. "A", "B", "0")
- `raw_mg_fields` — JSONB storing original API values: `mg01`/`mg02`/`mg03` contain the raw API text (descriptions for post-May-2025 items, letter codes for older items), plus `mg01_code`/`mg02_code`/`mg03_code` for the resolved codes
- `size_code`, `licensor_code`, `property_code`, `division_code`, `prepack_code`, `prepack_codes`
- `erp_updated_at` — ERP's own last-modified date (used as "Created Date" in the browser)
- `synced_at` — when we last wrote this row
- `dismissed` — soft-hide from browser

### `erp_items_raw`
Immutable snapshot of every ERP API response row, one row per sync run per item.

### `erp_sync_runs`
Metadata per sync run: status, start/end times, fetched/upserted/error counts, watermark.

### `product_category_predictions`
AI classification results for items missing `mg_category`. Statuses: `pending`, `auto_applied`, `approved`, `rejected`, `unclassifiable`.

---

## 2. ERP Sync Edge Function (`erp-sync`)

**Endpoint**: `POST /functions/v1/erp-sync`

**Modes**:
- **Incremental** (default): fetches items since the watermark date (`ERP_LAST_SYNC_DATE` in `admin_config`)
- **Full**: fetches entire dataset (no date filter)

**MG Code Resolution** (`supabase/functions/_shared/mg-codes.ts`):

The DesignFlow API changed format around May 2025. New items return full descriptions in MG fields ("Stretched/Box", "Canvas") rather than letter codes ("A", "A"). The sync function resolves these:

1. `resolveMg01Code(rawApiValue)` — single-char → pass through; multi-char → reverse-lookup against the MerchGroup CSV schema; unknown → null
2. `resolveMg02Code(mg01Code, rawApiValue)` — same, context-aware per MG01
3. `resolveMg03Code(mg01Code, mg02Code, rawApiValue)` — same, context-aware per MG01+MG02

Matching is case-insensitive. Known API spelling variants are included (e.g. "Jewellery/Music Box" → "J", "diecut/attach/raised" → "D", "Suede/PU Leather/PVC" → "U").

If a description can't be matched to any known schema code, `null` is stored in the code field and the raw value is preserved in `raw_mg_fields`. This surfaces as an amber "unresolved" indicator in the browser.

**After any change to `mg-codes.ts`**: redeploy `erp-sync` and run a Full Sync to backfill existing rows.

**Safety**:
- Run lock: rejects if a sync is already running
- 120s fetch timeout
- Watermark updated after successful completion

---

## 3. MerchGroup Schema (`src/lib/mg-lookup.ts` and `_shared/mg-codes.ts`)

Two related files implement the MerchGroup Rework schema (effective May 10, 2025):

| File | Purpose | Used By |
|------|---------|---------|
| `src/lib/mg-lookup.ts` | Forward maps: code → description. Used for UI display. | Frontend (ErpEnrichmentTab) |
| `supabase/functions/_shared/mg-codes.ts` | Reverse maps: description → code. Used during sync. | erp-sync edge function |

The schema has 3 levels: MG01 (product type, 18 categories A–W), MG02 (construction, varies per MG01), MG03 (feature, varies per MG01+MG02). The `mgCategory` field (Wall, Tabletop, Clock, Storage, Workspace, Floor, Garden) is derived from MG01 via the `MG01_CATEGORY` map.

---

## 4. Admin UI (`src/components/settings/ErpEnrichmentTab.tsx`)

### ERP Items Browser
Sortable, filterable table showing all ERP items. Features:
- Search by style # or description
- Filter by Created Date range
- Filter by style #/description max character length (for finding junk entries)
- Show/hide dismissed items
- Batch dismiss

**MG column display**:
- MG01/02/03 show the human-readable description (from `getMg01Desc(code)` or raw API value), with the letter code in a tooltip
- Items where mg01_code is null but the API returned a description show it in **amber** — the description didn't match any schema entry and may need ERP correction
- Pre-fix rows (description stored in code field, `length > 1`) also display in amber until a Full Sync re-processes them
- Category: shows `mg_category` from API; if null, derives from MG01 code via `getMgCategory()` in italic

### Stats Dashboard
Cards: Total ERP items, Has mgCategory, No mgCategory, Rule-Classified, AI-Classified, Needs AI, Pending Review, SKU Matched, Unmatched SKUs. If any items have unresolved MG codes (amber), an additional "Unresolved MG Codes" card appears.

### Review Queue
Table of `product_category_predictions` where AI confidence was below threshold. Actions: Approve, Override (select different category), Reject, Bulk reject.

---

## 5. Category Classification (AI)

Items where `mg_category` is null AND deterministic lookup from MG01 code fails are eligible for AI classification.

- Trigger: `classify-erp-categories` action on admin-api
- Confidence < 0.65 → status `pending` (Review Queue)
- Confidence ≥ 0.65 → status `auto_applied`
- All predictions stored regardless of confidence

---

## 6. Known Data Quality Issues (Post-May 2025 API Items)

From a DB audit of post-May-10-2025 items:

| Issue | Detail |
|-------|--------|
| 1 item with old letter-code format | `SDX00WBLR01S` — uses MG01="S"/MG02="D"/MG03="DX", mg_category=null; likely ERP data entry error |
| 3 items with null mg_category | API didn't return a category; needs ERP investigation |
| Several description mismatches vs CSV | e.g. "Printed Flat" (CSV: "Printed"), "Metallic Canvas" (not in CSV), case variants — these store null in code fields and show amber in browser |

---

## 7. Rollout Checklist (For Future Reference)

When deploying changes to `mg-codes.ts` or `erp-sync`:
1. Deploy edge functions via GitHub Actions
2. In ERP Enrichment admin UI → run **Full Sync**
3. Verify "Unresolved MG Codes" stat is 0 or expected count
4. Check amber rows in browser — these need ERP correction upstream
