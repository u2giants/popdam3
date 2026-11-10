-- u2giants/popdam3#892: optional p_filters key "semanticLicensorIds" on public.search_dam_documents.
-- A document matched by its picture ALONE is kept only when it belongs to a named licensor.
-- Keyword matches are never dropped and keep their picture score. Absent/empty key = unchanged.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare
  l1 uuid; l2 uuid; g1 uuid; g2 uuid; g3 uuid; g4 uuid; a5 uuid;
  e0 extensions.vector := (array[1]::real[] || array_fill(0::real, array[767]))::extensions.vector;
  f jsonb; ids uuid[]; n bigint; probe bigint; sem real;
begin
  -- core.licensor is protected by the licensing write-authority guard: one real,
  -- transaction-bound authorization per synthetic insert (pattern of
  -- character_alias_and_source_provenance_contracts.sql); it disappears with the rollback.
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '08920000-0000-4000-8000-000000000001', repeat('a', 64),
    'popdam3-892 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('ZQ892 Licensor One', 'ZQ892-1', 'active') returning id into l1;
  -- core.licensor is protected by the licensing write-authority guard: one real,
  -- transaction-bound authorization per synthetic insert (pattern of
  -- character_alias_and_source_provenance_contracts.sql); it disappears with the rollback.
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '08920000-0000-4000-8000-000000000002', repeat('b', 64),
    'popdam3-892 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('ZQ892 Licensor Two', 'ZQ892-2', 'active') returning id into l2;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ892A', '/zq892/a', l1) returning id into g1;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ892B', '/zq892/b', l2) returning id into g2;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ892C', '/zq892/c', l2) returning id into g3;
  insert into public.style_groups (sku, folder_path) values ('ZQ892D', '/zq892/d') returning id into g4;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
  values ('zq892a.pdf','zq892/zq892a.pdf','pdf','zq892a', now(), now(), 'https://example.invalid/a.png', g1),
         ('zq892b.pdf','zq892/zq892b.pdf','pdf','zq892b', now(), now(), 'https://example.invalid/b.png', g2),
         ('zq892c.pdf','zq892/zq892c.pdf','pdf','zq892c', now(), now(), 'https://example.invalid/c.png', g3),
         ('zq892d.pdf','zq892/zq892d.pdf','pdf','zq892d', now(), now(), 'https://example.invalid/d.png', g4);
  -- a5: ungrouped asset of licensor one, picture match only
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, licensor_id)
  values ('cerulean892.ai','cerulean892/e.ai','ai','zq892e', now(), now(), 'https://example.invalid/e.png', l1) returning id into a5;

  -- g1: keyword + picture, licensor one.   g2: picture only, licensor two.
  -- g3: keyword + picture, licensor two.   g4: picture only, no licensor.
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
  values ('style_group', g1, null, g1, 'zq892token one', '/lampstone/a', e0, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g2, null, g2, 'cerulean two', '/lampstone/b', e0, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g3, null, g3, 'zq892token three', '/lampstone/c', e0, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g4, null, g4, 'cerulean four', '/lampstone/d', e0, 'google/siglip2-base-patch16-naflex'),
         ('asset', a5, a5, null, 'cerulean five', '/lampstone/e', e0, 'google/siglip2-base-patch16-naflex')
  on conflict (document_type, entity_id) do update
    set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path,
        embedding=excluded.embedding, embedding_model=excluded.embedding_model;

  -- Baseline (no key) and an empty list: every picture match is returned.
  foreach f in array array['{}'::jsonb, '{"semanticLicensorIds":[]}'::jsonb, '{"semanticLicensorIds":null}'::jsonb] loop
    select array_agg(entity_id), min(total_count) into ids, n
    from public.search_dam_documents('zq892token', f, 50, 0, null, e0, 0, 0.5);
    if n <> 5 or not (ids @> array[g1,g2,g3,g4,a5]) then
      raise exception 'popdam3#892 baseline with % returned % (want all 5)', f, n;
    end if;
  end loop;

  -- Licensor one named: its picture-only asset stays; the other licensor's keyword match stays
  -- (with its picture score); picture-only matches of licensor two and of no licensor go.
  f := jsonb_build_object('semanticLicensorIds', jsonb_build_array(l1));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq892token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 3 or not (ids @> array[g1,g3,a5]) or ids && array[g2,g4] then
    raise exception 'popdam3#892 licensor one: total % ids %', n, ids;
  end if;
  select semantic_rank into sem from public.search_dam_documents('zq892token', f, 50, 0, null, e0, 0, 0.5) where entity_id = g3;
  if sem is null then raise exception 'popdam3#892 keyword match lost its picture score'; end if;

  -- The exact total equals the per-document probe path ('customer' is a no-op filter).
  select min(total_count) into probe
  from public.search_dam_documents('zq892token', f || '{"customer":""}'::jsonb, 50, 0, null, e0, 0, 0.5);
  if probe <> n then raise exception 'popdam3#892 fast total % <> probe total %', n, probe; end if;

  -- Style-group-only search uses the exact vector leg: same rule.
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq892token', f, 50, 0, array['style_group'], e0, 0, 0.5);
  if n <> 2 or not (ids @> array[g1,g3]) then
    raise exception 'popdam3#892 style-group leg: total % ids %', n, ids;
  end if;

  -- Licensor two named: g2 returns, the unlicensed group and licensor one's asset do not.
  f := jsonb_build_object('semanticLicensorIds', jsonb_build_array(l2));
  select array_agg(entity_id), min(total_count) into ids, n
  from public.search_dam_documents('zq892token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 3 or not (ids @> array[g1,g2,g3]) then
    raise exception 'popdam3#892 licensor two: total % ids %', n, ids;
  end if;

  -- Both named.
  f := jsonb_build_object('semanticLicensorIds', jsonb_build_array(l1, l2));
  select min(total_count) into n from public.search_dam_documents('zq892token', f, 50, 0, null, e0, 0, 0.5);
  if n <> 4 then raise exception 'popdam3#892 both licensors: total % (want 4)', n; end if;

  -- Keyword-only call (no embedding): the key changes nothing.
  select min(total_count) into n from public.search_dam_documents('zq892token', f, 50, 0, null, null, 0, null);
  if n <> 2 then raise exception 'popdam3#892 keyword-only: total % (want 2)', n; end if;
end;
$test$;
rollback;
