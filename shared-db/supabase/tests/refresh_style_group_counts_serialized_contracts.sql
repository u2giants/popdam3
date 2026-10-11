begin;

-- shared-db#4174: public.refresh_style_group_counts_serialized is service_role-only,
-- pins search_path, bounds lock_timeout and statement_timeout, returns 0 for
-- empty/null input, and delegates to refresh_style_group_counts_batch(p_group_ids
-- uuid[]) returning its row count. Rolled back.
do $$
declare
  v_cfg text[];
  g1 uuid;
  g2 uuid;
begin
  -- The callee contract this wrapper depends on (signature and argument name).
  if to_regprocedure('public.refresh_style_group_counts_batch(uuid[])') is null
     or (select proargnames[1] from pg_proc
          where oid = 'public.refresh_style_group_counts_batch(uuid[])'::regprocedure) <> 'p_group_ids' then
    raise exception 'callee public.refresh_style_group_counts_batch(p_group_ids uuid[]) is missing';
  end if;

  if to_regprocedure('public.refresh_style_group_counts_serialized(uuid[])') is null then
    raise exception 'public.refresh_style_group_counts_serialized(uuid[]) is missing';
  end if;
  select proconfig into v_cfg from pg_proc
   where oid = 'public.refresh_style_group_counts_serialized(uuid[])'::regprocedure
     and prosecdef and prokind = 'f' and provolatile = 'v'
     and prorettype = 'integer'::regtype
     and proargnames[1] = 'p_group_ids'
     and prolang = (select oid from pg_language where lanname = 'plpgsql');
  if v_cfg is null
     or not ('search_path=public' = any(v_cfg))
     or not ('lock_timeout=5s' = any(v_cfg))
     or not ('statement_timeout=15s' = any(v_cfg)) then
    raise exception 'refresh_style_group_counts_serialized catalog shape wrong: %', v_cfg;
  end if;

  if has_function_privilege('authenticated', 'public.refresh_style_group_counts_serialized(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.refresh_style_group_counts_serialized(uuid[])', 'execute') then
    raise exception 'refresh_style_group_counts_serialized must not be executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.refresh_style_group_counts_serialized(uuid[])', 'execute') then
    raise exception 'service_role must execute refresh_style_group_counts_serialized';
  end if;

  if public.refresh_style_group_counts_serialized('{}'::uuid[]) <> 0
     or public.refresh_style_group_counts_serialized(array[null]::uuid[]) <> 0
     or public.refresh_style_group_counts_serialized(null) <> 0 then
    raise exception 'empty input must return 0';
  end if;
  if public.refresh_style_group_counts_serialized(array[gen_random_uuid(), gen_random_uuid()]) <> 0 then
    raise exception 'unknown ids must update nothing';
  end if;

  -- Positive path: two groups with wrong stored counts; duplicates are collapsed.
  insert into public.style_groups (sku, folder_path) values ('ZZ4174A', '/zz4174/a') returning id into g1;
  insert into public.style_groups (sku, folder_path) values ('ZZ4174B', '/zz4174/b') returning id into g2;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, style_group_id)
    values ('zz4174a.pdf', 'zz4174/zz4174a.pdf', 'pdf', 'zz4174a', now(), g1);
  update public.style_groups set asset_count = 99 where id in (g1, g2);

  if public.refresh_style_group_counts_serialized(array[g2, g1, g1]) <> 2 then
    raise exception 'two stale groups must report 2 rows written';
  end if;
  if (select asset_count from public.style_groups where id = g1) <> 1
     or (select asset_count from public.style_groups where id = g2) <> 0 then
    raise exception 'counts were not recomputed through the callee';
  end if;
  if public.refresh_style_group_counts_serialized(array[g1, g2]) <> 0 then
    raise exception 'already-correct groups must report 0 rows written';
  end if;
end;
$$;

rollback;
