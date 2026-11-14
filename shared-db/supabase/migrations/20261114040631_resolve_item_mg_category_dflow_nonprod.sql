-- derived-from: none
-- Claim popcre/shared-db#6305. Work issue popcre/designflow-item-master#205,
-- plan plan_merch-group-environment-parity.md step 3.1 item (a).
-- DesignFlow NON-PRODUCTION ONLY: project xupnyeifmpsacrqahwwm. Never applied
-- to shared preview or shared production; refuses wherever dflow_prod exists.
-- The production half is the paired version 20261114040632 (dflow_prod).
--
-- Why: 20261113040728 renamed core."merchGroup" to
-- core."merchGroup_retired_20261112". api.resolve_item_mg_category still names
-- core."merchGroup", so on this project every call now fails with
-- 42P01 relation "core.merchGroup" does not exist (read-only probe,
-- 2026-11-13 11:20 PM EST). The DesignFlow services read and write
-- dflow."merchGroup" here, so the function reads that copy instead.
--
-- Only the merchandise-group table changes. Signature, return shape,
-- volatility, security invoker, search_path, MG01-only rule and the
-- TEMPORARY 2025-05-14 cutoff are byte-for-byte the deployed body
-- (pg_get_functiondef read 2026-11-13 11:15 PM EST). create or replace
-- keeps the existing comment and execute grants; none are re-issued, so
-- this project's grants stay exactly as they are.
-- derived-from is none: this project's ledger does not hold 20260827213024
-- (the body arrived before its ledger), so the base is the deployed body read
-- with pg_get_functiondef, not a migration version.
-- Rollback: create or replace the function again with core."merchGroup".

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $target$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#6305/20261114040631 self-check: schema dflow_prod exists here; this migration is DesignFlow non-production only (production half is 20261114040632)'
      using errcode = 'feature_not_supported';
  end if;
end
$target$;

do $check$
begin
  if to_regclass('dflow."merchGroup"') is null or to_regclass('dflow."itemHeader"') is null then
    raise exception '#6305/20261114040631 self-check: dflow."merchGroup" or dflow."itemHeader" is missing';
  end if;
  if to_regprocedure('api.resolve_item_mg_category(integer)') is null then
    raise exception '#6305/20261114040631 self-check: api.resolve_item_mg_category(integer) is missing';
  end if;
end
$check$;

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
  join dflow."merchGroup" mg01
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
