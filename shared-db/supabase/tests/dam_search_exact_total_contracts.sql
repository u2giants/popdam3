-- #5747 Step 5: the unfiltered fast path returns exactly the probe's total.
-- '{"customer":""}' is a no-op filter that forces the per-document probe, so
-- every check compares the fast path with the original exact algorithm.
begin;
set local search_path=pg_catalog,public,extensions;

create function pg_temp.t5747(p_f jsonb) returns bigint language sql as $$
  select min(total_count) from public.search_dam_documents('zq5747token', p_f, 10, 0, null, null, 0, null)
$$;
create function pg_temp.flag(p_type text, p_id uuid) returns boolean language sql as $$
  select has_default_visible_member from public.dam_search_documents where document_type=p_type and entity_id=p_id
$$;

do $test$
declare
  g1 uuid; g2 uuid; a1 uuid; a2 uuid; a3 uuid; a4 uuid;
  old_ts timestamptz := '2000-01-01';
  fast bigint; probe bigint; had_cfg boolean; old_cfg jsonb;
begin
  insert into public.style_groups (sku, folder_path) values ('ZQ5747A', '/zq5747/a') returning id into g1;
  insert into public.style_groups (sku, folder_path) values ('ZQ5747B', '/zq5747/b') returning id into g2;
  -- a1 visible (thumbnail), a2 hidden (old, no thumbnail), both in g1
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq5747a1.pdf','zq5747/zq5747a1.pdf','pdf','zq5747a1', now(), now(), 'https://example.invalid/1.png', g1) returning id into a1;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq5747a2.pdf','zq5747/zq5747a2.pdf','pdf','zq5747a2', old_ts, old_ts, null, g1) returning id into a2;
  -- a3 visible in g2, a4 visible standalone ai file
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq5747a3.pdf','zq5747/zq5747a3.pdf','pdf','zq5747a3', now(), now(), null, g2) returning id into a3;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url)
    values ('zq5747a4.ai','zq5747/zq5747a4.ai','ai','zq5747a4', now(), now(), null) returning id into a4;

  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path)
  values ('style_group', g1, null, g1, 'zq5747token group one', '/zq5747/a'),
         ('style_group', g2, null, g2, 'zq5747token group two', '/zq5747/b'),
         ('asset', a2, a2, g1, 'zq5747token hidden asset', 'zq5747/zq5747a2.pdf'),
         ('asset', a4, a4, null, 'zq5747token standalone', 'zq5747/zq5747a4.ai')
  on conflict (document_type, entity_id) do update
    set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path;

  -- Flags set at insert, stamped with the current min date
  if pg_temp.flag('style_group',g1) is not true or pg_temp.flag('style_group',g2) is not true
     or pg_temp.flag('asset',a2) is not false or pg_temp.flag('asset',a4) is not true then
    raise exception '#5747 insert-time flags wrong';
  end if;
  if exists (select 1 from public.dam_search_documents where entity_id in (g1,g2,a2,a4)
             and default_visible_min_date is distinct from public.assets_thumbnail_min_date()) then
    raise exception '#5747 flag min date not stamped';
  end if;

  -- One visible + one hidden member counted once; thumbnail-null old asset not counted
  fast := pg_temp.t5747('{}'); probe := pg_temp.t5747('{"customer":""}');
  if fast <> 3 or probe <> 3 then raise exception '#5747 baseline totals fast=% probe=% (want 3)', fast, probe; end if;

  -- Filter predicates respected (filtered path untouched)
  if pg_temp.t5747('{"fileType":["ai"]}') <> 1 then raise exception '#5747 fileType filter total wrong'; end if;

  -- Delete the only visible member of g2 in the same transaction -> total drops by one
  update public.assets set is_deleted = true where id = a3;
  if pg_temp.flag('style_group',g2) is not false then raise exception '#5747 soft delete did not clear flag'; end if;
  fast := pg_temp.t5747('{}'); probe := pg_temp.t5747('{"customer":""}');
  if fast <> 2 or probe <> 2 then raise exception '#5747 after delete fast=% probe=% (want 2)', fast, probe; end if;

  -- Move a1 from g1 to g2: g1 loses its only visible member, g2 gains one
  update public.assets set style_group_id = g2 where id = a1;
  if pg_temp.flag('style_group',g1) is not false or pg_temp.flag('style_group',g2) is not true then
    raise exception '#5747 move did not update both groups';
  end if;
  fast := pg_temp.t5747('{}'); probe := pg_temp.t5747('{"customer":""}');
  if fast <> probe then raise exception '#5747 after move fast=% probe=%', fast, probe; end if;

  -- Hidden asset becomes visible via thumbnail
  update public.assets set thumbnail_url = 'https://example.invalid/2.png' where id = a2;
  if pg_temp.flag('asset',a2) is not true or pg_temp.flag('style_group',g1) is not true then
    raise exception '#5747 thumbnail change did not set flags';
  end if;

  -- Hard delete
  delete from public.assets where id = a4;
  fast := pg_temp.t5747('{}'); probe := pg_temp.t5747('{"customer":""}');
  if fast <> probe then raise exception '#5747 after hard delete fast=% probe=%', fast, probe; end if;

  -- THUMBNAIL_MIN_DATE change: guard forces the probe until the sweep runs
  update public.assets set thumbnail_url = null where id = a2;
  select true, value into had_cfg, old_cfg from public.admin_config where key='THUMBNAIL_MIN_DATE';
  if had_cfg then
    update public.admin_config set value = to_jsonb('1999-01-01'::text) where key='THUMBNAIL_MIN_DATE';
  else
    insert into public.admin_config (key, value) values ('THUMBNAIL_MIN_DATE', to_jsonb('1999-01-01'::text));
  end if;
  fast := pg_temp.t5747('{}'); probe := pg_temp.t5747('{"customer":""}');
  if fast <> probe then raise exception '#5747 stale-min-date fast=% probe=%', fast, probe; end if;
  perform public.dam_sweep_default_visible_flags(1000000);
  if pg_temp.flag('asset',a2) is not true then raise exception '#5747 sweep did not recompute with new min date'; end if;
  fast := pg_temp.t5747('{}'); probe := pg_temp.t5747('{"customer":""}');
  if fast <> probe then raise exception '#5747 post-sweep fast=% probe=%', fast, probe; end if;

  -- A NULL flag forces the probe
  update public.dam_search_documents set has_default_visible_member = null where document_type='style_group' and entity_id=g1;
  fast := pg_temp.t5747('{}'); probe := pg_temp.t5747('{"customer":""}');
  if fast <> probe then raise exception '#5747 null-flag fast=% probe=%', fast, probe; end if;

  -- #5850: no shared-lock-table use; cron sweep commits per document
  if exists (select 1 from pg_proc where proname in ('dam_refresh_default_visible_flag','dam_search_documents_set_default_visible','assets_refresh_default_visible_flags','dam_lock_default_visible_owner') and prosrc ilike '%advisory%')
     or to_regprocedure('public.dam_sweep_default_visible_flags_batched(integer)') is null
     or not exists (select 1 from pg_proc where oid=to_regprocedure('public.dam_sweep_default_visible_flags_batched(integer)') and prokind='p') then
    raise exception '#5850 flag locking contract changed';
  end if;

  -- Internal functions are not callable by API roles
  if has_function_privilege('authenticated','public.dam_sweep_default_visible_flags(integer)','EXECUTE')
     or has_function_privilege('anon','public.dam_refresh_default_visible_flag(text,uuid)','EXECUTE') then
    raise exception '#5747 internal functions exposed to API roles';
  end if;
