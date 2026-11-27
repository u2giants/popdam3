-- u2giants/popdam3#1037 Step 6: text-meaning leg on public.search_dam_documents.
-- No text vector = the 8-argument behaviour exactly. With one: text matches within the relative
-- floor join, rank = keyword + 0.6 text + 0.15 picture, picture-only matches are kept only when
-- the word and text legs found fewer than 10 visible results, and the licensor and
-- named-character rules apply to text-only matches.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare
  lic uuid; other_lic uuid; ch1 uuid;
  g uuid[] := array[]::uuid[]; gid uuid; aid uuid; i int;
  model text := dam.search_text_embedding_model();
  e0 extensions.vector := (array[1]::real[] || array_fill(0::real, array[767]))::extensions.vector;
  q extensions.halfvec := (array[1]::real[] || array_fill(0::real, array[1023]))::extensions.halfvec;
  ids uuid[]; ids2 uuid[]; n bigint; r real; raised boolean;
  f jsonb;
begin
  if model is null then raise exception 'popdam3#1037 Step 6: SEARCH_TEXT_EMBEDDING_MODEL unset in test database'; end if;
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '10370000-0000-4000-8000-000000000006', repeat('c', 64),
    'popdam3-1037 step 6 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('ZQ1037S6 Licensor', 'ZQ1037S6-L', 'active') returning id into lic;
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '10370000-0000-4000-8000-000000000007', repeat('d', 64),
    'popdam3-1037 step 6 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('ZQ1037S6 Other', 'ZQ1037S6-O', 'active') returning id into other_lic;
  insert into core.character (licensor_id, name) values (lic, 'ZQ1037S6 Marietta') returning id into ch1;

  -- 20 style groups, one visible file each.
  --   g[1]  keyword match, no text vector, tagged ch1
  --   g[2]  text only, cosine 1.0, tagged ch1        g[3]  text only, cosine 0.95 (inside 0.10)
  --   g[4]  text only, cosine 0.80 (outside floor)   g[5]  picture only
  --   g[6]  text only, cosine 1.0 but OTHER model stamp
  --   g[7]  text only, cosine 0.97, other licensor
  --   g[8..20] spare text matches (cosine 0.93) used to exceed the 10-result demotion threshold
  for i in 1..20 loop
    insert into public.style_groups (sku, folder_path, licensor_id)
      values ('ZQ1037S6' || i, '/zq1037s6/' || i, case when i = 7 then other_lic else lic end) returning id into gid;
    insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
      values ('zq1037s6-' || i || '.pdf', 'zq1037s6/' || i || '.pdf', 'pdf', 'zq1037s6-' || i, now(), now(),
              'https://example.invalid/s6-' || i || '.png', gid) returning id into aid;
    if i in (1, 2) then
      insert into public.asset_licensor_characters (asset_id, character_id) values (aid, ch1);
    end if;
    insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
    values ('style_group', gid, null, gid,
            case when i = 1 then 'zq1037sxword one' else 'cobaltine ' || i end, '/quartzine/' || i,
            case when i = 5 then e0 else null end,
            case when i = 5 then 'google/siglip2-base-patch16-naflex' end)
    on conflict (document_type, entity_id) do update
      set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path,
          embedding=excluded.embedding, embedding_model=excluded.embedding_model;
    g := g || gid;
  end loop;

  -- text vectors (cosine to q = first component)
  insert into dam.search_text_vectors (document_type, entity_id, model, input_sha256, embedding)
  select 'style_group', g[x.i], case when x.i = 6 then 'other/model@0' else model end, repeat('e', 64),
    (array[x.s, sqrt(1 - x.s*x.s)]::real[] || array_fill(0::real, array[1022]))::extensions.halfvec
  from (values (2, 1.0::real), (3, 0.95::real), (4, 0.80::real), (6, 1.0::real), (7, 0.97::real)) x(i, s)
  on conflict (document_type, entity_id) do update set model = excluded.model, embedding = excluded.embedding;

  -- 1. No text vector: identical to the 8-argument call (rows and ranks).
  select array_agg(entity_id order by entity_id) into ids
  from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, null, e0, 0, 0.5);
  select array_agg(entity_id order by entity_id) into ids2
  from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, null, e0, 0, 0.5, null, null, null);
  if ids is distinct from ids2 or not (ids @> array[g[1], g[5]]) then
    raise exception 'popdam3#1037 S6 text-off baseline: % vs %', ids, ids2;
  end if;
  if exists (select 1 from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, null, e0, 0, 0.5) d
             where d.text_rank is not null) then
    raise exception 'popdam3#1037 S6 text_rank set without a text vector';
  end if;

  -- 2. Text on, few justified results: keyword + text matches inside the floor; the other model's
  --    vector and the far text match are ignored; the picture-only match stays (fewer than 10).
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, array['style_group'], e0, 0, 0.5, q, null, null);
  if not (ids @> array[g[1], g[2], g[3], g[5], g[7]]) or ids && array[g[4], g[6]] then
    raise exception 'popdam3#1037 S6 text on: total % groups %', n, (select array_agg(k order by k) from generate_series(1,20) k where g[k] = any(ids));
  end if;
  -- Ranking: text-only cosine 1.0 = 0.6.
  select d.rank into r from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, array['style_group'], e0, 0, 0.5, q, null, null) d
   where d.entity_id = g[2];
  if r is null or abs(r - 0.6) > 0.01 then raise exception 'popdam3#1037 S6 text-only rank %', r; end if;
  select d.rank into r from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, array['style_group'], e0, 0, 0.5, q, null, null) d
   where d.entity_id = g[5];
  if r is null or abs(r - 0.15) > 0.01 then raise exception 'popdam3#1037 S6 picture-only rank %', r; end if;
  -- Wider margin admits the 0.80 match; absolute floor above 0.96 drops 0.95.
  select array_agg(entity_id) into ids
  from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, array['style_group'], e0, 0, 0.5, q, null, 0.25);
  if not (g[4] = any(ids)) then raise exception 'popdam3#1037 S6 margin 0.25 ids %', ids; end if;
  select array_agg(entity_id) into ids
  from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, array['style_group'], e0, 0, 0.5, q, 0.96, null);
  if g[3] = any(ids) or not (g[2] = any(ids)) then raise exception 'popdam3#1037 S6 absolute floor ids %', ids; end if;
  -- Mixed-type (HNSW) leg finds the same text matches.
  select array_agg(entity_id) into ids
  from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, null, e0, 0, 0.5, q, null, null);
  if not (ids @> array[g[1], g[2], g[3]]) or g[6] = any(ids) then raise exception 'popdam3#1037 S6 all-types ids %', ids; end if;

  -- 3. Licensor scope applies to text-only matches (g[7] other licensor); keyword matches stay.
  f := jsonb_build_object('semanticLicensorIds', jsonb_build_array(lic));
  select array_agg(entity_id) into ids
  from public.search_dam_documents('zq1037sxword', f, 50, 0, array['style_group'], e0, 0, 0.5, q, null, null);
  if g[7] = any(ids) or not (ids @> array[g[1], g[2]]) then raise exception 'popdam3#1037 S6 licensor scope ids %', ids; end if;

  -- 4. Named character applies to text-only matches: only g[1] and g[2] carry ch1.
  f := jsonb_build_object('requiredCharacterIds', jsonb_build_array(ch1));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037sxword', f, 50, 0, array['style_group'], e0, 0, 0.5, q, null, null);
  if n <> 2 or not (ids @> array[g[1], g[2]]) then raise exception 'popdam3#1037 S6 character: total % ids %', n, ids; end if;

  -- 5. Ten or more justified results: the picture-only match is dropped.
  insert into dam.search_text_vectors (document_type, entity_id, model, input_sha256, embedding)
  select 'style_group', g[k], model, repeat('e', 64),
    (array[0.93::real, sqrt(1 - 0.93*0.93)::real] || array_fill(0::real, array[1022]))::extensions.halfvec
  from generate_series(8, 20) k
  on conflict (document_type, entity_id) do update set model = excluded.model, embedding = excluded.embedding;
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, array['style_group'], e0, 0, 0.5, q, null, null);
  if g[5] = any(ids) or not (ids @> array[g[1], g[2], g[3], g[8]]) then
    raise exception 'popdam3#1037 S6 demotion: total % ids %', n, ids;
  end if;
  -- ...but text off still returns it.
  select array_agg(entity_id) into ids
  from public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, array['style_group'], e0, 0, 0.5);
  if not (g[5] = any(ids)) then raise exception 'popdam3#1037 S6 text off lost picture match %', ids; end if;

  -- 6. A text vector of the wrong size fails cleanly.
  raised := false;
  begin
    perform public.search_dam_documents('zq1037sxword', '{}'::jsonb, 50, 0, array['style_group'], null, 0, null,
      (array_fill(0.5::real, array[768]))::extensions.halfvec, null, null);
  exception when others then raised := true;
  end;
  if not raised then raise exception 'popdam3#1037 S6 wrong-size text vector accepted'; end if;

  -- 7. Grants and mode key.
  if has_function_privilege('anon', 'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real,boolean,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real,boolean,boolean)', 'execute') then
    raise exception 'popdam3#1037 S6 grants';
  end if;
  if not exists (select 1 from public.admin_config where key = 'SEARCH_TEXT_LEG_MODE') then
    raise exception 'popdam3#1037 S6 SEARCH_TEXT_LEG_MODE missing';
  end if;
end;
$test$;
rollback;
