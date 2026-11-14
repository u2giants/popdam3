-- Issue #1662 contract tests for api.resolve_item_mg_category(integer).
-- Runs inside a transaction because the fixtures use shared taxonomy tables.

begin;

do $$
declare
  v_wall_id uuid;
  v_clock_id uuid;
  v_cw_mg integer;
  v_sp_mg integer;
  v_inactive_mg integer;
  v_old_item integer;
  v_boundary_item integer;
  v_other_depth_item integer;
  v_other_division_item integer;
  v_missing_item integer;
  v_unresolved_item integer;
  v_inactive_item integer;
  v_null_date_item integer;
  v_count integer;
  v_code text;
  v_fk_target text;
  v_fn_def text;
  v_item_table text := 'dflow."itemHeader"';
  v_mg_table text := 'core."merchGroup"';
begin
  if to_regprocedure('api.resolve_item_mg_category(integer)') is null then
    raise exception 'FAIL api.resolve_item_mg_category(integer) is missing';
  end if;

  select id into strict v_wall_id from core.mg_category where code = 'WALL';
  select id into strict v_clock_id from core.mg_category where code = 'CLOCK';

  insert into core."merchGroup" (
    mg_code, mg_desc, "mgTypeCode", "companyCode_fk", "divisionCode_fk", is_active
  ) values ('ZZ1662', 'Issue 1662 CW fixture', '01', 'EDGEHOME', 'CW001', true)
  returning mg_id into v_cw_mg;

  insert into core."merchGroup" (
    mg_code, mg_desc, "mgTypeCode", "companyCode_fk", "divisionCode_fk", is_active
  ) values ('ZZ1662', 'Issue 1662 SP fixture', '01', 'EDGEHOME', 'SP001', true)
  returning mg_id into v_sp_mg;

  insert into core."merchGroup" (
    mg_code, mg_desc, "mgTypeCode", "companyCode_fk", "divisionCode_fk", is_active
  ) values ('ZZ1662I', 'Issue 1662 inactive fixture', '01', 'EDGEHOME', 'CW001', false)
  returning mg_id into v_inactive_mg;

  -- #6252: the category link's key may reference the app schema's copy
  -- (dflow / dflow_prod "merchGroup") instead of core; mirror the fixtures there.
  select confrelid::regclass::text into v_fk_target
  from pg_constraint
  where conname = 'mg_category_merch_group_merch_group_mg_id_fkey'
    and conrelid = 'core.mg_category_merch_group'::regclass;
  if v_fk_target is not null and v_fk_target <> 'core."merchGroup"' then
    execute format(
      'insert into %s (mg_id, mg_code, mg_desc, "mgTypeCode", "companyCode_fk", "divisionCode_fk", is_active)
       overriding system value
       select mg_id, mg_code, mg_desc, "mgTypeCode", "companyCode_fk", "divisionCode_fk", is_active
       from core."merchGroup" where mg_id in ($1, $2, $3)', v_fk_target)
      using v_cw_mg, v_sp_mg, v_inactive_mg;
  end if;

  -- #6305: the function itself may read the app schema's copies
  -- (dflow / dflow_prod "itemHeader" and "merchGroup"); seed the fixtures
  -- wherever the deployed body reads them.
  v_fn_def := pg_get_functiondef('api.resolve_item_mg_category(integer)'::regprocedure);
  if position('dflow_prod."merchGroup"' in v_fn_def) > 0 then
    v_mg_table := 'dflow_prod."merchGroup"';
  elsif position('dflow."merchGroup"' in v_fn_def) > 0 then
    v_mg_table := 'dflow."merchGroup"';
  end if;
  if position('dflow_prod."itemHeader"' in v_fn_def) > 0 then
    v_item_table := 'dflow_prod."itemHeader"';
  end if;
  if position('core."merchGroup"' in v_fn_def) > 0 and v_mg_table <> 'core."merchGroup"' then
    raise exception 'FAIL function body names both core."merchGroup" and %', v_mg_table;
  end if;
  if v_mg_table <> 'core."merchGroup"' and v_mg_table is distinct from v_fk_target then
    execute format(
      'insert into %s (mg_id, mg_code, mg_desc, "mgTypeCode", "companyCode_fk", "divisionCode_fk", is_active)
       overriding system value
       select mg_id, mg_code, mg_desc, "mgTypeCode", "companyCode_fk", "divisionCode_fk", is_active
       from core."merchGroup" where mg_id in ($1, $2, $3)', v_mg_table)
      using v_cw_mg, v_sp_mg, v_inactive_mg;
  end if;

  insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id)
  values (v_wall_id, v_cw_mg), (v_clock_id, v_sp_mg), (v_wall_id, v_inactive_mg);

  execute format(
    'insert into %s (created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03)
     values ($1, $2, $3, $4, $5) returning item_id_pk', v_item_table)
    into v_old_item
    using '2025-05-13 23:59:59'::timestamp, 'CW001'::varchar, v_cw_mg::integer, 'MG02-A'::varchar, 'MG03-A'::varchar;

  execute format(
    'insert into %s (created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03)
     values ($1, $2, $3, $4, $5) returning item_id_pk', v_item_table)
    into v_boundary_item
    using '2025-05-14 00:00:00'::timestamp, 'CW001'::varchar, v_cw_mg::integer, 'MG02-A'::varchar, 'MG03-A'::varchar;

  execute format(
    'insert into %s (created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03)
     values ($1, $2, $3, $4, $5) returning item_id_pk', v_item_table)
    into v_other_depth_item
    using '2025-05-14 12:00:00'::timestamp, 'CW001'::varchar, v_cw_mg::integer, 'MG02-CHANGED'::varchar, 'MG03-CHANGED'::varchar;

  execute format(
    'insert into %s (created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03)
     values ($1, $2, $3, $4, $5) returning item_id_pk', v_item_table)
    into v_other_division_item
    using '2025-05-14 12:00:00'::timestamp, 'SP001'::varchar, v_sp_mg::integer, null::varchar, null::varchar;

  execute format(
    'insert into %s (created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03)
     values ($1, $2, $3, $4, $5) returning item_id_pk', v_item_table)
    into v_missing_item
    using '2025-05-14 12:00:00'::timestamp, 'CW001'::varchar, null::integer, null::varchar, null::varchar;

  execute format(
    'insert into %s (created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03)
     values ($1, $2, $3, $4, $5) returning item_id_pk', v_item_table)
    into v_unresolved_item
    using '2025-05-14 12:00:00'::timestamp, 'SP001'::varchar, v_cw_mg::integer, null::varchar, null::varchar;

  execute format(
    'insert into %s (created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03)
     values ($1, $2, $3, $4, $5) returning item_id_pk', v_item_table)
    into v_inactive_item
    using '2025-05-14 12:00:00'::timestamp, 'CW001'::varchar, v_inactive_mg::integer, null::varchar, null::varchar;

  execute format(
    'insert into %s (created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03)
     values ($1, $2, $3, $4, $5) returning item_id_pk', v_item_table)
    into v_null_date_item
    using null::timestamp, 'CW001'::varchar, v_cw_mg::integer, null::varchar, null::varchar;

  select count(*) into v_count from api.resolve_item_mg_category(v_old_item);
  if v_count <> 0 then
    raise exception 'FAIL 2025-05-13 item resolved a category';
  end if;

  select count(*), min(code) into v_count, v_code
  from api.resolve_item_mg_category(v_boundary_item);
  if v_count <> 1 or v_code <> 'WALL' then
    raise exception 'FAIL 2025-05-14 boundary item expected WALL, got % row(s), code %', v_count, v_code;
  end if;

  select min(code) into v_code from api.resolve_item_mg_category(v_other_depth_item);
  if v_code <> 'WALL' then
    raise exception 'FAIL MG02/MG03 changed category: expected WALL, got %', v_code;
  end if;

  select min(code) into v_code from api.resolve_item_mg_category(v_other_division_item);
  if v_code <> 'CLOCK' then
    raise exception 'FAIL division-qualified MG01 expected CLOCK, got %', v_code;
  end if;

  select count(*) into v_count from api.resolve_item_mg_category(v_missing_item);
  if v_count <> 0 then
    raise exception 'FAIL missing MG01 resolved a category';
  end if;

  select count(*) into v_count from api.resolve_item_mg_category(v_unresolved_item);
  if v_count <> 0 then
    raise exception 'FAIL cross-division MG01 resolved a category';
  end if;

  select count(*) into v_count from api.resolve_item_mg_category(v_inactive_item);
  if v_count <> 0 then
    raise exception 'FAIL inactive MG01 resolved a category';
  end if;

  select count(*) into v_count from api.resolve_item_mg_category(v_null_date_item);
  if v_count <> 0 then
    raise exception 'FAIL item with NULL created_time_date resolved a category';
  end if;

  if position('2025-05-14' in pg_get_functiondef('api.resolve_item_mg_category(integer)'::regprocedure)) = 0
     or position('every historical item' in lower(
       obj_description('api.resolve_item_mg_category(integer)'::regprocedure, 'pg_proc'))) = 0 then
    raise exception 'FAIL temporary cutoff or exact retirement gate is not documented';
  end if;

  raise notice 'PASS issue #1662 item mgCategory resolution contracts';
end;
$$;

rollback;
