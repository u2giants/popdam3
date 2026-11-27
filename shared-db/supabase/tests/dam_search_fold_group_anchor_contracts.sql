-- u2giants/popdam3#1430 Step 6 part 2 (20261225150501): style-group-only searches with
-- p_compute_anchor take the picture-floor anchor from their own exact vector scan, scoped like
-- dam_search_semantic_anchor_named. Real visible rows (one member file per group) so a wrong
-- anchor (global instead of scoped, ignored admin floor, no floor) changes the returned rows.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare
  l1 uuid; l2 uuid; ch uuid; g_near uuid; g_mid uuid; g_far uuid; g_key uuid; a uuid;
  q extensions.vector := (array[1]::real[] || array_fill(0::real, array[767]))::extensions.vector;
  near extensions.vector := (array[0.95::real, 0.31224989::real] || array_fill(0::real, array[766]))::extensions.vector;
  mid extensions.vector := (array[0.6::real, 0.8::real] || array_fill(0::real, array[766]))::extensions.vector;
  far extensions.vector := (array[0.5::real, 0.8660254::real] || array_fill(0::real, array[766]))::extensions.vector;
  ids uuid[]; sem real; f jsonb; admin real; anchor real; floor real; old_rows jsonb; new_rows jsonb;
  types text[] := array['style_group'];
