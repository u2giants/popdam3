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

  insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id)
  values (v_wall_id, v_cw_mg), (v_clock_id, v_sp_mg), (v_wall_id, v_inactive_mg);

  insert into dflow."itemHeader" (
    created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03
  ) values ('2025-05-13 23:59:59', 'CW001', v_cw_mg, 'MG02-A', 'MG03-A')
  returning item_id_pk into v_old_item;

  insert into dflow."itemHeader" (
    created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03
  ) values ('2025-05-14 00:00:00', 'CW001', v_cw_mg, 'MG02-A', 'MG03-A')
  returning item_id_pk into v_boundary_item;

  insert into dflow."itemHeader" (
    created_time_date, div_code, udf_merchgroup01_id, udf_merchgroup02, udf_merchgroup03
  ) values ('2025-05-14 12:00:00', 'CW001', v_cw_mg, 'MG02-CHANGED', 'MG03-CHANGED')
  returning item_id_pk into v_other_depth_item;

  insert into dflow."itemHeader" (created_time_date, div_code, udf_merchgroup01_id)
  values ('2025-05-14 12:00:00', 'SP001', v_sp_mg)
  returning item_id_pk into v_other_division_item;

  insert into dflow."itemHeader" (created_time_date, div_code, udf_merchgroup01_id)
  values ('2025-05-14 12:00:00', 'CW001', null)
  returning item_id_pk into v_missing_item;

  insert into dflow."itemHeader" (created_time_date, div_code, udf_merchgroup01_id)
  values ('2025-05-14 12:00:00', 'SP001', v_cw_mg)
  returning item_id_pk into v_unresolved_item;

  insert into dflow."itemHeader" (created_time_date, div_code, udf_merchgroup01_id)
  values ('2025-05-14 12:00:00', 'CW001', v_inactive_mg)
  returning item_id_pk into v_inactive_item;

  insert into dflow."itemHeader" (created_time_date, div_code, udf_merchgroup01_id)
  values (null, 'CW001', v_cw_mg)
  returning item_id_pk into v_null_date_item;

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
