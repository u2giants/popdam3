

## Assessment Validation

Your diagnosis is correct on all counts. No errors in logic.

- The 12-hour rebuild is purely architectural: 25s work per 60s cron tick = 42% utilization.
- The 502s in `finalize_stats` come from `refresh_style_group_primaries` doing unindexable `LIKE '%mockup%'` scans across all assets in every group via LATERAL JOIN.
- Pre-computing the priority tier at write time is the correct long-term fix.

## Plan

### 1. Quick win: Increase MAX_RUN_MS to 50s
**File:** `supabase/functions/bulk-job-runner/index.ts` line 23
Change `MAX_RUN_MS = 25_000` to `50_000`. Safe — 10s gap before next cron tick.

### 2. Add `primary_sort_tier` column to `assets`
**DB Migration:**
```sql
ALTER TABLE public.assets
  ADD COLUMN primary_sort_tier smallint NOT NULL DEFAULT 7;

CREATE INDEX idx_assets_primary_sort_tier
  ON public.assets (style_group_id, primary_sort_tier, created_at)
  WHERE is_deleted = false;
```

Tier values (matching existing `selectPrimaryAsset` / `refresh_style_group_primaries` logic):
- 1 = mockup + has thumbnail
- 2 = art + has thumbnail
- 3 = other (not mockup/art/packaging) + has thumbnail
- 4 = packaging + has thumbnail
- 5 = mockup, no thumbnail
- 6 = art, no thumbnail
- 7 = other, no thumbnail
- 8 = packaging, no thumbnail

### 3. Create a trigger to compute `primary_sort_tier` on INSERT/UPDATE
**DB Migration:**
```sql
CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  fn text := lower(NEW.filename);
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_mockup boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_art boolean := (fn LIKE '%art%');
  is_pkg boolean := (fn LIKE '%packaging%');
BEGIN
  IF is_mockup AND has_thumb THEN NEW.primary_sort_tier := 1;
  ELSIF is_art AND has_thumb THEN NEW.primary_sort_tier := 2;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg AND has_thumb THEN NEW.primary_sort_tier := 3;
  ELSIF is_pkg AND has_thumb THEN NEW.primary_sort_tier := 4;
  ELSIF is_mockup THEN NEW.primary_sort_tier := 5;
  ELSIF is_art THEN NEW.primary_sort_tier := 6;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_pkg THEN NEW.primary_sort_tier := 7;
  ELSE NEW.primary_sort_tier := 8;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_compute_primary_sort_tier
  BEFORE INSERT OR UPDATE OF filename, thumbnail_url, thumbnail_error
  ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_primary_sort_tier();
```

### 4. Backfill existing assets
**Data update (insert tool, not migration):**
```sql
UPDATE public.assets SET primary_sort_tier =
  CASE
    WHEN (lower(filename) LIKE '%mockup%' OR lower(filename) LIKE '%mock up%')
         AND thumbnail_url IS NOT NULL AND thumbnail_error IS NULL THEN 1
    WHEN lower(filename) LIKE '%art%'
         AND thumbnail_url IS NOT NULL AND thumbnail_error IS NULL THEN 2
    WHEN lower(filename) NOT LIKE '%mockup%' AND lower(filename) NOT LIKE '%mock up%'
         AND lower(filename) NOT LIKE '%art%' AND lower(filename) NOT LIKE '%packaging%'
         AND thumbnail_url IS NOT NULL AND thumbnail_error IS NULL THEN 3
    WHEN lower(filename) LIKE '%packaging%'
         AND thumbnail_url IS NOT NULL AND thumbnail_error IS NULL THEN 4
    WHEN lower(filename) LIKE '%mockup%' OR lower(filename) LIKE '%mock up%' THEN 5
    WHEN lower(filename) LIKE '%art%' THEN 6
    WHEN lower(filename) NOT LIKE '%mockup%' AND lower(filename) NOT LIKE '%mock up%'
         AND lower(filename) NOT LIKE '%art%' AND lower(filename) NOT LIKE '%packaging%' THEN 7
    ELSE 8
  END
WHERE is_deleted = false;
```

### 5. Rewrite `refresh_style_group_primaries` to use the index
**DB Migration — replace the function:**
```sql
CREATE OR REPLACE FUNCTION public.refresh_style_group_primaries(p_group_ids uuid[])
RETURNS integer LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public' SET statement_timeout TO '30s' AS $$
  WITH picked AS (
    SELECT DISTINCT ON (sg.id)
      sg.id AS style_group_id,
      a.id AS primary_asset_id,
      a.asset_type::text AS primary_asset_type,
      a.thumbnail_url AS primary_thumbnail_url,
      a.thumbnail_error AS primary_thumbnail_error
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    ORDER BY sg.id, a.primary_sort_tier ASC, a.created_at ASC
  ),
  upd AS (
    UPDATE public.style_groups sg SET
      primary_asset_id = picked.primary_asset_id,
      primary_asset_type = picked.primary_asset_type,
      primary_thumbnail_url = picked.primary_thumbnail_url,
      primary_thumbnail_error = picked.primary_thumbnail_error,
      updated_at = now()
    FROM picked WHERE sg.id = picked.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$$;
```

This replaces the expensive `LATERAL JOIN + CASE + LIKE` with a simple `DISTINCT ON` ordered by an indexed `smallint` column. The composite index `(style_group_id, primary_sort_tier, created_at) WHERE is_deleted = false` makes this an index-only scan per group.

### 6. Update `selectPrimaryAsset` in `_shared/style-grouping.ts`
No change needed — this JS function is only used in non-DB contexts (agent-api inline). It stays as-is.

### 7. Update progress display in DiagnosticsTab
Show estimated time remaining based on cursor velocity:
- Track `cursor` and `started_at` from operation state
- Compute `assets_per_minute = cursor / minutes_elapsed`
- Display `~X min remaining` next to the progress bar

**File:** `src/components/settings/DiagnosticsTab.tsx` — in the rebuild progress section.

### Summary of changes
| File | Change |
|---|---|
| `bulk-job-runner/index.ts` | `MAX_RUN_MS = 50_000` |
| DB migration | Add `primary_sort_tier` column + index + trigger |
| DB data update | Backfill 66k assets |
| DB migration | Rewrite `refresh_style_group_primaries` |
| `DiagnosticsTab.tsx` | Add ETA to rebuild progress |

### Risks
- **Backfill**: Single UPDATE on 66k rows — should complete in <10s with no contention. Safe.
- **Trigger overhead**: One extra `CASE` per insert/update on `assets` — negligible (trigger runs on column changes only).
- **No agent changes needed**: The new column has a DEFAULT and the trigger fires automatically.

