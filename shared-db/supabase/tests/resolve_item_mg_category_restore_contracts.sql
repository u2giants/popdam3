-- shared-db#6305 (reopened 2026-11-16): the production copy of
-- api.resolve_item_mg_category(integer) was removed out-of-band after the
-- clean 2026-11-14 apply of 20261114040632. Migration 20261201120000 restores
-- it byte-for-byte. This contract pins what "restored" means: the function
-- exists, reads the environment's current sources, and keeps the #1662
-- MG01-only shape, volatility, invoker
-- security, cutoff and retirement gate, and carries exactly the original
-- execute rights.

begin;

do $$
declare
  v_def text;
  v_result text;
  v_item_table text;
  v_mg_table text;
  v_rec record;
begin
  if to_regprocedure('api.resolve_item_mg_category(integer)') is null then
    raise exception 'FAIL #6305: api.resolve_item_mg_category(integer) is missing';
  end if;

  v_def := pg_get_functiondef('api.resolve_item_mg_category(integer)'::regprocedure);

  -- The paired production sources remain in dflow_prod. Sandbox now reads
  -- plm items and dflow groups. Also accept the pre-#6198 sandbox baseline.
  if position('dflow_prod."itemHeader"' in v_def) > 0 then
    v_item_table := 'dflow_prod."itemHeader"';
  elsif position('plm."itemHeader"' in v_def) > 0 then
    v_item_table := 'plm."itemHeader"';
  elsif position('dflow."itemHeader"' in v_def) > 0 then
    v_item_table := 'dflow."itemHeader"';
  else
    raise exception 'FAIL #6305: function does not read an app-schema itemHeader';
  end if;
  if position('dflow_prod."merchGroup"' in v_def) > 0 then
    v_mg_table := 'dflow_prod."merchGroup"';
  elsif position('dflow."merchGroup"' in v_def) > 0 then
    v_mg_table := 'dflow."merchGroup"';
  else
    raise exception 'FAIL #6305: function does not read an app-schema merchGroup';
  end if;
  if (v_item_table, v_mg_table) not in (
    ('dflow_prod."itemHeader"', 'dflow_prod."merchGroup"'),
    ('plm."itemHeader"', 'dflow."merchGroup"'),
    ('dflow."itemHeader"', 'dflow."merchGroup"')
  ) then
    raise exception 'FAIL #6305: unexpected source pair (%) and (%)', v_item_table, v_mg_table;
  end if;
  if position('core."merchGroup"' in v_def) > 0 then
    raise exception 'FAIL #6305: function reads the frozen core."merchGroup" copy';
  end if;

  -- #1662 shape pins: MG01-only, TEMPORARY cutoff, documented retirement gate.
  if position('"mgTypeCode" = ''01''' in v_def) = 0 then
    raise exception 'FAIL #6305: MG01-only join is gone';
  end if;
  if position('2025-05-14' in v_def) = 0 then
    raise exception 'FAIL #6305: TEMPORARY 2025-05-14 cutoff is gone';
  end if;
  if position('every historical item' in lower(
    obj_description('api.resolve_item_mg_category(integer)'::regprocedure, 'pg_proc'))) = 0 then
    raise exception 'FAIL #6305: cutoff retirement gate comment is missing';
  end if;

  -- Definition pins: STABLE, security invoker, fixed search_path, table return.
  select p.provolatile, p.prosecdef, p.proconfig, pg_get_function_result(p.oid)
    into v_rec
    from pg_proc p
   where p.oid = 'api.resolve_item_mg_category(integer)'::regprocedure;
  if v_rec.provolatile <> 's' then
    raise exception 'FAIL #6305: expected STABLE, got volatility %', v_rec.provolatile;
  end if;
  if v_rec.prosecdef then
    raise exception 'FAIL #6305: expected security invoker, got security definer';
  end if;
  if v_rec.proconfig is null or not exists (
    select 1 from unnest(v_rec.proconfig) c
     where c like 'search_path=api, core, dflow, public%') then
    raise exception 'FAIL #6305: search_path setting drifted';
  end if;
  v_result := v_rec.pg_get_function_result;
  if v_result not like '%id uuid%' or v_result not like '%code text%'
     or v_result not like '%name text%' then
    raise exception 'FAIL #6305: return shape drifted: %', v_result;
  end if;

  -- The drop destroyed the grants; the restore re-issues exactly the original
  -- rights: authenticated and service_role execute, anon and public do not.
  if not has_function_privilege('authenticated', 'api.resolve_item_mg_category(integer)'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL #6305: authenticated lost EXECUTE';
  end if;
  if not has_function_privilege('service_role', 'api.resolve_item_mg_category(integer)'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL #6305: service_role lost EXECUTE';
  end if;
  if has_function_privilege('anon', 'api.resolve_item_mg_category(integer)'::regprocedure, 'EXECUTE')
     or has_function_privilege('public', 'api.resolve_item_mg_category(integer)'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL #6305: anon/public must not have EXECUTE';
  end if;

  raise notice 'PASS #6305 resolve_item_mg_category restore contracts (reads % + %)', v_item_table, v_mg_table;
end $$;

rollback;
