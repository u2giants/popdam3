-- derived-from: none
-- Issue #1662 — item-level mgCategory resolution.
--
-- TEMPORARY CUTOFF: items created before 2025-05-14 deliberately resolve to no
-- category. This cutoff is obsolete only after a separately verified project has
-- reclassified EVERY historical item under the MG01+MG02+MG03 methodology. Remove it
-- only in a later governed migration carrying that complete-reclassification evidence;
-- partial analysis, proposed workbook values, and elapsed time are not evidence.
--
-- Category itself is determined only by the item's division-qualified MG01 row.
-- MG02 and MG03 are intentionally absent from this contract.

create or replace function api.resolve_item_mg_category(p_item_id integer)
returns table (
  id uuid,
  code text,
  name text
)
language sql
stable
security invoker
set search_path = api, core, dflow, public
as $$
  select
    category.id,
    category.code,
    category.name
  from dflow."itemHeader" item
  join core."merchGroup" mg01
    on mg01.mg_id = item.udf_merchgroup01_id
   and mg01."mgTypeCode" = '01'
   and mg01.is_active is true
   and upper(btrim(mg01."divisionCode_fk")) = upper(btrim(item.div_code))
  join core.mg_category_merch_group link
    on link.merch_group_mg_id = mg01.mg_id
  join core.mg_category category
    on category.id = link.mg_category_id
  where item.item_id_pk = p_item_id
    -- TEMPORARY: retire only after verified COMPLETE historical reclassification.
    and item.created_time_date >= timestamp '2025-05-14 00:00:00';
$$;

comment on function api.resolve_item_mg_category(integer) is
  'Issue #1662 item mgCategory read contract. Returns the stable category code and '
  'display name from the item''s active, division-qualified MG01 only; MG02/MG03 never '
  'participate. TEMPORARY cutoff: pre-2025-05-14 items return no row until a later '
  'governed migration proves every historical item was reclassified under the new '
  'MG01+MG02+MG03 method. Partial analysis, proposed workbook values, or elapsed time '
  'cannot retire the cutoff.';

revoke all on function api.resolve_item_mg_category(integer) from public, anon;
grant execute on function api.resolve_item_mg_category(integer) to authenticated, service_role;
