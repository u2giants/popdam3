-- u2giants/popdam3#1430 Step 6: search_dam_documents(..., p_compute_anchor => true) returns exactly
-- what the former two-call path returned (dam_search_semantic_anchor_named, then the effective
-- floor max(admin, anchor - 0.035), then search_dam_documents), and the scoped anchor is taken
-- over the whole scope, not the global top-2,000 picture candidates.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare
  l1 uuid; l2 uuid; gl2 uuid; g uuid;
  q extensions.vector := (array[1]::real[] || array_fill(0::real, array[767]))::extensions.vector;
  near extensions.vector := (array[0.95::real, 0.31224989::real] || array_fill(0::real, array[766]))::extensions.vector;
  mid extensions.vector := (array[0.6::real, 0.8::real] || array_fill(0::real, array[766]))::extensions.vector;
  far extensions.vector := (array[0.5::real, 0.8660254::real] || array_fill(0::real, array[766]))::extensions.vector;
  f jsonb; t text; admin real; anchor real; floor real; old_rows jsonb; new_rows jsonb; i int;
begin
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '14300000-0000-4000-8000-000000000001', repeat('c', 64),
    'popdam3-1430 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('ZQ1430 Licensor One', 'ZQ1430-1', 'active') returning id into l1;
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '14300000-0000-4000-8000-000000000002', repeat('d', 64),
    'popdam3-1430 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('ZQ1430 Licensor Two', 'ZQ1430-2', 'active') returning id into l2;

  -- Close picture-only groups of licensor one; licensor two's only pictures are weaker. The anchor
  -- is the full-scope dam_search_semantic_anchor_named (no candidate LIMIT), so licensor two's best
  -- is found however many closer pictures exist elsewhere. Few rows: rolled-back HNSW entries stay
  -- as dead tuples until vacuum and would starve later tests' bounded HNSW scans.
  for i in 1..5 loop
    insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1430N' || i, '/zq1430/n' || i, l1) returning id into g;
    insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
    values ('style_group', g, null, g, 'lampstone ' || i, '/lampstone/n' || i, near, 'google/siglip2-base-patch16-naflex')
    on conflict (document_type, entity_id) do update set embedding = excluded.embedding, embedding_model = excluded.embedding_model, title = excluded.title;
  end loop;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1430L2', '/zq1430/l2', l2) returning id into gl2;
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
  values ('style_group', gl2, null, gl2, 'zq1430token two', '/lampstone/l2', mid, 'google/siglip2-base-patch16-naflex')
  on conflict (document_type, entity_id) do update set embedding = excluded.embedding, embedding_model = excluded.embedding_model, title = excluded.title;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1430F', '/zq1430/f', l2) returning id into g;
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
  values ('style_group', g, null, g, 'cerulean far', '/lampstone/f', far, 'google/siglip2-base-patch16-naflex')
  on conflict (document_type, entity_id) do update set embedding = excluded.embedding, embedding_model = excluded.embedding_model, title = excluded.title;

  -- The scoped anchor is licensor two's best picture (0.6), not the global best (0.95).
  perform public.search_dam_documents('zq1430token', jsonb_build_object('semanticLicensorIds', jsonb_build_array(l2)),
    50, 0, null, q, 0, null, null, null, null, true, true);
  if abs(current_setting('app.dam_search_anchor')::float8 - 0.6) > 1e-4 then
    raise exception 'popdam3#1430 scoped anchor % (want 0.6, the in-scope best, not the global 0.95)',
      current_setting('app.dam_search_anchor');
  end if;

  -- Parity with the former two-call path for every scope, document type and admin floor.
  foreach f in array array['{}'::jsonb, jsonb_build_object('semanticLicensorIds', jsonb_build_array(l2)),
                           jsonb_build_object('semanticLicensorIds', jsonb_build_array(l1, l2))] loop
    foreach t in array array[null::text, 'style_group'::text] loop
      foreach admin in array array[null::real, 0.1::real, 0.7::real] loop
        anchor := public.dam_search_semantic_anchor_named(q, case when t is null then null else array[t] end, f);
        floor := case when anchor > 0 and admin is not null then greatest(admin::float8, greatest(0, anchor::text::float8 - 0.035))
                      when anchor > 0 then greatest(0, anchor::text::float8 - 0.035)
                      else admin end;
        select coalesce(jsonb_agg(to_jsonb(r) order by r.rank desc, r.entity_id), '[]') into old_rows
        from public.search_dam_documents('zq1430token', f, 100, 0, case when t is null then null else array[t] end,
          q, 0, floor, null, null, null, true, false) r;
        select coalesce(jsonb_agg(to_jsonb(r) order by r.rank desc, r.entity_id), '[]') into new_rows
        from public.search_dam_documents('zq1430token', f, 100, 0, case when t is null then null else array[t] end,
          q, 0, admin, null, null, null, true, true) r;
        if old_rows is distinct from new_rows then
          raise exception 'popdam3#1430 parity differs for filters % type % admin %', f, t, admin;
        end if;
      end loop;
    end loop;
  end loop;

  -- Style-group-only searches fold the anchor into their own vector scan: no anchor function runs.
  perform public.search_dam_documents('zq1430token', jsonb_build_object('semanticLicensorIds', jsonb_build_array(l2)),
    50, 0, array['style_group'], q, 0, null, null, null, null, true, true);
  if current_setting('app.dam_search_anchor') <> '' then
    raise exception 'popdam3#1430 style-group search still called the anchor function';
  end if;

  -- Default (false) and keyword-only calls keep the old behavior: no anchor is computed.
  perform public.search_dam_documents('zq1430token', '{}'::jsonb, 10, 0, null, q, 0, 0.2);
  if current_setting('app.dam_search_anchor') <> '' then raise exception 'popdam3#1430 default call computed an anchor'; end if;
  perform public.search_dam_documents('zq1430token', '{}'::jsonb, 10, 0, null, null, 0, null, null, null, null, true, true);
  if current_setting('app.dam_search_anchor') <> '' then raise exception 'popdam3#1430 keyword-only call computed an anchor'; end if;
end;
$test$;
rollback;
