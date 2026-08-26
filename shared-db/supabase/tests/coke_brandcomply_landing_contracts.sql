-- Coca-Cola BrandComply landing contracts for migration 20260826001518.
-- PUBLIC TEST: every value below is invented (ZZTEST / example.invalid).
-- No licensed source label, row, contact, filename, comment or payload appears here.

begin;

do $$
declare
  v_tables integer;
  v_n integer;
  v_name text;
  v_capture uuid := gen_random_uuid();
  v_expected jsonb := jsonb_build_object(
    'approval_items',0,'approval_metadata_values',0,'approval_related_items',0,
    'approval_stage_snapshots',0,'approval_comments',0,'vocabulary_values',0,
    'approval_vocabulary_values',0,'manufacturer_profiles',0,
    'asset_property_options',0,'assets',0,'asset_detail_values',0,'tags',0,
    'asset_tags',0,'contracts',0,'skus',0,'contract_manufacturers',0,
    'royalty_reports',0
  );
  v_result jsonb;
  v_rejected boolean;
begin
  select count(*) into v_tables from information_schema.tables
   where table_schema='plm' and table_name like 'coke\_%' and table_type='BASE TABLE';
  if v_tables <> 18 then raise exception 'expected 18 coke tables, found %',v_tables; end if;

  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='plm' and c.relname like 'coke\_%' and c.relkind='r' and c.relrowsecurity;
  if v_n <> 18 then raise exception 'RLS enabled on % of 18 coke tables',v_n; end if;

  select count(*) into v_n from pg_policies
   where schemaname='plm' and tablename like 'coke\_%';
  if v_n <> 18 then raise exception 'expected 18 staff-read policies, found %',v_n; end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='plm' and table_name like 'coke\_%'
     and grantee='authenticated' and privilege_type='SELECT';
  if v_n <> 18 then raise exception 'authenticated SELECT exists on % of 18 tables',v_n; end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema='plm' and table_name like 'coke\_%'
     and grantee in ('service_role','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then raise exception '% direct write grants bypass the functions',v_n; end if;

  foreach v_name in array array[
    'coke_current_approval_item','coke_current_product_submission',
    'coke_current_packaging_submission','coke_current_manufacturer_submission',
    'coke_current_asset','coke_current_sku','coke_current_contract_manufacturer',
    'coke_current_royalty_report','coke_capture_inventory'
  ] loop
    if to_regclass('api.'||v_name) is null then raise exception 'missing api.%',v_name; end if;
  end loop;

  select count(*) into v_n from information_schema.columns
   where table_schema='api' and table_name like 'coke\_%' and column_name='raw';
  if v_n <> 0 then raise exception 'raw payload exposed by % api column(s)',v_n; end if;

  if has_function_privilege('anon','plm.load_coke_capture_chunk(uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','plm.load_coke_capture_chunk(uuid,text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','plm.load_coke_capture_chunk(uuid,text,jsonb)','EXECUTE')
  then raise exception 'loader privilege contract failed'; end if;

  v_rejected := false;
  begin
    perform plm.load_coke_capture_chunk(gen_random_uuid(),'ZZTEST-unknown','[]'::jsonb);
  exception when others then
    if sqlerrm like '%unsupported entity%' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'unknown empty entity was accepted'; end if;

  perform plm.load_coke_capture_chunk(v_capture,'capture',jsonb_build_array(jsonb_build_object(
    'id',v_capture,'capture_key','ZZTEST-capture','source_repository','ZZTEST/private',
    'source_commit_sha',repeat('0',40),'source_manifest_sha256',repeat('1',64),
    'portal_base_url','https://example.invalid/','account_scope','ZZTEST account',
    'source_captured_at','2026-01-01T00:00:00Z','expected_counts',v_expected,
    'approval_index_complete',true,'asset_index_complete',true,
    'asset_details_complete',false,'media_downloaded',0,'raw_summary','{}'::jsonb,
    'created_by','ZZTEST loader'
  )));

  v_rejected := false;
  begin
    perform plm.load_coke_capture_chunk(v_capture,'capture',jsonb_build_array(jsonb_build_object(
      'id',v_capture,'capture_key','ZZTEST-capture','source_repository','ZZTEST/private',
      'source_commit_sha',repeat('0',40),'source_manifest_sha256',repeat('2',64),
      'portal_base_url','https://example.invalid/','account_scope','ZZTEST account',
      'source_captured_at','2026-01-01T00:00:00Z','expected_counts',v_expected,
      'approval_index_complete',true,'asset_index_complete',true,
      'asset_details_complete',false,'media_downloaded',0,'raw_summary','{}'::jsonb,
      'created_by','ZZTEST loader'
    )));
  exception when others then
    if sqlerrm like '%retry payload differs%' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'changed capture retry was accepted'; end if;

  v_result := plm.finalize_coke_capture(v_capture);
  if v_result->>'status' <> 'complete' then raise exception 'zero-row fixture did not complete'; end if;
  v_result := plm.finalize_coke_capture(v_capture);
  if v_result->>'status' <> 'complete' then raise exception 'finalize retry was not idempotent'; end if;

  if not exists (select 1 from api.source_capture_inventory
    where table_name='coke_capture' and source_system='coca-cola'
      and count_basis='latest_complete' and latest_complete_status='complete')
  then raise exception 'companywide inventory did not register completed coke capture'; end if;

  if not exists (select 1 from api.source_capture_inventory_exact('coke_capture')
    where table_name='coke_capture' and source_system='coca-cola'
      and count_basis='latest_complete' and latest_complete_status='complete'
      and retained_row_count=1 and latest_complete_row_count=1)
  then raise exception 'exact inventory did not use the completed coke capture clock'; end if;

  raise notice 'Coca-Cola landing contracts passed';
end;
$$;

rollback;