begin
  insert into plm.licensing_write_authorization (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values (pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create', '14300000-0000-4000-8000-000000000011', repeat('e', 64),
          'popdam3-1430 synthetic contract', array['name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.licensor (name, code, status) values ('ZQ1430F Licensor One', 'ZQ1430F-1', 'active') returning id into l1;
  insert into plm.licensing_write_authorization (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
  values (pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create', '14300000-0000-4000-8000-000000000012', repeat('f', 64),
          'popdam3-1430 synthetic contract', array['name','code','status'], clock_timestamp() + interval '1 minute');
  insert into core.licensor (name, code, status) values ('ZQ1430F Licensor Two', 'ZQ1430F-2', 'active') returning id into l2;
  insert into core.character (licensor_id, name) values (l2, 'ZQ1430F Character') returning id into ch;

  -- g_near: licensor one, picture 0.95.  g_mid: licensor two, picture 0.6, file tagged ch.
  -- g_far: licensor two, picture 0.5.     g_key: licensor two, keyword only (no picture).
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1430FN', '/zq1430f/n', l1) returning id into g_near;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1430FM', '/zq1430f/m', l2) returning id into g_mid;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1430FF', '/zq1430f/f', l2) returning id into g_far;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1430FK', '/zq1430f/k', l2) returning id into g_key;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
  values ('zq1430fn.pdf','zq1430f/n.pdf','pdf','zq1430fn', now(), now(), 'https://example.invalid/n.png', g_near),
         ('zq1430ff.pdf','zq1430f/f.pdf','pdf','zq1430ff', now(), now(), 'https://example.invalid/f.png', g_far),
         ('zq1430fk.pdf','zq1430f/k.pdf','pdf','zq1430fk', now(), now(), 'https://example.invalid/k.png', g_key);
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
  values ('zq1430fm.pdf','zq1430f/m.pdf','pdf','zq1430fm', now(), now(), 'https://example.invalid/m.png', g_mid) returning id into a;
  insert into public.asset_licensor_characters (asset_id, character_id) values (a, ch);
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
  values ('style_group', g_near, null, g_near, 'cerulean near', '/lampstone/n', near, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g_mid, null, g_mid, 'cerulean mid', '/lampstone/m', mid, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g_far, null, g_far, 'cerulean far', '/lampstone/f', far, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g_key, null, g_key, 'zq1430ftoken', '/lampstone/k', null, null)
  on conflict (document_type, entity_id) do update
    set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path,
        embedding=excluded.embedding, embedding_model=excluded.embedding_model;

  -- Licensor two named: anchor is its best picture (0.6), floor 0.565: g_mid stays, g_far goes.
  -- A global anchor (0.95) would drop g_mid too.
  f := jsonb_build_object('semanticLicensorIds', jsonb_build_array(l2));
  select array_agg(entity_id) into ids from public.search_dam_documents('zq1430ftoken', f, 50, 0, types, q, 0, null, null, null, null, false, true);
  if ids is null or not (ids @> array[g_mid, g_key]) or ids && array[g_far, g_near] then
    raise exception 'popdam3#1430 licensor-scoped anchor rows %', ids;
  end if;
  select semantic_rank into sem from public.search_dam_documents('zq1430ftoken', f, 50, 0, types, q, 0, null, null, null, null, false, true) where entity_id = g_mid;
  if abs(sem - 0.6) > 1e-4 then raise exception 'popdam3#1430 g_mid semantic rank % (want 0.6)', sem; end if;
  if current_setting('app.dam_search_anchor') <> '' then raise exception 'popdam3#1430 style-group search called the anchor function'; end if;

  -- The admin floor still wins when it is higher (0.7 > 0.565): g_mid goes.
  select array_agg(entity_id) into ids from public.search_dam_documents('zq1430ftoken', f, 50, 0, types, q, 0, 0.7, null, null, null, false, true);
  if ids is null or ids && array[g_mid, g_far, g_near] or not (ids @> array[g_key]) then
    raise exception 'popdam3#1430 admin floor ignored: rows %', ids;
  end if;

  -- Named character: only g_mid carries it; the anchor is taken inside that scope (0.6), so it stays.
  f := jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch));
  select array_agg(entity_id) into ids from public.search_dam_documents('zq1430ftoken', f, 50, 0, types, q, 0, null, null, null, null, false, true);
  if ids is distinct from array[g_mid] then raise exception 'popdam3#1430 character-scoped anchor rows %', ids; end if;

  -- No scope: global anchor 0.95, floor 0.915: only g_near by picture, plus the keyword match.
  select array_agg(entity_id) into ids from public.search_dam_documents('zq1430ftoken', '{}'::jsonb, 50, 0, types, q, 0, null, null, null, null, false, true);
  if ids is null or not (ids @> array[g_near, g_key]) or ids && array[g_mid, g_far] then
    raise exception 'popdam3#1430 global anchor rows %', ids;
  end if;

  -- Row-for-row parity with the former two-call path on these real rows.
  foreach f in array array['{}'::jsonb, jsonb_build_object('semanticLicensorIds', jsonb_build_array(l2)),
                           jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch)),
                           jsonb_build_object('semanticLicensorIds', jsonb_build_array(l1, l2))] loop
    foreach admin in array array[null::real, 0.55::real, 0.7::real] loop
      anchor := public.dam_search_semantic_anchor_named(q, types, f);
      floor := case when anchor > 0 and admin is not null then greatest(admin::float8, greatest(0, anchor::text::float8 - 0.035))
                    when anchor > 0 then greatest(0, anchor::text::float8 - 0.035) else admin end;
      select coalesce(jsonb_agg(to_jsonb(r) order by r.rank desc, r.entity_id), '[]') into old_rows
      from public.search_dam_documents('zq1430ftoken', f, 50, 0, types, q, 0, floor, null, null, null, true, false) r;
      select coalesce(jsonb_agg(to_jsonb(r) order by r.rank desc, r.entity_id), '[]') into new_rows
      from public.search_dam_documents('zq1430ftoken', f, 50, 0, types, q, 0, admin, null, null, null, true, true) r;
      if old_rows is distinct from new_rows then raise exception 'popdam3#1430 parity differs for % admin %', f, admin; end if;
      if admin is null and (select count(*) from jsonb_array_elements(new_rows) x where x->>'entity_id' is not null) = 0 then
        raise exception 'popdam3#1430 parity fixture returned no rows for %', f;
      end if;
    end loop;
  end loop;
end;
$test$;
rollback;
