begin;

-- shared-db#4167: public.apply_erp_item_updates is service_role-only, validates its
-- payload, and returns one result per item in order. Rolled back.
do $$
declare
  v jsonb;
  v_msg text;
  g1 uuid; g2 uuid; a1 uuid; a2 uuid; a_del uuid;
  v_big jsonb;
  v_cases text[] := array[
    '{"a":1}',
    '[1]',
    '[{"division_code":"X","updates":{"mg01_code":"A"}}]',
    '[{"sku":"S","division_code":"X","updates":{}}]',
    '[{"sku":"S","division_code":"X","updates":{"is_deleted":"true"}}]',
    '[{"sku":"S","division_code":"X","updates":{"mg01_code":5}}]',
    '[{"sku":5,"division_code":"X","updates":{"mg01_code":"A"}}]',
    '[{"sku":"S","division_code":5,"updates":{"mg01_code":"A"}}]'
  ];
  i int;
begin
  if has_function_privilege('authenticated', 'public.apply_erp_item_updates(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.apply_erp_item_updates(jsonb)', 'execute') then
    raise exception 'apply_erp_item_updates must not be executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.apply_erp_item_updates(jsonb)', 'execute') then
    raise exception 'service_role must execute apply_erp_item_updates';
  end if;

  v := public.apply_erp_item_updates('[]'::jsonb);
  if v <> '[]'::jsonb then raise exception 'empty page must return []: %', v; end if;

  v := public.apply_erp_item_updates(
    '[{"sku":"ZZ_TEST_NO_SUCH_SKU_4167","division_code":"ZZ","updates":{"mg01_code":"A","cover_description":null}},
      {"sku":"ZZ_TEST_NO_SUCH_SKU_4167b","division_code":"ZZ","updates":{"product_category":"B"}}]');
  if jsonb_array_length(v) <> 2
     or (v->0->>'asset_count')::int <> 0 or (v->0->>'group_count')::int <> 0
     or v->0->'asset_id' <> 'null'::jsonb or v->1->'group_id' <> 'null'::jsonb then
    raise exception 'unmatched items must report zero counts and null ids: %', v;
  end if;

  -- Matched rows: fixtures inside the rolled-back transaction.
  insert into public.style_groups (sku, folder_path, division_code, cover_description, mg01_code)
    values ('ZZ4167A', '/zz4167/a', 'ZZD', 'group cover kept', 'old') returning id into g1;
  insert into public.style_groups (sku, folder_path, division_code)
    values ('ZZ4167B', '/zz4167/b', 'ZZD') returning id into g2;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, style_group_id, sku, division_code, cover_description, mg01_code)
    values ('zz4167a.pdf', 'zz4167/zz4167a.pdf', 'pdf', 'zz4167a', now(), g1, 'ZZ4167A', 'ZZD', 'asset cover', 'old') returning id into a1;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, style_group_id, sku, division_code)
    values ('zz4167b.pdf', 'zz4167/zz4167b.pdf', 'pdf', 'zz4167b', now(), g2, 'ZZ4167B', 'ZZD') returning id into a2;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, style_group_id, sku, division_code, is_deleted)
    values ('zz4167d.pdf', 'zz4167/zz4167d.pdf', 'pdf', 'zz4167d', now(), g2, 'ZZ4167B', 'ZZD', true) returning id into a_del;
  -- Reset any trigger-derived group value so the cover_description check below is exact.
  update public.style_groups set cover_description = 'group cover kept' where id = g1;

  v := public.apply_erp_item_updates(jsonb_build_array(
    jsonb_build_object('sku','ZZ4167B','division_code','ZZD','updates',jsonb_build_object('product_category','Wall','size_code','L')),
    jsonb_build_object('sku','ZZ4167A','division_code','ZZD','updates',jsonb_build_object('mg01_code','NEW')),
    jsonb_build_object('sku','ZZ4167A','division_code','OTHER','updates',jsonb_build_object('mg01_code','X'))));
  if jsonb_array_length(v) <> 3
     or (v->0->>'asset_count')::int <> 1 or (v->0->>'group_count')::int <> 1
     or (v->0->>'asset_id')::uuid <> a2 or (v->0->>'group_id')::uuid <> g2
     or (v->1->>'asset_count')::int <> 1 or (v->1->>'group_count')::int <> 1
     or (v->1->>'asset_id')::uuid <> a1 or (v->1->>'group_id')::uuid <> g1
     or (v->2->>'asset_count')::int <> 0 or (v->2->>'group_count')::int <> 0 then
    raise exception 'matched results wrong or out of order: %', v;
  end if;
  if (select mg01_code from public.assets where id = a1) <> 'NEW'
     or (select mg01_code from public.style_groups where id = g1) <> 'NEW'
     or (select product_category from public.assets where id = a2) <> 'Wall'
     or (select size_code from public.style_groups where id = g2) <> 'L' then
    raise exception 'whitelisted fields were not written to both tables';
  end if;
  if (select product_category from public.assets where id = a_del) is not null then
    raise exception 'a deleted asset must not be updated';
  end if;
  if (select cover_description from public.assets where id = a1) <> 'asset cover'
     or (select cover_description from public.style_groups where id = g1) <> 'group cover kept' then
    raise exception 'an item without cover_description must not change cover_description on either table';
  end if;

  -- More than 500 items is refused.
  select jsonb_agg(jsonb_build_object('sku','ZZ4167N','division_code','ZZD','updates',jsonb_build_object('mg01_code','A')))
    into v_big from generate_series(1, 501);
  v_msg := null;
  begin
    perform public.apply_erp_item_updates(v_big);
  exception when sqlstate '22023' then v_msg := sqlerrm;
  end;
  if v_msg is null then raise exception '501 items were not refused'; end if;

  -- Catalog shape.
  if (select count(*) from pg_proc p
       where p.oid = 'public.apply_erp_item_updates(jsonb)'::regprocedure
         and p.prosecdef and p.prorettype = 'jsonb'::regtype
         and 'search_path=public' = any(p.proconfig)
         and 'lock_timeout=10s' = any(p.proconfig)) <> 1 then
    raise exception 'apply_erp_item_updates must be security definer with pinned search_path and lock_timeout';
  end if;

  for i in 1 .. array_length(v_cases, 1) loop
    v_msg := null;
    begin
      perform public.apply_erp_item_updates(v_cases[i]::jsonb);
    exception when sqlstate '22023' then
      v_msg := sqlerrm;
    end;
    if v_msg is null then
      raise exception 'case % was not refused: %', i, v_cases[i];
    end if;
  end loop;
end;
$$;

rollback;
