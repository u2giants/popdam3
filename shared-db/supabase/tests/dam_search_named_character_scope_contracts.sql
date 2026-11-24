-- u2giants/popdam3#1037 Step 2 (popcre/shared-db#6607): named-character rule on
-- public.search_dam_documents and public.dam_search_semantic_anchor_named.
-- requiredCharacterIds / requiredLegacyCharacterIds / requiredCharacterNames apply to EVERY leg;
-- semanticPropertyIds + semanticPropertyCharacterIds apply to picture-only matches. Absent keys =
-- unchanged behaviour.
begin;
set local search_path=pg_catalog,public,extensions;

-- The historical alias-table migration also seeds a production licensor that the
-- disposable replay does not have. Supply its lookup columns when that replay
-- rolls the migration back. This fixture and its grant roll back with the test.
do $alias_fixture$
begin
  if to_regclass('core.licensor_alias') is null then
    create table core.licensor_alias (
      licensor_id uuid not null references core.licensor(id),
      alias text not null,
      source_system text
    );
    grant select on core.licensor_alias to service_role;
  end if;
end;
$alias_fixture$;

do $test$
declare
  lic uuid; prop uuid; ch1 uuid; ch2 uuid; leg_lic uuid := gen_random_uuid(); leg_prop uuid := gen_random_uuid();
  lc1 uuid := gen_random_uuid();
  g1 uuid; g2 uuid; g3 uuid; g4 uuid; g5 uuid; g6 uuid; g7 uuid;
  a1 uuid; a3a uuid; a3b uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid; a8 uuid;
  e0 extensions.vector := (array[1]::real[] || array_fill(0::real, array[767]))::extensions.vector;
  eh extensions.vector := (array[0.70710677,0.70710677]::real[] || array_fill(0::real, array[766]))::extensions.vector;
  f jsonb; ids uuid[]; n bigint; probe bigint; s real; s0 real; raised boolean;
  scope_sets record;
  grouped_scope_sets record;
  full_scope_sets record;
  lookup jsonb; invalid_keys text[];
  unicode_character uuid;
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

  -- The cold-path lookup passes only relevant names and links to the existing matcher.
  insert into core.character (licensor_id, name)
  values (lic, U&'ZQ1037 A\0130B \212A') returning id into unicode_character;
  insert into core.character_alias (character_id, licensor_id, alias, source_system)
  values (ch1, lic, U&'ZQ1037 \00C1lias \212A', 'manual');
  insert into core.licensor_alias (licensor_id, alias, source_system)
  values (lic, 'ZQ1037 Studio!', 'manual');
  insert into core.property_character_source_edge(property_id,character_id,licensor_id,source_system,source_id,evidence_kind)
  values (prop,ch1,lic,'synthetic-A','dam-named-search-lookup','direct_source_assertion');
  insert into core.property_character_associations(property_id,character_id) values (prop,ch1);

  lookup := public.get_dam_search_named_rows(array[
    'zq1037 ai b k', 'zq1037 lias k', 'zq1037 legacy character', 'zq1037 property', 'zq1037 studio', 'zq1037 licensor'
  ]);
  if not (lookup @> jsonb_build_object(
    'characters', jsonb_build_array(jsonb_build_object('id', unicode_character)),
    'aliases', jsonb_build_array(jsonb_build_object('characterId', ch1)),
    'legacyCharacters', jsonb_build_array(jsonb_build_object('id', lc1)),
    'properties', jsonb_build_array(jsonb_build_object('id', prop)),
    'propertyCharacters', jsonb_build_array(jsonb_build_object('propertyId', prop, 'characterId', ch1)),
    'licensorNames', jsonb_build_array('ZQ1037 Studio!', 'ZQ1037 Licensor')
  )) or jsonb_array_length(lookup->'characters') is distinct from 1 then
    raise exception 'PopDAM lookup changed normalization or returned unrelated canonical or alias rows';
  end if;
  if public.get_dam_search_named_rows(array['unmatchablezq1037']) is distinct from
    '{"characters":[],"aliases":[],"legacyCharacters":[],"properties":[],"propertyCharacters":[],"licensorNames":[]}'::jsonb then
    raise exception 'PopDAM name lookup must return a complete empty object for a term with no match';
  end if;
  for invalid_keys in select keys from (values (null::text[]), (array_fill('zq'::text, array[4001])),
      (array['a b c d e f g h i']), (array[repeat('z', 501)]), (array['UPPER']), (array[null]::text[]), (array[['a'],['b']])) v(keys)
  loop
    begin
      perform public.get_dam_search_named_rows(invalid_keys);
      raise exception 'PopDAM name lookup did not reject invalid or over-budget input';
    exception when invalid_parameter_value then
      null;
    end;
  end loop;
  if has_function_privilege('anon', 'public.get_dam_search_named_rows(text[])', 'execute')
     or has_function_privilege('authenticated', 'public.get_dam_search_named_rows(text[])', 'execute')
     or not has_function_privilege('service_role', 'public.get_dam_search_named_rows(text[])', 'execute')
     or exists (select 1 from pg_proc where oid = 'public.get_dam_search_named_rows(text[])'::regprocedure and prosecdef) then
    raise exception 'PopDAM name lookup is restricted to the existing service role without definer privileges';
  end if;

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
    values ('zq1037e.pdf','zq1037/e.pdf','pdf','zq1037e', now(), now(), 'https://example.invalid/e.png', g5) returning id into a5;
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
  -- C2 (#6995): asset_characters.character_id references core.character; the row is
  -- added after the name lookup above so it does not count as a canonical match there.
  insert into core.character(id,name) values(lc1,'ZQ1037 Legacy Character');
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

  foreach f in array array['{}'::jsonb, '{"requiredCharacterIds":[]}'::jsonb] loop
    select * into strict scope_sets from public.dam_search_named_scope(f);
    if not (scope_sets is null) then
      raise exception 'popdam3#1037 omitted or empty scope % should yield four NULLs: %', f, scope_sets;
    end if;
  end loop;

  select * into strict scope_sets
  from public.dam_search_named_scope(jsonb_build_object('semanticPropertyIds', jsonb_build_array(prop)));
  if scope_sets.character_groups is not null or scope_sets.character_assets is not null
     or scope_sets.property_groups is distinct from array[g4]
     or scope_sets.property_assets is distinct from '{}'::uuid[] then
    raise exception 'popdam3#1037 property scope sets: %', scope_sets;
  end if;

  -- Both ungrouped sets contain a genuine match. Only a group-only caller
  -- may discard them, and the original interface must still return them.
  f := jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch1),
                          'semanticPropertyCharacterIds', jsonb_build_array(ch1));
  select * into strict scope_sets from public.dam_search_named_scope(f);
  select * into strict grouped_scope_sets from public.dam_search_named_scope(f, false);
  select * into strict full_scope_sets from public.dam_search_named_scope(f, true);
  if not coalesce(a8 = any(scope_sets.character_assets), false)
     or not coalesce(a8 = any(scope_sets.property_assets), false)
     or grouped_scope_sets.character_groups is distinct from scope_sets.character_groups
     or grouped_scope_sets.property_groups is distinct from scope_sets.property_groups
     or grouped_scope_sets.character_assets is not null
     or grouped_scope_sets.property_assets is not null
     or to_jsonb(full_scope_sets) is distinct from to_jsonb(scope_sets) then
    raise exception 'popdam3#1037 group-only scope changed existing group or file coverage';
  end if;

  s0 := public.dam_search_semantic_anchor(e0, array['style_group']);
  s := public.dam_search_semantic_anchor_named(e0, array['style_group'],
         jsonb_build_object('requiredCharacterIds', jsonb_build_array(gen_random_uuid())));
  if s is distinct from s0 then
    raise exception 'popdam3#1037 unmatched grouped scope did not fall back to the unscoped anchor';
  end if;

  foreach f in array array[
    jsonb_build_object('requiredCharacterIds', to_jsonb(array_fill(ch1, array[1001]))),
    jsonb_build_object('requiredCharacterNames', to_jsonb(array_fill('ZQMarietta'::text, array[51])))
  ] loop
    raised := false;
    begin
      perform public.dam_search_named_scope(f);
    exception when invalid_parameter_value then raised := true;
    end;
    if not raised then
      raise exception 'popdam3#1037 named scope accepted an oversized list';
    end if;
  end loop;

  -- The grouped asset inherits the name from g5. The ungrouped asset names
  -- it in its own text and has a closer picture, but neither qualifies it.
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
  values ('asset', a5, a5, g5, 'zq1037assetprobe grouped', '/lampstone/e.pdf', eh, 'google/siglip2-base-patch16-naflex')
  on conflict (document_type, entity_id) do update
    set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path,
        embedding=excluded.embedding, embedding_model=excluded.embedding_model;
  update public.dam_search_documents
  set title = 'zq1037assetprobe zqmarietta eight', embedding = e0
  where document_type = 'asset' and entity_id = a8;

  f := '{"requiredCharacterNames":["ZQMarietta"]}'::jsonb;
  select * into strict scope_sets from public.dam_search_named_scope(f);
  if scope_sets.character_groups is distinct from array[g5]
     or scope_sets.character_assets is distinct from '{}'::uuid[]
     or scope_sets.property_groups is not null or scope_sets.property_assets is not null then
    raise exception 'popdam3#1037 character name scope sets: %', scope_sets;
  end if;

  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037assetprobe', '{}', 50, 0, array['asset'], null, 0, null);
  if n is distinct from 2 or (ids @> array[a5,a8]) is distinct from true then
    raise exception 'popdam3#1037 unscoped asset keyword search: total % ids %', n, ids;
  end if;
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037assetprobe', f, 50, 0, array['asset'], null, 0, null);
  if n is distinct from 1 or ids is distinct from array[a5] then
    raise exception 'popdam3#1037 named asset keyword search: total % ids %', n, ids;
  end if;
  s0 := public.dam_search_semantic_anchor(e0, array['asset']);
  s := public.dam_search_semantic_anchor_named(e0, array['asset'], f);
  if s0 is null or s0 < 0.99 or s is null or s > 0.75 or s < 0.65 then
    raise exception 'popdam3#1037 asset anchor: unscoped %, named %', s0, s;
  end if;

  if has_function_privilege('anon', 'public.dam_search_semantic_anchor_named(extensions.vector,text[],jsonb)', 'execute')
     or has_function_privilege('anon', 'public.dam_search_uuid_list(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.dam_search_name_queries(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.dam_search_named_scope(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.dam_search_named_scope(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.dam_search_named_scope(jsonb,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.dam_search_named_scope(jsonb,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.dam_search_named_scope(jsonb,boolean)', 'execute') then
    raise exception 'popdam3#1037 grants too wide';
  end if;
end;
$test$;

set local role service_role;
do $lookup_as_service$
begin
  if jsonb_array_length(public.get_dam_search_named_rows(array['zq1037 property'])->'propertyCharacters') is distinct from 1 then
    raise exception 'Service role cannot read the matched property associations';
  end if;
end;
$lookup_as_service$;
reset role;
rollback;
