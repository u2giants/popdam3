-- derived-from: 20260827213024
-- Claim popcre/shared-db#6305. Work issue popcre/designflow-item-master#205,
-- plan plan_merch-group-environment-parity.md step 3.1 item (a).
-- PRODUCTION HALF (schema dflow_prod). Promoted by the normal shared
-- preview -> production lanes. Non-production half is the paired version
-- 20261114040631 (schema dflow).
--
-- Why: production DesignFlow services read and write dflow_prod."itemHeader"
-- and dflow_prod."merchGroup". api.resolve_item_mg_category still reads the
-- stale dflow."itemHeader" and core."merchGroup" copies (core frozen since
-- 2026-06-26), so items and groups created since then cannot resolve a
-- category, and the stale copies cannot be retired (plan step 3.2) while the
-- function names them. Only the two table references change.
--
-- Signature, return shape, volatility, security invoker, search_path,
-- MG01-only rule and the TEMPORARY 2025-05-14 cutoff are byte-for-byte the
-- deployed body (pg_get_functiondef read 2026-11-13 11:15 PM EST). create or
-- replace keeps the existing comment and execute grants
-- (postgres, authenticated, service_role); none are re-issued.
-- Rollback: create or replace the function again with dflow."itemHeader" and
-- core."merchGroup".

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $target$
begin
  if to_regclass('dflow_prod."merchGroup"') is null or to_regclass('dflow_prod."itemHeader"') is null then
    raise exception '#6305/20261114040632 self-check: dflow_prod."merchGroup" or dflow_prod."itemHeader" is missing; wrong database for the production half (non-production half is 20261114040631)'
      using errcode = 'feature_not_supported';
  end if;
  if to_regprocedure('api.resolve_item_mg_category(integer)') is null then
    raise exception '#6305/20261114040632 self-check: api.resolve_item_mg_category(integer) is missing';
  end if;
end
$target$;

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
  from dflow_prod."itemHeader" item
  join dflow_prod."merchGroup" mg01
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

commit;
