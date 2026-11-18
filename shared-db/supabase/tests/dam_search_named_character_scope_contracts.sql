-- u2giants/popdam3#1037 Step 2 (popcre/shared-db#6607): named-character rule on
-- public.search_dam_documents and public.dam_search_semantic_anchor_named.
-- requiredCharacterIds / requiredLegacyCharacterIds / requiredCharacterNames apply to EVERY leg;
-- semanticPropertyIds + semanticPropertyCharacterIds apply to picture-only matches. Absent keys =
-- unchanged behaviour.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare
  lic uuid; prop uuid; ch1 uuid; ch2 uuid; leg_lic uuid := gen_random_uuid(); leg_prop uuid := gen_random_uuid();
  lc1 uuid := gen_random_uuid();
  g1 uuid; g2 uuid; g3 uuid; g4 uuid; g5 uuid; g6 uuid; g7 uuid;
  a1 uuid; a3a uuid; a3b uuid; a4 uuid; a6 uuid; a7 uuid; a8 uuid;
  e0 extensions.vector := (array[1]::real[] || array_fill(0::real, array[767]))::extensions.vector;
  eh extensions.vector := (array[0.70710677,0.70710677]::real[] || array_fill(0::real, array[766]))::extensions.vector;
  f jsonb; ids uuid[]; n bigint; probe bigint; s real; s0 real; raised boolean;
