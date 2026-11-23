-- derived-from: none
-- #6198 / #4707: repair the #1662 category read contract in DesignFlow test only.
-- The bounded sandbox workflow verifies the project and excludes shared preview
-- and production. The exact live definition is the base, not a ledger version.
-- Rollback: a new sandbox-only migration restoring the previous dflow item source.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $target$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#6198: this migration is DesignFlow test only'
      using errcode = 'feature_not_supported';
  end if;
end
$target$;

do $check$
declare
  resolver_oid oid := to_regprocedure('api.resolve_item_mg_category(integer)');
begin
  if to_regclass('plm."itemHeader"') is null or to_regclass('dflow."merchGroup"') is null then
    raise exception '#6198: missing test item or merchandise group table';
  end if;
  if md5(pg_get_functiondef(resolver_oid)) is distinct from '623d386909775ee26fb5ff4cddba615d' then
    raise exception '#6198: the existing resolver changed since the test audit';
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
  from plm."itemHeader" item
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
