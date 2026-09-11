begin;
set local plan_cache_mode=force_generic_plan;

-- Cold count eligibility must not store the thumbnail URL in either covering
-- index. Its presence is represented by disjoint partial-index predicates.
do $$
declare v_name text; v_index regclass;
begin
  foreach v_name in array array['idx_assets_tag_rls_visible_ids','idx_assets_tag_visible_facets','idx_assets_tag_pending_facets'] loop
    v_index := to_regclass('public.'||v_name);
    if v_index is null then raise exception 'missing narrow eligibility index %',v_name; end if;
    if exists(select 1 from pg_index i join pg_attribute a
      on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
      where i.indexrelid=v_index and a.attname='thumbnail_url') then
      raise exception 'narrow eligibility index % stores wide URL payload',v_name;
    end if;
  end loop;
end;
$$;

-- Exercise both timestamp alternatives, old assets with thumbnails, empty
-- (non-null) thumbnails, deleted assets, and duplicate tag scopes. No cutoff
-- setting or application data is changed; the fixture is rolled back.
do $$
declare
  v_cutoff timestamptz := public.assets_thumbnail_min_date();
  v_tag text := 'zz2501-narrow-'||txid_current();
  v_ids uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  v_filters jsonb;
  v_count bigint;
  v_facets jsonb;
begin
  insert into public.assets(id,filename,relative_path,file_type,quick_hash,
    modified_at,file_created_at,thumbnail_url,status,is_deleted)
  values
    (v_ids[1],'zz2501-old.ai','ZZ2501/old.ai','ai',v_tag||'-1',v_cutoff-interval '1 day',v_cutoff-interval '1 day','https://example.invalid/old.png','pending',false),
    (v_ids[2],'zz2501-mod.pdf','ZZ2501/mod.pdf','pdf',v_tag||'-2',v_cutoff+interval '1 day',v_cutoff-interval '1 day',null,'pending',false),
    (v_ids[3],'zz2501-created.ai','ZZ2501/created.ai','ai',v_tag||'-3',v_cutoff-interval '1 day',v_cutoff+interval '1 day',null,'pending',false),
    (v_ids[4],'zz2501-ineligible.ai','ZZ2501/ineligible.ai','ai',v_tag||'-4',v_cutoff-interval '1 day',v_cutoff-interval '1 day',null,'pending',false),
    (v_ids[5],'zz2501-empty.pdf','ZZ2501/empty.pdf','pdf',v_tag||'-5',v_cutoff-interval '1 day',v_cutoff-interval '1 day','','pending',false),
    (v_ids[6],'zz2501-deleted.ai','ZZ2501/deleted.ai','ai',v_tag||'-6',v_cutoff+interval '1 day',v_cutoff+interval '1 day','https://example.invalid/deleted.png','pending',true);
  insert into public.asset_effective_tags(asset_id,tag,scope)
    select id,v_tag,'asset' from unnest(v_ids) id;
  insert into public.asset_effective_tags(asset_id,tag,scope) values(v_ids[1],v_tag,'style_group');
  v_filters := jsonb_build_object('tagFilter',v_tag);
  select count(*) into v_count from public.filter_effective_assets(v_filters);
  v_facets := public.get_filter_counts(v_filters);
  if v_count<>4 or (v_facets->>'total')::bigint<>4
     or v_facets->'fileType'->>'ai'<>'2' or v_facets->'fileType'->>'pdf'<>'2' then
    raise exception 'thumbnail/date eligibility parity failed: list %, facets %',v_count,v_facets;
  end if;
  v_filters := v_filters||'{"fileType":["pdf"]}'::jsonb;
  select count(*) into v_count from public.filter_effective_assets(v_filters);
  v_facets := public.get_filter_counts(v_filters);
  if v_count<>2 or (v_facets->>'total')::bigint<>2 or v_facets->'fileType'->>'ai'<>'2' then
    raise exception 'legacy own-facet exclusion changed';
  end if;
  v_facets := public.get_effective_filter_counts(v_filters);
  if (v_facets->>'total')::bigint<>2 or v_facets->'fileType' ? 'ai' then
    raise exception 'effective own-facet inclusion changed';
  end if;
end;
$$;

rollback;
