-- derived-from: 20261114040632
-- Claim popcre/shared-db#6305 (REOPENED 2026-11-16). Work issue
-- popcre/designflow-item-master#205 step 3.1 item (a), production half repair.
--
-- Why: 20261114040632 applied cleanly to production on 2026-11-14 (run
-- 43562431609, post-apply catalog verification green), but by 2026-11-16
-- api.resolve_item_mg_category(integer) is absent from production pg_proc in
-- every schema (to_regprocedure null) while preview and the DesignFlow sandbox
-- both still have it. No migration in the production ledger through
-- 20261201100000 drops it and no production apply log touches it: it was
-- removed out-of-band. This restore recreates it so the ledger and the live
-- catalog agree again.
--
-- The create or replace block below is byte-for-byte the 20261114040632 body:
-- reads dflow_prod."itemHeader" + dflow_prod."merchGroup" BY DESIGN (owner
-- ruling lane: never repoint to core.property), returns table(id uuid, code
-- text, name text), STABLE, security invoker, MG01-only, TEMPORARY
-- 2025-05-14 cutoff. Because the drop also destroyed the function comment and
-- the execute grants, the comment and the revoke/grant pair from the original
-- creator 20260827213024 are re-issued here (create or replace alone cannot
-- restore them on production; on preview, where the function still exists,
-- both statements are idempotent).
-- Rollback: drop function api.resolve_item_mg_category(integer).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $target$
begin
  if to_regclass('dflow_prod."merchGroup"') is null or to_regclass('dflow_prod."itemHeader"') is null then
    raise exception '#6305/20261201120000 self-check: dflow_prod."merchGroup" or dflow_prod."itemHeader" is missing; wrong database for the production restore'
      using errcode = 'feature_not_supported';
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

comment on function api.resolve_item_mg_category(integer) is
  'Issue #1662 item mgCategory read contract. Returns the stable category code and '
  'display name from the item''s active, division-qualified MG01 only; MG02/MG03 never '
  'participate. TEMPORARY cutoff: pre-2025-05-14 items return no row until a later '
  'governed migration proves every historical item was reclassified under the new '
  'MG01+MG02+MG03 method. Partial analysis, proposed workbook values, or elapsed time '
  'cannot retire the cutoff.';

revoke all on function api.resolve_item_mg_category(integer) from public, anon;
grant execute on function api.resolve_item_mg_category(integer) to authenticated, service_role;

commit;