begin
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '10370000-0000-4000-8000-000000000001', repeat('a', 64),
    'popdam3-1037 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('ZQ1037 Licensor', 'ZQ1037-L', 'active') returning id into lic;
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create',
    '10370000-0000-4000-8000-000000000002', repeat('b', 64),
    'popdam3-1037 synthetic contract', array['licensor_id','name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.property (licensor_id, name, code, status) values (lic, 'ZQ1037 Property', 'ZQ1037-P', 'potential') returning id into prop;
  insert into core.character (licensor_id, name) values (lic, 'ZQ1037 Marietta') returning id into ch1;
  insert into core.character (licensor_id, name) values (lic, 'ZQ1037 Other') returning id into ch2;
  insert into public.licensors(id,name,external_id) values(leg_lic,'ZQ1037 Legacy Licensor','zq1037-l-'||txid_current());
  insert into public.properties(id,licensor_id,name,external_id) values(leg_prop,leg_lic,'ZQ1037 Legacy Property','zq1037-p-'||txid_current());
  insert into public.characters(id,property_id,name,external_id) values(lc1,leg_prop,'ZQ1037 Legacy Character','zq1037-c-'||txid_current());

  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1037A', '/zq1037/a', lic) returning id into g1;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1037B', '/zq1037/b', lic) returning id into g2;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1037C', '/zq1037/c', lic) returning id into g3;
  insert into public.style_groups (sku, folder_path, licensor_id, property_id) values ('ZQ1037D', '/zq1037/d', lic, prop) returning id into g4;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1037E', '/zq1037/e', lic) returning id into g5;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1037F', '/zq1037/f', lic) returning id into g6;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ1037G', '/zq1037/g', lic) returning id into g7;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq1037a.pdf','zq1037/a.pdf','pdf','zq1037a', now(), now(), 'https://example.invalid/a.png', g1) returning id into a1;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq1037b.pdf','zq1037/b.pdf','pdf','zq1037b', now(), now(), 'https://example.invalid/b.png', g2);
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq1037c1.pdf','zq1037/c1.pdf','pdf','zq1037c1', now(), now(), 'https://example.invalid/c1.png', g3) returning id into a3a;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq1037c2.pdf','zq1037/c2.pdf','pdf','zq1037c2', now(), now(), 'https://example.invalid/c2.png', g3) returning id into a3b;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq1037d.pdf','zq1037/d.pdf','pdf','zq1037d', now(), now(), 'https://example.invalid/d.png', g4) returning id into a4;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq1037e.pdf','zq1037/e.pdf','pdf','zq1037e', now(), now(), 'https://example.invalid/e.png', g5);
  -- g6: two files; only the DELETED one carries the tag.
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq1037f1.pdf','zq1037/f1.pdf','pdf','zq1037f1', now(), now(), 'https://example.invalid/f1.png', g6) returning id into a6;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq1037f2.pdf','zq1037/f2.pdf','pdf','zq1037f2', now(), now(), 'https://example.invalid/f2.png', g6);
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
    values ('zq1037g.pdf','zq1037/g.pdf','pdf','zq1037g', now(), now(), 'https://example.invalid/g.png', g7) returning id into a7;
  -- a8: ungrouped asset, picture match only, tagged ch1 on itself.
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, licensor_id)
    values ('zq1037h.ai','zq1037/h.ai','ai','zq1037h', now(), now(), 'https://example.invalid/h.png', lic) returning id into a8;

  insert into public.asset_licensor_characters (asset_id, character_id) values
    (a1, ch1), (a3b, ch1), (a4, ch2), (a6, ch1), (a8, ch1);
  insert into public.asset_characters (asset_id, character_id) values (a7, lc1);
  update public.assets set is_deleted = true where id = a6;

  -- g1: keyword + picture, tagged ch1.          g2: keyword + picture, no character.
  -- g3: picture only, ch1 on its second file.   g4: picture only, ch2, property prop.
  -- g5: picture only, untagged, names the character in its text.
  -- g6: picture only, ch1 only on a deleted file.  g7: picture only, legacy character.
  -- a8: ungrouped picture-only asset tagged ch1.
  -- In-scope (ch1) pictures sit at cosine 0.707 (eh); everything else at 1.0 (e0).
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
  values ('style_group', g1, null, g1, 'zq1037token one', '/lampstone/a', eh, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g2, null, g2, 'zq1037token two', '/lampstone/b', e0, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g3, null, g3, 'cerulean three', '/lampstone/c', eh, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g4, null, g4, 'cerulean four', '/lampstone/d', e0, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g5, null, g5, 'cerulean zqmarietta five', '/lampstone/e', e0, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g6, null, g6, 'cerulean six', '/lampstone/f', e0, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g7, null, g7, 'cerulean seven', '/lampstone/g', e0, 'google/siglip2-base-patch16-naflex'),
         ('asset', a8, a8, null, 'cerulean eight', '/lampstone/h', eh, 'google/siglip2-base-patch16-naflex')
  on conflict (document_type, entity_id) do update
    set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path,
        embedding=excluded.embedding, embedding_model=excluded.embedding_model;

  -- Baseline: no key, empty lists, and lists with no valid uuid change nothing.
  foreach f in array array['{}'::jsonb, '{"requiredCharacterIds":[]}'::jsonb, '{"requiredCharacterIds":null}'::jsonb,
                           '{"requiredCharacterIds":["not-a-uuid", 7, "1; drop table x"]}'::jsonb,
                           '{"requiredCharacterNames":["", "  "]}'::jsonb] loop
    select array_agg(entity_id), min(total_count) into ids, n
    from public.search_dam_documents('zq1037token', f, 50, 0, null, e0, 0, 0.5);
    if n <> 8 or not (ids @> array[g1,g2,g3,g4,g5,g6,g7,a8]) then
      raise exception 'popdam3#1037 baseline with % returned % (want all 8)', f, n;
    end if;
  end loop;

  -- Core character named: drops the keyword match without it (g2), keeps a group whose only
  -- tagged file is its second member (g3) and the ungrouped tagged asset; a tag on a deleted
  -- file does not count (g6).
  f := jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch1));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 3 or not (ids @> array[g1,g3,a8]) or ids && array[g2,g4,g5,g6,g7] then
    raise exception 'popdam3#1037 required core character: total % ids %', n, ids;
  end if;
  -- Exact total fast path equals the per-document probe ('customer' is a no-op filter).
  select min(total_count) into probe
  from public.search_dam_documents('zq1037token', f || '{"customer":""}'::jsonb, 50, 0, null, e0, 0, 0.5);
  if probe <> n then raise exception 'popdam3#1037 fast total % <> probe total %', n, probe; end if;
  -- Keyword-only call (no embedding): the rule still applies to the word leg.
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037token', f, 50, 0, null, null, 0, null);
  if n <> 1 or ids <> array[g1] then raise exception 'popdam3#1037 keyword-only: total % ids %', n, ids; end if;
  -- Style-group-only search (exact picture leg): same rule.
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037token', f, 50, 0, array['style_group'], e0, 0, 0.5);
  if n <> 2 or not (ids @> array[g1,g3]) then raise exception 'popdam3#1037 style-group leg: total % ids %', n, ids; end if;

  -- The typed name in the document's own text also counts (untagged products stay findable).
  f := jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch1), 'requiredCharacterNames', jsonb_build_array('ZQMarietta'));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 4 or not (ids @> array[g1,g3,g5,a8]) then raise exception 'popdam3#1037 name fallback: total % ids %', n, ids; end if;
  -- Name matching is whole words and literal: a fragment or tsquery operators match nothing extra.
  f := jsonb_build_object('requiredCharacterNames', jsonb_build_array('zqmari', 'zqmarietta | cerulean'));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 0 then raise exception 'popdam3#1037 literal names: total % ids %', n, ids; end if;

  -- Legacy character named.
  f := jsonb_build_object('requiredLegacyCharacterIds', jsonb_build_array(lc1));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 1 or ids <> array[g7] then raise exception 'popdam3#1037 legacy character: total % ids %', n, ids; end if;

  -- Property accepted set: picture-only matches must carry the property or a linked character;
  -- keyword matches stay.
  f := jsonb_build_object('semanticPropertyIds', jsonb_build_array(prop), 'semanticPropertyCharacterIds', jsonb_build_array(ch1));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 5 or not (ids @> array[g1,g2,g3,g4,a8]) or ids && array[g5,g6,g7] then
    raise exception 'popdam3#1037 property set: total % ids %', n, ids;
  end if;

  -- Either property list alone still scopes picture-only matches (20261204003530, finding #6609).
  f := jsonb_build_object('semanticPropertyCharacterIds', jsonb_build_array(ch1));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 4 or not (ids @> array[g1,g2,g3,a8]) then
    raise exception 'popdam3#1037 lone property characters: total % ids %', n, ids;
  end if;
  f := jsonb_build_object('semanticPropertyIds', jsonb_build_array(prop));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 3 or not (ids @> array[g1,g2,g4]) then
    raise exception 'popdam3#1037 lone property ids: total % ids %', n, ids;
  end if;
  s := public.dam_search_semantic_anchor_named(e0, null, jsonb_build_object('semanticPropertyCharacterIds', jsonb_build_array(ch1)));
  if s is null or s > 0.75 or s < 0.65 then raise exception 'popdam3#1037 lone property-character anchor %', s; end if;

  -- Oversized lists fail with a clean invalid-parameter error.
  raised := false;
  begin
    perform public.search_dam_documents('zq1037token',
      jsonb_build_object('requiredCharacterIds', (select jsonb_agg(gen_random_uuid()) from generate_series(1,1001))), 50, 0, null, e0, 0, 0.5);
  exception when invalid_parameter_value then raised := true;
  end;
  if not raised then raise exception 'popdam3#1037 1001 ids were accepted'; end if;

  -- Anchor: no scope = the unscoped anchor exactly; character scope = best in-scope picture
  -- (0.707), not the closer out-of-scope pictures (1.0).
  s0 := public.dam_search_semantic_anchor(e0, null);
  s := public.dam_search_semantic_anchor_named(e0, null, '{}'::jsonb);
  if s is distinct from s0 then raise exception 'popdam3#1037 unscoped anchor % <> %', s, s0; end if;
  s := public.dam_search_semantic_anchor_named(e0, null, jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch1)));
  if s is null or s > 0.75 or s < 0.65 then raise exception 'popdam3#1037 character anchor %', s; end if;
  s := public.dam_search_semantic_anchor_named(e0, array['style_group'], jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch1)));
  if s is null or s > 0.75 or s < 0.65 then raise exception 'popdam3#1037 style-group character anchor %', s; end if;

  if has_function_privilege('anon', 'public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb)', 'execute')
     or has_function_privilege('anon', 'public.dam_search_uuid_list(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.dam_search_name_queries(jsonb)', 'execute') then
    raise exception 'popdam3#1037 grants too wide';
  end if;
end;
$test$;
rollback;
