-- Version: 20261116120000
-- derived-from: 20261115132055
-- Fix-forward for review finding #6276 on PR #6275.
--
-- 1. Function reads plm.coldlion_item_merch_group (consumer view) instead of
--    coldlion.item_merch_group (RLS-gated base table).  Authenticated callers
--    were seeing zero rows from the base table and always getting empty results.
-- 2. Suggestion mapped CTE now filters to confidence='exact' only.  The
--    needs_review row (lion-king-the-umbrella) and strong_candidate row
--    (lilo-and-stitch-umbrella) were returned identically to exact rows.
-- 3. Explicit least-privilege grants: revoke PUBLIC/anon execute, grant to
--    authenticated and service_role only.

create or replace function plm.suggested_property_for_sku(p_sku text)
returns table (
  mg_code    text,
  mg_desc    text,
  file_count bigint,
  basis      text,
  file_names text[]
)
language sql
stable
as $function$
with
files as (
  select distinct u.file_name,
         lower(regexp_replace(u.file_name, '\.[A-Za-z0-9]{2,5}$', '')) as norm_name
  from public.sku_files_used u
  where u.sku = p_sku
),
dcp_match as (
  select f.file_name, a.id as asset_id
  from files f
  join plm.dcp_asset a
    on lower(regexp_replace(a.file_name, '\.[A-Za-z0-9]{2,5}$', '')) = f.norm_name
  where f.file_name in (
    select u2.file_name
    from public.sku_files_used u2
    left join public.style_guide_files sgf on sgf.id = u2.style_guide_file_id
    where u2.sku = p_sku
      and (sgf.licensor_name ilike '%disney%' or u2.style_guide_file_id is null)
  )
  -- SKU-level Disney restriction (MG05 = DY or DS).
  -- Reads the consumer view, not the RLS-gated base table (review #6276).
  and exists (
    select 1 from plm.coldlion_item_merch_group img
    where img.item_no = p_sku
      and img.slot_no = 5
      and img.mg_code in ('DY','DS')
  )
),
films as (
  select distinct dm.file_name, p.source_id
  from dcp_match dm
  join plm.dcp_asset_property_observation o on o.dcp_asset_id = dm.asset_id
  join plm.dcp_property p on p.id = o.dcp_property_id
  where p.source_id <> 'dcpvault:properties/cl/classics'
),
has_classics as (
  select bool_or(p.source_id = 'dcpvault:properties/cl/classics') as val
  from dcp_match dm
  join plm.dcp_asset_property_observation o on o.dcp_asset_id = dm.asset_id
  join plm.dcp_property p on p.id = o.dcp_property_id
),
nfilms as (
  select count(distinct source_id) as n from films
),
-- Only exact-confidence mappings become suggestions (review #6276).
mapped as (
  select f.source_id, f.file_name, x.mg_code, x.mg_desc
  from films f
  join plm.dcp_property_mg06_crosswalk x on x.dcp_source_id = f.source_id
  where x.mg_code is not null
    and x.confidence = 'exact'
),
agg as (
  select m.mg_code,
         min(m.mg_desc) as mg_desc,
         count(distinct m.file_name) as file_count,
         array_agg(distinct m.file_name order by m.file_name) as file_names
  from mapped m
  group by m.mg_code
)
select a.mg_code,
       a.mg_desc,
       a.file_count,
       case
         when (select n from nfilms) <= 1 then 'single_film'
         when (select val from has_classics) then 'classics_multi'
         else 'multi_film'
       end as basis,
       a.file_names
from agg a
order by a.file_count desc, a.mg_code;
$function$;

comment on function plm.suggested_property_for_sku(text) is
  'Suggest a SKU Disney Property from its style-guide files. '
  'Ranked rows: mg_code, mg_desc, file_count, basis (single_film|multi_film|classics_multi), file_names. '
  'Suggest-only; designer confirms. Only exact-confidence mappings; unmapped films yield no suggestion.';

-- Least-privilege grants (review #6276).
revoke all on function plm.suggested_property_for_sku(text) from public, anon;
grant execute on function plm.suggested_property_for_sku(text) to authenticated, service_role;