end;
$test$;

-- #5747 truncation shortcut: when the unfiltered fast path is valid and the
-- flag count already proves the visibility probe would truncate, the probe is
-- skipped. Totals, the page, and has_more must equal the probe path exactly;
-- facets keep the blank-when-truncated fallback (and stay filled below the
-- cap). 1001 visible + 20 hidden documents matching one token, plus a small
-- 3-document control token, cover both branches.
do $test$
declare
  fast_total bigint; probe_total bigint;
  fast_facets jsonb; probe_facets jsonb;
  fast_page uuid[]; probe_page uuid[];
  fast_more boolean; probe_more boolean;
  small_total bigint; small_facets jsonb;
begin
  insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url)
  select md5('zq5747t-a' || i)::uuid, 'zq5747trunc' || i || '.pdf', 'zq5747/trunc/' || i || '.pdf', 'pdf',
         'zq5747trunc' || i, now(), now(), 'https://example.invalid/t.png'
  from generate_series(1, 1021) i;
  -- 20 hidden extras: older than the active THUMBNAIL_MIN_DATE (the first test
  -- block above sets it to 1999-01-01), no thumbnail -> flags false, candidates
  -- but not visible
  update public.assets set thumbnail_url = null, modified_at = '1990-01-01', file_created_at = '1990-01-01'
  where id in (select md5('zq5747t-a' || i)::uuid from generate_series(1002, 1021) i);
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path)
  select 'asset', md5('zq5747t-a' || i)::uuid, md5('zq5747t-a' || i)::uuid, null,
         'zq5747trunc doc ' || i, 'zq5747/trunc/' || i || '.pdf'
  from generate_series(1, 1021) i
  on conflict (document_type, entity_id) do update
    set asset_id = excluded.asset_id, style_group_id = excluded.style_group_id,
        title = excluded.title, path = excluded.path;
  insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url)
  select md5('zq5747s-a' || i)::uuid, 'zq5747small' || i || '.pdf', 'zq5747/small/' || i || '.pdf', 'pdf',
         'zq5747small' || i, now(), now(), 'https://example.invalid/s.png'
  from generate_series(1, 3) i;
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path)
  select 'asset', md5('zq5747s-a' || i)::uuid, md5('zq5747s-a' || i)::uuid, null,
         'zq5747small doc ' || i, 'zq5747/small/' || i || '.pdf'
  from generate_series(1, 3) i
  on conflict (document_type, entity_id) do update
    set asset_id = excluded.asset_id, style_group_id = excluded.style_group_id,
        title = excluded.title, path = excluded.path;

  select min(total_count), min(facets::text)::jsonb, bool_and(has_more)
    into fast_total, fast_facets, fast_more
  from public.search_dam_documents('zq5747trunc', '{}'::jsonb, 5, 0, null, null, 0, null);
  select min(total_count), min(facets::text)::jsonb, bool_and(has_more)
    into probe_total, probe_facets, probe_more
  from public.search_dam_documents('zq5747trunc', '{"customer":""}'::jsonb, 5, 0, null, null, 0, null);
  if fast_total <> 1001 or probe_total <> 1001 then
    raise exception '#5747 trunc totals fast=% probe=% (want 1001)', fast_total, probe_total;
  end if;
  if fast_more is not true or probe_more is not true then
    raise exception '#5747 trunc has_more fast=% probe=% (want true)', fast_more, probe_more;
  end if;
  if fast_facets->'fileType' <> '{}'::jsonb or probe_facets->'fileType' <> '{}'::jsonb
     or fast_facets->>'totalExact' is distinct from 'true' then
    raise exception '#5747 truncated facets must be the blank fallback (fast=% probe=%)', fast_facets, probe_facets;
  end if;

  select array_agg(r.entity_id order by r.rank desc nulls last, r.document_type nulls last, r.entity_id nulls last)
    into fast_page
  from (select * from public.search_dam_documents('zq5747trunc', '{}'::jsonb, 5, 0, null, null, 0, null)) r;
  select array_agg(r.entity_id order by r.rank desc nulls last, r.document_type nulls last, r.entity_id nulls last)
    into probe_page
  from (select * from public.search_dam_documents('zq5747trunc', '{"customer":""}'::jsonb, 5, 0, null, null, 0, null)) r;
  if fast_page is distinct from probe_page then
    raise exception '#5747 trunc page differs between shortcut and probe';
  end if;

  select min(total_count), min(facets::text)::jsonb into small_total, small_facets
  from public.search_dam_documents('zq5747small', '{}'::jsonb, 5, 0, null, null, 0, null);
  if small_total <> 3 then
    raise exception '#5747 small total % (want 3)', small_total;
  end if;
  if small_facets->'fileType'->>'pdf' is distinct from '3'
     or small_facets->>'totalExact' is distinct from 'true' then
    raise exception '#5747 small facets must be filled below the cap (%)', small_facets;
  end if;
end;
$test$;
rollback;
