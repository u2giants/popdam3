-- Issue #2478; claim #2745; reserved version 20260911212849.
-- Shared path-to-SKU derivation. No application rows are repaired by this migration.
-- derived-from: 20260906035323
-- derived-from: 20260907031246
-- Consumers retain their signatures, settings, SECURITY DEFINER, ACLs and behavior.
-- CREATE OR REPLACE preserves their current owners and grants. The only body
-- changes delegate the existing expression to the helper and retire its stale note.

CREATE FUNCTION public.style_group_key_for_sku(p_relative_path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
AS $$
  SELECT seg
  FROM pg_catalog.unnest(pg_catalog.string_to_array(p_relative_path, '/')) WITH ORDINALITY AS t(seg, ord)
  WHERE seg ~ '^[A-Za-z0-9]+$'
    AND seg ~ '[A-Za-z]'
    AND seg ~ '[0-9]'
    AND pg_catalog.length(seg) >= 7
    AND ord < pg_catalog.array_length(pg_catalog.string_to_array(p_relative_path, '/'), 1)
  ORDER BY ord
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.style_group_key_for_sku(text) FROM PUBLIC;
-- Hosted Supabase grants anon and authenticated EXECUTE at CREATE FUNCTION time;
-- revoking PUBLIC alone leaves those named grants behind.
REVOKE ALL ON FUNCTION public.style_group_key_for_sku(text) FROM anon;
REVOKE ALL ON FUNCTION public.style_group_key_for_sku(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.style_group_key_for_sku(text) TO postgres, service_role;

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
      public.style_group_key_for_sku(ab.relative_path) AS sku
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

create or replace function public.reconcile_style_group_drift(
  p_effective_tag_sample integer default 5000
)
returns table (
  observed_at timestamptz,
  live_assets bigint,
  grouped_assets bigint,
  ungrouped_assets bigint,
  style_group_rows bigint,
  effective_tag_rows bigint,
  assets_missing_or_wrong_group bigint,
  assets_with_unexpected_group bigint,
  orphan_group_references bigint,
  effective_tag_sample_assets bigint,
  effective_tag_missing_rows bigint,
  effective_tag_extra_rows bigint,
  effective_tag_drifted_assets bigint,
  effective_tag_drift_rate numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '600s'
set lock_timeout = '5s'
as $$
with live as (
  select
    a.id,
    a.style_group_id,
    -- Shared with the rebuild; the detector never repairs rows.
    public.style_group_key_for_sku(a.relative_path) AS sku
  from public.assets a
  where a.is_deleted = false
),
resolved as (
  select
    l.id,
    l.style_group_id,
    l.sku,
    expected.id as expected_group_id,
    (held.id is not null) as held_group_exists
  from live l
  -- The group the SKU rule says this asset belongs in. NULL when the path yields no
  -- SKU, and also NULL when it yields one for which no style_groups row exists yet.
  left join public.style_groups expected on expected.sku = l.sku
  -- The group the asset actually points at. A NULL here with a non-null
  -- style_group_id is an orphan reference.
  left join public.style_groups held on held.id = l.style_group_id
),
group_drift as (
  select
    count(*) as live_assets,
    count(*) filter (where style_group_id is not null) as grouped_assets,
    count(*) filter (where style_group_id is null) as ungrouped_assets,
    -- 1a. Should be grouped; is not, or is in the wrong group. `expected_group_id is
    -- null` is included on purpose: a SKU with no style_groups row is an asset the
    -- rebuild would group on its next pass, so it is drift now.
    count(*) filter (
      where sku is not null
        and (expected_group_id is null or style_group_id is distinct from expected_group_id)
    ) as assets_missing_or_wrong_group,
    -- 1b. Carries a group but should not.
    count(*) filter (where sku is null and style_group_id is not null)
      as assets_with_unexpected_group,
    -- 2. Points at a style_groups row that does not exist.
    count(*) filter (where style_group_id is not null and not held_group_exists)
      as orphan_group_references
  from resolved
),
tag_sample as (
  select r.id, r.style_group_id
  from resolved r
  order by random()
  limit greatest(coalesce(p_effective_tag_sample, 0), 0)
),
desired_tags as (
  select s.id as asset_id, t.tag, 'asset'::text as scope
  from tag_sample s
  join public.asset_tags t
    on t.asset_id = s.id
   and t.status = 'active'
  union
  select s.id, gt.tag, 'style_group'::text
  from tag_sample s
  join public.style_group_tags gt
    on gt.style_group_id = s.style_group_id
   and gt.status = 'active'
),
actual_tags as (
  select e.asset_id, e.tag, e.scope
  from tag_sample s
  join public.asset_effective_tags e on e.asset_id = s.id
),
missing_tags as (
  select asset_id, tag, scope from desired_tags
  except
  select asset_id, tag, scope from actual_tags
),
extra_tags as (
  select asset_id, tag, scope from actual_tags
  except
  select asset_id, tag, scope from desired_tags
),
tag_drift as (
  select
    (select count(*) from tag_sample) as sample_assets,
    (select count(*) from missing_tags) as missing_rows,
    (select count(*) from extra_tags) as extra_rows,
    (
      select count(*)
      from (
        select asset_id from missing_tags
        union
        select asset_id from extra_tags
      ) drifted
    ) as drifted_assets
)
select
  now(),
  g.live_assets,
  g.grouped_assets,
  g.ungrouped_assets,
  (select count(*) from public.style_groups),
  (select count(*) from public.asset_effective_tags),
  g.assets_missing_or_wrong_group,
  g.assets_with_unexpected_group,
  g.orphan_group_references,
  t.sample_assets,
  t.missing_rows,
  t.extra_rows,
  t.drifted_assets,
  case
    when t.sample_assets = 0 then null
    else round(t.drifted_assets::numeric / t.sample_assets::numeric, 6)
  end
from group_drift g
cross join tag_drift t;
$$;
