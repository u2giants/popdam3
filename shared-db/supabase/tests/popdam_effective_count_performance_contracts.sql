begin;

do $$
declare
  v_filter text := lower(pg_get_functiondef('public.filter_effective_assets(jsonb)'::regprocedure));
  v_helper text := lower(pg_get_functiondef('public.get_effective_filter_counts_unchecked_1703(jsonb)'::regprocedure));
  v_legacy text := pg_get_functiondef('public.get_filter_counts(jsonb)'::regprocedure);
begin
  if position('left join public.style_groups' in v_filter) > 0
     or position('identity_asset_ids as' in v_filter) = 0
     or position('union all' in v_filter) = 0
     or position('a.licensor_id = ' in v_filter) = 0
     or position('sg.licensor_id = ' in v_filter) = 0
     or position('a.property_id = ' in v_filter) = 0
     or position('sg.property_id = ' in v_filter) = 0
     or position('a.customer_id = ' in v_filter) = 0
     or position('sg.customer_id = ' in v_filter) = 0 then
    raise exception 'effective identity filters lost index-leading UNION arms';
  end if;
  if position('left join public.style_groups' in v_helper) > 0
     or position('identity_asset_ids as' in v_helper) = 0
     or position('union all' in v_helper) = 0
     or position('select a.*' in v_helper) > 0 then
    raise exception 'effective count helper is not a narrow index-leading scan';
  end if;
  if position('get_effective_filter_counts_unchecked_1703' in v_legacy) = 0 then
    raise exception 'legacy filtered counts no longer share the effective count implementation';
  end if;
  if has_function_privilege('anon','public.filter_effective_assets(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or has_function_privilege('anon','public.get_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.filter_effective_assets(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_effective_filter_counts(jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_filter_counts(jsonb)','EXECUTE') then
    raise exception 'effective filter/count privileges changed';
  end if;
end;
$$;

do $$
declare
  v_licensor uuid := gen_random_uuid();
  v_property uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_a3 uuid := gen_random_uuid();
  v_filters jsonb;
  v_legacy jsonb;
  v_effective jsonb;
begin
  insert into plm.licensing_write_authorization
    (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
     actor, protected_columns, expires_at)
  values
    (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation',
     gen_random_uuid(), repeat('2',64), 'issue-2054-contract-test',
     array['name','code','status'], clock_timestamp() + interval '1 minute'),
    (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation',
     gen_random_uuid(), repeat('3',64), 'issue-2054-contract-test',
     array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');

  insert into core.licensor (id,name,code,status)
  values (v_licensor,'ZZ2054 Licensor','ZZ2054L-'||txid_current(),'active');
  insert into core.property (id,licensor_id,name,code,status)
  values (v_property,v_licensor,'ZZ2054 Property','ZZ2054P-'||txid_current(),'potential');
  insert into core.customer (id,name,status)
  values (v_customer,'ZZ2054 Customer '||txid_current(),'active');
  insert into public.style_groups
    (id,sku,folder_path,licensor_id,property_id,customer_id,licensor_name,property_name)
  values (v_group,'ZZ2054-'||txid_current(),'ZZ2054',v_licensor,v_property,v_customer,
    'ZZ2054 Licensor','ZZ2054 Property');

  insert into public.assets
    (id,filename,relative_path,file_type,quick_hash,modified_at,style_group_id,
     licensor_id,property_id,customer_id,status,content_type,product_material,
     thumbnail_url,thumbnail_error,product_category,is_deleted)
  values
    (v_a1,'zz2054-a.ai','ZZ2054/a.ai','ai','zz2054-a-'||txid_current(),now(),v_group,
      null,null,null,'pending','source_art',array['cotton'],'https://example.invalid/a.png',null,'Wall',false),
    (v_a2,'zz2054-b.pdf','ZZ2054/b.pdf','pdf','zz2054-b-'||txid_current(),now(),v_group,
      null,null,null,'pending','source_art',array['cotton'],'https://example.invalid/b.png',null,'Wall',false),
    (v_a3,'zz2054-c.ai','ZZ2054/c.ai','ai','zz2054-c-'||txid_current(),now(),null,
      v_licensor,v_property,v_customer,'tagged','product_photo',array['metal'],null,null,'Other',false);

  -- Grouped rows take group identity; the ungrouped row takes its own identity.
  foreach v_filters in array array[
    jsonb_build_object('licensorId',v_licensor),
    jsonb_build_object('propertyId',v_property),
    jsonb_build_object('customerId',v_customer)
  ] loop
    v_effective := public.get_effective_filter_counts(v_filters);
    v_legacy := public.get_filter_counts(v_filters);
    if (v_effective->>'total')::int <> 3
       or v_effective->>'total' <> v_legacy->>'total'
       or (v_effective->>'total')::int <>
          (select count(*) from public.filter_effective_assets(v_filters)) then
      raise exception 'identity list/count parity failed for %: effective %, legacy %',
        v_filters,v_effective,v_legacy;
    end if;
  end loop;

  -- Legacy get_filter_counts excludes each facet's own selection. The newer
  -- effective API deliberately includes it; pin both live response contracts.
  v_filters := jsonb_build_object('licensorId',v_licensor,
    'fileType',jsonb_build_array('ai'),'status',jsonb_build_array('pending'));
  v_legacy := public.get_filter_counts(v_filters);
  v_effective := public.get_effective_filter_counts(v_filters);
  if v_legacy->>'total' <> '1'
     or v_legacy->'fileType'->>'ai' <> '1'
     or v_legacy->'fileType'->>'pdf' <> '1'
     or v_legacy->'status'->>'pending' <> '1'
     or v_legacy->'status'->>'tagged' <> '1'
     or v_effective->>'total' <> '1'
     or v_effective->'fileType' ? 'pdf'
     or v_effective->'status' ? 'tagged' then
    raise exception 'own-facet semantics changed: legacy %, effective %',v_legacy,v_effective;
  end if;

  v_filters := jsonb_build_object('customerId',v_customer,
    'contentType',jsonb_build_array('source_art'),
    'productMaterial',jsonb_build_array('cotton'),
    'fileStatus',jsonb_build_array('has_preview'),
    'productCategory',jsonb_build_array('Wall'));
  v_legacy := public.get_filter_counts(v_filters);
  v_effective := public.get_effective_filter_counts(v_filters);
  if v_legacy->>'total' <> '2' or v_effective->>'total' <> '2'
     or (select count(*) from public.filter_effective_assets(v_filters)) <> 2 then
    raise exception 'customer/content/material/file/category parity failed: legacy %, effective %',
      v_legacy,v_effective;
  end if;
end;
$$;

rollback;
