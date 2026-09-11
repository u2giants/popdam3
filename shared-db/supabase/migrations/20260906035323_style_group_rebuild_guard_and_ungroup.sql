-- =====================================================================================
-- Issue #2408 - rebuild_style_groups_batch: guard the assignment write, and add the
-- missing ungroup arm.
-- Parent plan #2209 (`plan_database_efficiency_and_api_security.md`).
-- Claim #2412 reserves version 20260906035323 and exactly these objects:
--
--   function public.rebuild_style_groups_batch(uuid, integer)   (replaced in place)
--   table    public.assets                                      (write behaviour only)
--   table    public.style_groups                                (write behaviour only)
--
-- derived-from: 20260708150000
--
-- NO TABLE IS ALTERED. `public.assets` and `public.style_groups` are claimed because
-- this migration changes which rows the function writes to them. No column, index,
-- constraint, trigger, policy or grant on either table is added, altered or removed.
--
-- BASE PROVED, NOT ASSUMED
-- ---------------------------------------------------------------------------------
-- The body below is re-derived from
-- supabase/migrations/20260708150000_dam_strict_style_group_sku_regex.sql. On
-- 2026-09-06 that body was read back from production with
-- `pg_get_functiondef` through the approved read-only identity
-- (current_user = supabase_read_only_user, current_database() = postgres, project ref
-- qsllyeztdwjgirsysgai) and is identical to the repository copy modulo
-- pg_get_functiondef's own header normalisation. The repo-vs-production drift recorded
-- on #2408 concerns public.sync_asset_effective_tags(), NOT this function; that
-- function is not touched here and #2213 already landed a migration for it.
--
-- Existing ACL, read from production the same way, is
-- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}. CREATE OR
-- REPLACE preserves it; the grants at the foot are restated for explicitness and are
-- no-ops. `anon` has no EXECUTE and is deliberately not granted any.
--
-- WHY (issue #2408, measured against production 2026-09-06)
-- ---------------------------------------------------------------------------------
--  1. WRITE AMPLIFICATION. `queue_nightly_rebuild_style_groups()` enqueues
--     force_restart with cursor 0, so every night the whole live asset table is walked
--     and the ~97,658 assets already sitting in the correct style group are re-stamped
--     with the value they already hold. `assets.style_group_id` is indexed, so none of
--     those rewrites can be HOT: each produces a new heap tuple, an entry in every
--     index on `assets`, an FK re-check, and a firing of most of the 14 triggers on
--     `assets` - including trg_dam_search_assets_refresh, which maintains
--     dam_search_documents (731 MB), and assets_effective_tags_sync. Lifetime cost via
--     pg_stat_statements: ~2,982 ms x 3,973 calls ~ 11,849 s.
--
--  2. THE REBUILD IS NOT CONVERGENT, AND THAT IS AN ATTRIBUTION DEFECT, NOT A SPEED
--     ONE. The function only ever SETs style_group_id. `v_ungrouped` counted the batch
--     rows whose SKU came back NULL and then did nothing with them. When a folder is
--     renamed so no path segment matches the SKU rule any more, the asset KEEPS its old
--     style_group_id. `filter_effective_assets` resolves the licensor / property /
--     customer facets through `style_groups` for grouped assets, so that asset goes on
--     appearing under the WRONG LICENSOR in the DAM libraries indefinitely, with no
--     error surfaced anywhere. The only unsetting paths in the system are
--     clear_style_group_batch, the FK's ON DELETE SET NULL, and manual SQL - and
--     clear_style_group_batch is on no cron schedule (verified against cron.job), so
--     nothing automatic corrects it today.
--
--  3. THE style_groups UPSERT REWRITES UNCHANGED ROWS. `ON CONFLICT (sku) DO UPDATE`
--     had no WHERE, so every batch rewrote every group it saw, re-firing
--     trg_dam_search_style_groups_refresh on each. Same defect and same remedy as
--     #2214 on refresh_style_group_counts_batch.
--
-- WHAT CHANGES, EXACTLY - THREE THINGS, AND NOTHING ELSE MOVES
-- ---------------------------------------------------------------------------------
-- (1) The `assigned` CTE gains `AND a.style_group_id IS DISTINCT FROM bg.id`.
--     IS DISTINCT FROM, not `<>`: style_group_id is nullable, and `<>` returns NULL -
--     never true - for the NULL-to-value transition that is exactly the case of a
--     newly grouped asset, so `<>` would stop assigning new assets altogether.
--
-- (2) A new `ungrouped_assets` CTE clears style_group_id on the batch rows whose SKU
--     came back NULL and that still carry a group. The `AND style_group_id IS NOT NULL`
--     half matters as much as the UPDATE: 37,593 of 135,251 live assets are
--     legitimately ungrouped, and without it this arm would re-write every one of them
--     every night - trading one amplification for another.
--     `assets_effective_tags_sync` then strips the group-scope projection rows on its
--     own; no extra call is needed.
--
--     SAFETY OF TWO DATA-MODIFYING CTEs ON THE SAME TABLE: `assigned` and
--     `ungrouped_assets` both UPDATE public.assets in one statement. Their row sets are
--     provably disjoint - `assigned` draws from `grouped_assets` (sku IS NOT NULL) and
--     `ungrouped_assets` from the complementary `sku IS NULL` rows of the same
--     `asset_skus` CTE, and `asset_skus` derives exactly one SKU value per asset id. No
--     row can be touched by both, so the "unpredictable results" caveat on multiple
--     data-modifying CTEs cannot apply.
--
-- (3) The `ON CONFLICT (sku) DO UPDATE` gains a WHERE guard. It is derived
--     mechanically from the SET list: for each of the 19 assigned columns the new value
--     is COALESCE(EXCLUDED.col, style_groups.col), so the row is written only when
--     style_groups.col IS DISTINCT FROM that expression. `updated_at` is excluded on
--     purpose - style_groups carries an unconditional BEFORE UPDATE trigger
--     (update_style_groups_updated_at -> update_updated_at_column) that stamps it on
--     every UPDATE regardless, so including it would make the guard always true and
--     achieve nothing. This is the same reasoning recorded in #2214.
--
-- THE INTERACTION BETWEEN (1) AND (3) - THE REASON `ug` NO LONGER COMES FROM THE UPSERT
-- ---------------------------------------------------------------------------------
-- `ON CONFLICT ... DO UPDATE ... WHERE` does not merely skip the write: it produces NO
-- RETURNING ROW for the suppressed conflict. The old `assigned` CTE joined
-- `upserted_groups` - i.e. that RETURNING - so with (3) in place and (1) alone, every
-- group whose upsert was correctly suppressed would silently vanish from the join and
-- its assets would stop being assigned. A brand-new asset dropped into an existing,
-- already-correct SKU folder would never be grouped, and nothing would report it.
-- (Flagged by GLM 5.3 on #2408.)
--
-- The fix is the new `batch_groups` CTE, the UNION of the upsert's RETURNING with a
-- snapshot read of public.style_groups restricted to this batch's SKUs.
--
-- Neither arm alone is sufficient, and this is why:
--   * The snapshot read of public.style_groups CANNOT see a group this same statement
--     has just INSERTed - every CTE in the statement reads the same pre-statement
--     snapshot - so a genuinely new SKU is visible only through `upserted_groups`.
--   * `upserted_groups` cannot see a group whose upsert was suppressed by (3), so an
--     existing, already-correct SKU is visible only through the snapshot read.
-- The union of the two covers every SKU in the batch exactly once: `style_groups.sku`
-- is unique, and a group that was both pre-existing and actually updated appears in
-- both arms with the SAME (id, sku) pair, which UNION - not UNION ALL - collapses.
-- The behavioural contract covers precisely this case.
--
-- RETURN-VALUE SEMANTICS: NARROWED, AND PROVED SAFE FOR THE ONE CALLER
-- ---------------------------------------------------------------------------------
-- The signature, the five output column names and their types are unchanged. Two of
-- the counters now mean "rows this call actually WROTE" instead of "rows this call
-- looked at", which is what their names already claimed:
--   * `groups_created` counts style_groups rows written (it never counted creations;
--     it counted upserts). It now falls to 0 on a converged batch.
--   * `assets_assigned` counts assets whose style_group_id actually changed.
--   * `assets_ungrouped` counts assets this call actually cleared, not the batch rows
--     that merely happen to have no SKU. Under the old meaning it reported ~37,593
--     assets "ungrouped" every night while ungrouping none of them.
-- `next_cursor` and `done` are untouched, and they are the only two the caller uses to
-- drive the loop.
--
-- THE ONLY CALLER WAS READ, NOT ASSUMED: popdam3
-- apps/worker/src/handlers/style-groups.ts, stage `rebuild_assets`. It branches solely
-- on `row.done` and advances solely on `row.next_cursor`; `groups_created` and
-- `assets_assigned` are passed through to a progress report and `assets_ungrouped` is
-- not read at all. No caller can be using `assets_assigned = 0` as a stop condition in
-- any case: 37,593 of 135,251 live assets are ungrouped today, so batches returning 0
-- assignments already occur under the current body.
--
-- WHAT IS DELIBERATELY NOT DONE HERE (out of scope on #2408)
-- ---------------------------------------------------------------------------------
-- Retiring clear_style_group_batch from scheduled paths; making the nightly run
-- incremental off a watermark; deriving the SKU into a generated column; the
-- statement-level rewrite of sync_asset_effective_tags. Each is a separate issue, and
-- the first two remove the system's only self-healing pass with no detector in place.
-- No index is added or changed: the read half is already index-driven
-- (assets_style_group_id_active_idx, style_groups_pkey, the style_groups sku unique
-- index that the ON CONFLICT arbiter already uses).
--
-- ROLLBACK: a new forward migration restoring the body from
-- supabase/migrations/20260708150000_dam_strict_style_group_sku_regex.sql verbatim.
-- No table, column, index, constraint, trigger, policy or grant is touched here, so
-- nothing else has to be undone.
--
-- Contracts: supabase/tests/style_group_rebuild_guard_and_ungroup_contracts.sql
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.rebuild_style_groups_batch(
  p_last_asset_id uuid DEFAULT NULL,
  p_batch_size int DEFAULT 500
)
RETURNS TABLE(
  next_cursor uuid,
  groups_created int,
  assets_assigned int,
  assets_ungrouped int,
  done boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
SET lock_timeout = '0'
AS $$
DECLARE
  v_last_id uuid;
  v_groups_created int := 0;
  v_assets_assigned int := 0;
  v_ungrouped int := 0;
  v_done boolean;
BEGIN
  WITH asset_batch AS (
    SELECT a.id, a.relative_path, a.filename, a.file_type,
           a.is_licensed, a.licensor_id, a.licensor_code, a.licensor_name,
           a.property_id, a.property_code, a.property_name,
           a.product_category, a.division_code, a.division_name,
           a.mg01_code, a.mg01_name, a.mg02_code, a.mg02_name,
           a.mg03_code, a.mg03_name, a.size_code, a.size_name
    FROM public.assets a
    WHERE a.is_deleted = false
      AND (p_last_asset_id IS NULL OR a.id > p_last_asset_id)
    ORDER BY a.id
    LIMIT p_batch_size
  ),
  asset_skus AS (
    SELECT ab.*,
      (
        SELECT seg
        FROM unnest(string_to_array(ab.relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
        WHERE seg ~ '^[A-Za-z0-9]+$'
          AND seg ~ '[A-Za-z]'
          AND seg ~ '[0-9]'
          AND length(seg) >= 7
          AND ord < array_length(string_to_array(ab.relative_path, '/'), 1)
        ORDER BY ord
        LIMIT 1
      ) AS sku
    FROM asset_batch ab
  ),
  batch_stats AS (
    SELECT count(*)::int AS total_fetched,
           (SELECT s.id FROM asset_skus s ORDER BY s.id DESC LIMIT 1) AS last_id
    FROM asset_skus
  ),
  grouped_assets AS (
    SELECT * FROM asset_skus WHERE sku IS NOT NULL
  ),
  -- Issue #2408 change 2: the complementary half of the batch. These are the assets
  -- whose path no longer yields a SKU; if one still carries a style group, that group
  -- is stale and is resolving the wrong licensor for it in the DAM libraries.
  ungroupable_assets AS (
    SELECT id FROM asset_skus WHERE sku IS NULL
  ),
  sku_representatives AS (
    SELECT DISTINCT ON (sku)
      sku,
      relative_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM grouped_assets
    ORDER BY sku, id
  ),
  sku_with_folder AS (
    SELECT sr.*,
      (
        SELECT string_agg(seg, '/' ORDER BY ord)
        FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
        WHERE ord <= (
          SELECT min(t2.ord)
          FROM unnest(string_to_array(sr.relative_path, '/')) WITH ORDINALITY AS t2(seg, ord)
          WHERE t2.seg = sr.sku
        )
      ) AS folder_path
    FROM sku_representatives sr
  ),
  upserted_groups AS (
    INSERT INTO public.style_groups (
      sku, folder_path, is_licensed, licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    )
    SELECT
      sku, COALESCE(folder_path, sku), COALESCE(is_licensed, false), licensor_id, licensor_code, licensor_name,
      property_id, property_code, property_name, product_category,
      division_code, division_name, mg01_code, mg01_name,
      mg02_code, mg02_name, mg03_code, mg03_name, size_code, size_name
    FROM sku_with_folder
    ON CONFLICT (sku) DO UPDATE SET
      folder_path = COALESCE(EXCLUDED.folder_path, style_groups.folder_path),
      is_licensed = COALESCE(EXCLUDED.is_licensed, style_groups.is_licensed),
      licensor_id = COALESCE(EXCLUDED.licensor_id, style_groups.licensor_id),
      licensor_code = COALESCE(EXCLUDED.licensor_code, style_groups.licensor_code),
      licensor_name = COALESCE(EXCLUDED.licensor_name, style_groups.licensor_name),
      property_id = COALESCE(EXCLUDED.property_id, style_groups.property_id),
      property_code = COALESCE(EXCLUDED.property_code, style_groups.property_code),
      property_name = COALESCE(EXCLUDED.property_name, style_groups.property_name),
      product_category = COALESCE(EXCLUDED.product_category, style_groups.product_category),
      division_code = COALESCE(EXCLUDED.division_code, style_groups.division_code),
      division_name = COALESCE(EXCLUDED.division_name, style_groups.division_name),
      mg01_code = COALESCE(EXCLUDED.mg01_code, style_groups.mg01_code),
      mg01_name = COALESCE(EXCLUDED.mg01_name, style_groups.mg01_name),
      mg02_code = COALESCE(EXCLUDED.mg02_code, style_groups.mg02_code),
      mg02_name = COALESCE(EXCLUDED.mg02_name, style_groups.mg02_name),
      mg03_code = COALESCE(EXCLUDED.mg03_code, style_groups.mg03_code),
      mg03_name = COALESCE(EXCLUDED.mg03_name, style_groups.mg03_name),
      size_code = COALESCE(EXCLUDED.size_code, style_groups.size_code),
      size_name = COALESCE(EXCLUDED.size_name, style_groups.size_name),
      updated_at = now()
    -- Issue #2408 change 3: write the group only when the SET list would actually
    -- change one of its values. Derived mechanically from the SET list above, one
    -- clause per assigned column, in the same order. `updated_at` is intentionally
    -- absent - see the header.
    WHERE (
         style_groups.folder_path      IS DISTINCT FROM COALESCE(EXCLUDED.folder_path, style_groups.folder_path)
      OR style_groups.is_licensed      IS DISTINCT FROM COALESCE(EXCLUDED.is_licensed, style_groups.is_licensed)
      OR style_groups.licensor_id      IS DISTINCT FROM COALESCE(EXCLUDED.licensor_id, style_groups.licensor_id)
      OR style_groups.licensor_code    IS DISTINCT FROM COALESCE(EXCLUDED.licensor_code, style_groups.licensor_code)
      OR style_groups.licensor_name    IS DISTINCT FROM COALESCE(EXCLUDED.licensor_name, style_groups.licensor_name)
      OR style_groups.property_id      IS DISTINCT FROM COALESCE(EXCLUDED.property_id, style_groups.property_id)
      OR style_groups.property_code    IS DISTINCT FROM COALESCE(EXCLUDED.property_code, style_groups.property_code)
      OR style_groups.property_name    IS DISTINCT FROM COALESCE(EXCLUDED.property_name, style_groups.property_name)
      OR style_groups.product_category IS DISTINCT FROM COALESCE(EXCLUDED.product_category, style_groups.product_category)
      OR style_groups.division_code    IS DISTINCT FROM COALESCE(EXCLUDED.division_code, style_groups.division_code)
      OR style_groups.division_name    IS DISTINCT FROM COALESCE(EXCLUDED.division_name, style_groups.division_name)
      OR style_groups.mg01_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg01_code, style_groups.mg01_code)
      OR style_groups.mg01_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg01_name, style_groups.mg01_name)
      OR style_groups.mg02_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg02_code, style_groups.mg02_code)
      OR style_groups.mg02_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg02_name, style_groups.mg02_name)
      OR style_groups.mg03_code        IS DISTINCT FROM COALESCE(EXCLUDED.mg03_code, style_groups.mg03_code)
      OR style_groups.mg03_name        IS DISTINCT FROM COALESCE(EXCLUDED.mg03_name, style_groups.mg03_name)
      OR style_groups.size_code        IS DISTINCT FROM COALESCE(EXCLUDED.size_code, style_groups.size_code)
      OR style_groups.size_name        IS DISTINCT FROM COALESCE(EXCLUDED.size_name, style_groups.size_name)
    )
    RETURNING id, sku
  ),
  -- Issue #2408: the assignment target set. `upserted_groups` alone is NO LONGER a
  -- complete list of this batch's groups, because the WHERE guard above suppresses the
  -- RETURNING row for every group that did not need writing. Reading style_groups alone
  -- is not complete either: this statement's own INSERTs are invisible to a sibling
  -- CTE's snapshot. The UNION of the two is complete and duplicate-free - see header.
  batch_groups AS (
    SELECT ug.id, ug.sku FROM upserted_groups ug
    UNION
    SELECT sg.id, sg.sku
    FROM public.style_groups sg
    JOIN sku_with_folder swf ON swf.sku = sg.sku
  ),
  assigned AS (
    UPDATE public.assets a
    SET style_group_id = bg.id
    FROM grouped_assets ga
    JOIN batch_groups bg ON bg.sku = ga.sku
    WHERE a.id = ga.id
      -- Issue #2408 change 1: never re-stamp an asset that already holds this group.
      -- IS DISTINCT FROM, not `<>`: style_group_id is nullable and `<>` would return
      -- NULL for the NULL-to-value transition, silently skipping every new assignment.
      AND a.style_group_id IS DISTINCT FROM bg.id
    RETURNING 1
  ),
  -- Issue #2408 change 2: the ungroup arm. Disjoint from `assigned` by construction
  -- (sku IS NULL vs sku IS NOT NULL over the same asset_skus rows). The
  -- `style_group_id IS NOT NULL` guard keeps the ~37,593 legitimately ungrouped assets
  -- from being rewritten every night.
  ungrouped_assets AS (
    UPDATE public.assets a
    SET style_group_id = NULL
    FROM ungroupable_assets ua
    WHERE a.id = ua.id
      AND a.style_group_id IS NOT NULL
    RETURNING 1
  )
  SELECT
    (SELECT bs.last_id FROM batch_stats bs),
    (SELECT count(*)::int FROM upserted_groups),
    (SELECT count(*)::int FROM assigned),
    (SELECT count(*)::int FROM ungrouped_assets),
    (SELECT bs.total_fetched FROM batch_stats bs) < p_batch_size
  INTO v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, v_done;

  RETURN QUERY SELECT v_last_id, v_groups_created, v_assets_assigned, v_ungrouped, COALESCE(v_done, true);
END;
$$;

-- Restated to match the ACL read from production; CREATE OR REPLACE already preserves
-- it, so these are no-ops. `anon` holds no EXECUTE and is not granted any.
grant execute on function public.rebuild_style_groups_batch(uuid, int) to authenticated;
grant execute on function public.rebuild_style_groups_batch(uuid, int) to service_role;
grant execute on function public.rebuild_style_groups_batch(uuid, int) to postgres;
