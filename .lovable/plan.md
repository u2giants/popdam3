# Plan: Legacy ERP Items — Force AI Classification for Pre-May 2025 Styles

## Problem

Styles created before May 20, 2025 do not encode Product Category in their style number. The current ERP mapper trusts `mg_category` and MG01 codes from the ERP for all items, but for pre-2025 items those values are unreliable. We need to:

1. Null out `mg_category` for pre-cutoff ERP items so the deterministic mapper stops trusting them
2. Route those items to AI classification instead
3. Make the cutoff date configurable

## Changes

### 1. ERP Sync — Null out `mg_category` for legacy items

**File: `supabase/functions/erp-sync/index.ts**`

During the normalization step (line ~198-238), add a date check. If the item's `created_date` (or `erp_updated_at`) is before `2025-05-10`, set `mg_category: null` regardless of what the ERP returned. This ensures the mapper cannot use unreliable category data.

Add a constant:

```typescript
const STYLE_CATEGORY_CUTOFF = "2025-05-10";
```

In the normalization loop, after extracting `erp_updated_at`, check:

```typescript
const isLegacy = erpDate && erpDate < STYLE_CATEGORY_CUTOFF;
mg_category: isLegacy ? null : (item.mgCategory || null),
```

### 2. Classify handler — Expand scope to include legacy items

**File: `supabase/functions/admin-api/index.ts**` — `handleClassifyErpCategories`

Currently the query filters for `mg_category IS NULL AND mg01_code IS NULL`. This is too restrictive — legacy items may have an MG01 code but it's not reliable for category. Change the query to:

```sql
-- Items that need AI classification:
-- A) mg_category IS NULL (covers legacy items we just wiped)
-- B) exclude items that already have a high-confidence prediction
```

Remove the `.is("mg01_code", null)` filter so that legacy items with MG01 codes (which are unreliable pre-2025) still get classified by AI. The query becomes:

```typescript
.is("mg_category", null)
// Remove: .is("mg01_code", null)
```

Also add a left-join or NOT EXISTS check to skip items that already have an `auto_applied` or `approved` prediction in `product_category_predictions`, so re-running doesn't re-classify already-handled items.

### 3. Store cutoff date in `admin_config`

**File: `supabase/functions/erp-sync/index.ts**`

Read `ERP_CATEGORY_CUTOFF_DATE` from `admin_config` (default `2025-05-10`). This makes it configurable from the admin UI without a code deploy.

### 4. Update `erp-mapper.ts` — Skip MG01 rule for legacy items

**File: `supabase/functions/_shared/erp-mapper.ts**`

Add an optional `erp_date?: string` field to `ErpItemInput`. If the date is before the cutoff, skip steps 1-3 (ERP direct, SKU deterministic, style_number extraction) and go straight to `needs_ai: true`.

### 5. UI indicator (minor)

**File: `src/components/settings/ErpEnrichmentTab.tsx**`

Add a note in the Quality Dashboard showing how many legacy items (pre-cutoff) exist and how many still need classification.

## Implementation Order


| Step | What                                                     | Risk                               |
| ---- | -------------------------------------------------------- | ---------------------------------- |
| 1    | Update `erp-mapper.ts` with date-aware logic             | Low — pure function                |
| 2    | Update `erp-sync` to null `mg_category` for legacy items | Medium — affects data on next sync |
| 3    | Update `handleClassifyErpCategories` to broaden scope    | Low — additive                     |
| 4    | Admin config key for cutoff date                         | Low                                |
| 5    | UI indicator                                             | Low                                |


## What does NOT change

- The 7 category enum stays the same
- Items after May 20, 2025 continue using the existing ERP-direct and MG01-rule logic
- The AI classification tool call, model, and prompt are unchanged
- The review queue and approval flow are unchanged