-- popcre/shared-db#6024: public.dam_search_semantic_anchor_scoped.
-- Scoped best <= unscoped best; NULL/empty licensor list = dam_search_semantic_anchor exactly;
-- grouped document -> style group licensor, ungrouped asset -> its own; nothing in scope = unscoped.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare
  l1 uuid; l2 uuid; g1 uuid; g2 uuid; g3 uuid; g4 uuid; a5 uuid;
  e0 extensions.vector := (array[1]::real[] || array_fill(0::real, array[767]))::extensions.vector;
  e8 extensions.vector := (array[0.8,0.6]::real[] || array_fill(0::real, array[766]))::extensions.vector;
  e6 extensions.vector := (array[0.6,0.8]::real[] || array_fill(0::real, array[766]))::extensions.vector;
  t text[]; g real; s real; ids uuid[];
begin
  -- core.licensor is protected by the licensing write-authority guard: one real,
  -- transaction-bound authorization per synthetic insert (pattern of
  -- character_alias_and_source_provenance_contracts.sql); it disappears with the rollback.
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '60240000-0000-4000-8000-000000000001', repeat('a', 64),
    'shared-db-6024 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('ZQ6024 Licensor One', 'ZQ6024-1', 'active') returning id into l1;
  -- core.licensor is protected by the licensing write-authority guard: one real,
  -- transaction-bound authorization per synthetic insert (pattern of
  -- character_alias_and_source_provenance_contracts.sql); it disappears with the rollback.
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '60240000-0000-4000-8000-000000000002', repeat('b', 64),
    'shared-db-6024 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('ZQ6024 Licensor Two', 'ZQ6024-2', 'active') returning id into l2;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ6024A', '/zq6024/a', l1) returning id into g1;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ6024B', '/zq6024/b', l2) returning id into g2;
  insert into public.style_groups (sku, folder_path, licensor_id) values ('ZQ6024C', '/zq6024/c', l2) returning id into g3;
  insert into public.style_groups (sku, folder_path) values ('ZQ6024D', '/zq6024/d') returning id into g4;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
  values ('zq6024a.pdf','zq6024/zq6024a.pdf','pdf','zq6024a', now(), now(), 'https://example.invalid/a.png', g1),
         ('zq6024b.pdf','zq6024/zq6024b.pdf','pdf','zq6024b', now(), now(), 'https://example.invalid/b.png', g2),
         ('zq6024c.pdf','zq6024/zq6024c.pdf','pdf','zq6024c', now(), now(), 'https://example.invalid/c.png', g3),
         ('zq6024d.pdf','zq6024/zq6024d.pdf','pdf','zq6024d', now(), now(), 'https://example.invalid/d.png', g4);
  -- a5: ungrouped asset of licensor one, picture match only
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, licensor_id)
  values ('cerulean6024.ai','cerulean6024/e.ai','ai','zq6024e', now(), now(), 'https://example.invalid/e.png', l1) returning id into a5;

  -- g1: keyword + picture, licensor one.   g2: picture only, licensor two.
  -- g3: keyword + picture, licensor two.   g4: picture only, no licensor.
  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
  values ('style_group', g1, null, g1, 'zq6024token one', '/lampstone/a', e8, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g2, null, g2, 'cerulean two', '/lampstone/b', e0, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g3, null, g3, 'zq6024token three', '/lampstone/c', e0, 'google/siglip2-base-patch16-naflex'),
         ('style_group', g4, null, g4, 'cerulean four', '/lampstone/d', e0, 'google/siglip2-base-patch16-naflex'),
         ('asset', a5, a5, null, 'cerulean five', '/lampstone/e', e6, 'google/siglip2-base-patch16-naflex')
  on conflict (document_type, entity_id) do update
    set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path,
        embedding=excluded.embedding, embedding_model=excluded.embedding_model;

  -- No scope: identical to the unscoped anchor for every document-type shape.
  foreach t slice 1 in array array[array[null,null]::text[], array['style_group','style_group'], array['asset','asset']] loop
    if t[1] is null then t := null; end if;
    g := public.dam_search_semantic_anchor(e0, t);
    ids := array[null]::uuid[];
    if public.dam_search_semantic_anchor_scoped(e0, t, null) is distinct from g
       or public.dam_search_semantic_anchor_scoped(e0, t, '{}') is distinct from g
         or public.dam_search_semantic_anchor_scoped(e0, t, ids) is distinct from g
         or public.dam_search_semantic_anchor_scoped(e0, t) is distinct from g then
        raise exception '#6024 unscoped call differs from dam_search_semantic_anchor for types %', t;
    end if;
  end loop;
  if public.dam_search_semantic_anchor_scoped(null, null, array[l1]) is not null then
    raise exception '#6024 NULL embedding must return NULL';
  end if;

  g := public.dam_search_semantic_anchor(e0, null);
  if abs(g - 1) > 1e-4 then raise exception '#6024 fixture: global anchor % (want 1)', g; end if;

  -- Licensor one: its group (0.8) beats its ungrouped asset (0.6); licensor two's picture (1.0) is ignored.
  s := public.dam_search_semantic_anchor_scoped(e0, null, array[l1]);
  if abs(s - 0.8) > 1e-4 or s > g then raise exception '#6024 licensor one scoped % (want 0.8 <= %)', s, g; end if;
  -- Style-group-only (exact leg).
  s := public.dam_search_semantic_anchor_scoped(e0, array['style_group'], array[l1]);
  if abs(s - 0.8) > 1e-4 or s > public.dam_search_semantic_anchor(e0, array['style_group']) then
    raise exception '#6024 licensor one style-group scoped %', s;
  end if;
  -- Assets only: the ungrouped asset counts by its own licensor.
  s := public.dam_search_semantic_anchor_scoped(e0, array['asset'], array[l1]);
  if abs(s - 0.6) > 1e-4 then raise exception '#6024 licensor one asset scoped % (want 0.6)', s; end if;
  -- Licensor two holds the global best; both named keeps the better one.
  s := public.dam_search_semantic_anchor_scoped(e0, null, array[l2]);
  if abs(s - 1) > 1e-4 then raise exception '#6024 licensor two scoped % (want 1)', s; end if;
  s := public.dam_search_semantic_anchor_scoped(e0, null, array[l1, l2, null]);
  if abs(s - 1) > 1e-4 then raise exception '#6024 both licensors scoped % (want 1)', s; end if;
  -- A licensor with no picture: falls back to the unscoped anchor.
  s := public.dam_search_semantic_anchor_scoped(e0, null, array['60240000-0000-4000-8000-0000000000ff'::uuid]);
  if s is distinct from g then raise exception '#6024 empty scope % (want unscoped %)', s, g; end if;

  -- anon cannot execute it.
  if has_function_privilege('anon', 'public.dam_search_semantic_anchor_scoped(extensions.vector,text[],uuid[])', 'execute') then
    raise exception '#6024 anon can execute the scoped anchor';
  end if;
end;
$test$;
rollback;
