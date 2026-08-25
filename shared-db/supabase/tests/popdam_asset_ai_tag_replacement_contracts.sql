-- #1498 transaction-rolled-back contracts for durable AI replacement authority.
begin;

do $$
declare
  v_asset uuid := gen_random_uuid();
  v_other_asset uuid := gen_random_uuid();
  v_manual_owner uuid := gen_random_uuid();
  v_suffix text := txid_current()::text;
  v_legacy text := 'zz1498_legacy_' || v_suffix;
  v_stale text := 'zz1498_stale_' || v_suffix;
  v_manual text := 'zz1498_manual_' || v_suffix;
  v_rejected_same text := 'zz1498_rejected_same_' || v_suffix;
  v_rejected_legacy text := 'zz1498_rejected_legacy_' || v_suffix;
  v_current text := 'zz1498_current_' || v_suffix;
  v_other text := 'zz1498_other_' || v_suffix;
  v_manual_before jsonb;
  v_other_before jsonb;
  v_rejected_same_before jsonb;
  v_rejected_legacy_before jsonb;
  v_definition text;
begin
  insert into public.assets(id, filename, relative_path, file_type, quick_hash, modified_at, is_deleted)
  values
    (v_asset, 'zz1498.ai', 'ZZ1498/zz1498.ai', 'ai', 'zz1498-' || v_suffix, now(), false),
    (v_other_asset, 'zz1498-other.ai', 'ZZ1498/zz1498-other.ai', 'ai', 'zz1498-other-' || v_suffix, now(), false);

  insert into public.asset_tags(asset_id, tag, source, category, status, model, rejected_at, created_by)
  values
    (v_asset, v_legacy, 'ai', 'legacy_unscoped', 'active', null, null, null),
    (v_asset, v_stale, 'ai', 'scene', 'candidate', 'old-model', null, null),
    (v_asset, v_rejected_same, 'ai', 'scene', 'rejected', 'new-model', now(), null),
    (v_asset, v_rejected_legacy, 'ai', 'legacy_unscoped', 'rejected', null, now(), null),
    (v_other_asset, v_other, 'ai', 'scene', 'active', 'old-model', null, null);

  insert into public.asset_tags(asset_id, tag, source, category, status, model, created_by, evidence)
  values(v_asset, v_manual, 'manual', 'other', 'active', null, v_manual_owner,
    jsonb_build_object('authority', 'manual'));

  select to_jsonb(t) into v_manual_before
  from public.asset_tags t where t.asset_id = v_asset and t.tag = v_manual;
  select to_jsonb(t) into v_other_before
  from public.asset_tags t where t.asset_id = v_other_asset and t.tag = v_other;
  select to_jsonb(t) into v_rejected_same_before
  from public.asset_tags t where t.asset_id = v_asset and t.tag = v_rejected_same;
  select to_jsonb(t) into v_rejected_legacy_before
  from public.asset_tags t where t.asset_id = v_asset and t.tag = v_rejected_legacy;

  if exists (select 1 from public.asset_tags where asset_id = v_asset
      and tag in (v_legacy, v_stale) and created_by is not null) then
    raise exception 'AI fixture rows unexpectedly acquired created_by authority';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.replace_asset_ai_tag_result(v_asset, 'ai', 'new-model', jsonb_build_array(
    jsonb_build_object('tag', v_manual, 'category', 'scene', 'status', 'active', 'confidence', 0.9),
    jsonb_build_object('tag', v_rejected_same, 'category', 'view', 'status', 'active', 'confidence', 0.8),
    jsonb_build_object('tag', v_rejected_legacy, 'category', 'view', 'status', 'active', 'confidence', 0.7),
    jsonb_build_object('tag', v_current, 'category', 'scene', 'status', 'active', 'confidence', 0.95)
  ));

  if exists (select 1 from public.asset_tags where asset_id = v_asset and tag in (v_legacy, v_stale)) then
    raise exception 'prior model/null-model AI active or candidate row survived replacement: %',
      (select jsonb_agg(jsonb_build_object('tag', tag, 'source', source, 'status', status,
        'model', model, 'created_by', created_by))
       from public.asset_tags where asset_id = v_asset and tag in (v_legacy, v_stale));
  end if;
  if not exists (select 1 from public.asset_tags where asset_id = v_asset and tag = v_current
      and source = 'ai' and model = 'new-model' and status = 'active') then
    raise exception 'current AI result was not inserted';
  end if;
  if (select to_jsonb(t) from public.asset_tags t where t.asset_id = v_asset and t.tag = v_manual)
       is distinct from v_manual_before then
    raise exception 'manual collision was changed';
  end if;
  if (select to_jsonb(t) from public.asset_tags t where t.asset_id = v_asset and t.tag = v_rejected_same)
       is distinct from v_rejected_same_before
     or (select to_jsonb(t) from public.asset_tags t where t.asset_id = v_asset and t.tag = v_rejected_legacy)
       is distinct from v_rejected_legacy_before then
    raise exception 'rejected same-model or legacy tombstone was resurrected or changed';
  end if;
  if (select to_jsonb(t) from public.asset_tags t where t.asset_id = v_other_asset and t.tag = v_other)
       is distinct from v_other_before then
    raise exception 'unrelated asset was changed';
  end if;

  -- Rerunning the same result is idempotent and cannot make tombstones searchable.
  perform public.replace_asset_ai_tag_result(v_asset, 'ai', 'new-model', jsonb_build_array(
    jsonb_build_object('tag', v_manual, 'category', 'scene', 'status', 'active', 'confidence', 0.9),
    jsonb_build_object('tag', v_rejected_same, 'category', 'view', 'status', 'active', 'confidence', 0.8),
    jsonb_build_object('tag', v_rejected_legacy, 'category', 'view', 'status', 'active', 'confidence', 0.7),
    jsonb_build_object('tag', v_current, 'category', 'scene', 'status', 'active', 'confidence', 0.95)
  ));
  if (select count(*) from public.asset_tags where asset_id = v_asset and tag = v_current) <> 1 then
    raise exception 'replacement rerun was not idempotent';
  end if;
  if position(v_rejected_same in coalesce((select search_text from public.dam_search_documents
        where document_type = 'asset' and entity_id = v_asset), '')) > 0
     or position(v_rejected_legacy in coalesce((select search_text from public.dam_search_documents
        where document_type = 'asset' and entity_id = v_asset), '')) > 0 then
    raise exception 'rejected tombstone leaked into active search data';
  end if;

  if has_function_privilege('authenticated',
       'public.replace_asset_ai_tag_result(uuid,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role',
       'public.replace_asset_ai_tag_result(uuid,text,text,jsonb)', 'EXECUTE') then
    raise exception 'service-role-only execution contract changed';
  end if;
  select pg_get_functiondef('public.replace_asset_ai_tag_result(uuid,text,text,jsonb)'::regprocedure)
    into v_definition;
  if position('refresh_dam_search_documents_batch(array[p_asset_id], ''{}''::uuid[], 2)' in v_definition) = 0 then
    raise exception 'bounded search refresh contract changed';
  end if;
end
$$;

rollback;
