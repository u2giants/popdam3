-- Contracts for 20260905142725_style_group_counts_change_predicate.sql (issue #2214).
--
-- What is being pinned:
--   1. Catalog posture of public.refresh_style_group_counts_batch(uuid[]) is unchanged:
--      argument name p_group_ids, RETURNS integer, LANGUAGE sql, SECURITY DEFINER,
--      search_path=public, statement_timeout=30s, lock_timeout=0, and EXECUTE granted to
--      authenticated, service_role and postgres.
--   2. Re-running the function over rows that already hold the correct values performs
--      ZERO writes. Proved two independent ways: the function returns 0, and every row's
--      ctid is byte-identical afterwards. A row version only survives an UPDATE if the
--      UPDATE never touched the row, so this fails loudly if the change predicate is
--      dropped.
--   3. A genuinely stale row IS still corrected - a wrong asset_count, a stale
--      latest_file_date (including the NULL-to-value transition that `<>` would miss),
--      and leftover primary_* fields on an emptied group.
--
-- Why ctid and not xmin or updated_at: the whole test runs inside one transaction, so
-- xmin is constant and now() is frozen. Neither can distinguish a rewrite from a skip.
-- ctid changes on every UPDATE, HOT updates included.
--
-- The behavioural half of this file would FAIL against the pre-#2214 body, which issued
-- the UPDATE unconditionally: step 3 would see 3 rows written instead of 0 and three
-- moved ctids.

begin;

do $catalog$
declare
  v_oid oid;
  v_prokind "char";
  v_secdef boolean;
  v_lang name;
  v_rettype text;
  v_argname text;
  v_config text[];
  v_missing text;
begin
  select p.oid, p.prokind, p.prosecdef, l.lanname,
         pg_catalog.format_type(p.prorettype, null),
         p.proargnames[1], p.proconfig
    into v_oid, v_prokind, v_secdef, v_lang, v_rettype, v_argname, v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.proname = 'refresh_style_group_counts_batch'
    -- Match on argument TYPES, not on pg_get_function_identity_arguments(): that
    -- function includes the parameter NAME ("p_group_ids uuid[]"), so comparing it to
    -- 'uuid[]' silently matches nothing and reports a present function as missing.
    and p.pronargs = 1
    and p.proargtypes[0] = 'uuid[]'::regtype;

  if v_oid is null then
    raise exception 'CONTRACT: public.refresh_style_group_counts_batch(uuid[]) is missing. Issue #2214 replaces this exact signature and must not change it.';
  end if;

  if v_prokind is distinct from 'f' then
    raise exception 'CONTRACT: refresh_style_group_counts_batch is no longer a plain function (prokind=%).', v_prokind;
  end if;

  if v_rettype is distinct from 'integer' then
    raise exception 'CONTRACT: refresh_style_group_counts_batch now returns %, not integer. The return type is part of the preserved contract.', v_rettype;
  end if;

  if v_lang is distinct from 'sql' then
    raise exception 'CONTRACT: refresh_style_group_counts_batch is now LANGUAGE %, not sql.', v_lang;
  end if;

  if v_secdef is distinct from true then
    raise exception 'CONTRACT: refresh_style_group_counts_batch lost SECURITY DEFINER. Its callers rely on the definer''s privileges on public.style_groups.';
  end if;

  if v_argname is distinct from 'p_group_ids' then
    raise exception 'CONTRACT: the argument is now named %, not p_group_ids. PostgREST named-argument RPC calls bind by name and would break.', coalesce(v_argname, '<unnamed>');
  end if;

  foreach v_missing in array array['search_path=public', 'statement_timeout=30s', 'lock_timeout=0'] loop
    if v_config is null or not (v_missing = any (v_config)) then
      raise exception 'CONTRACT: refresh_style_group_counts_batch lost its % setting. proconfig is now %.', v_missing, coalesce(v_config::text, '<null>');
    end if;
  end loop;

  -- The change predicate itself must be present in the stored body. This is a
  -- source-level assertion; the behavioural block below is the one that proves it works.
  if pg_get_functiondef(v_oid) !~* 'IS DISTINCT FROM\s+agg\.asset_count' then
    raise exception 'CONTRACT: the stored body of refresh_style_group_counts_batch has no asset_count change predicate. Issue #2214 exists solely to add one.';
  end if;

  raise notice 'OK: catalog posture of refresh_style_group_counts_batch(uuid[]) preserved.';
end $catalog$;

do $grants$
declare
  v_role text;
  v_ok boolean;
begin
  foreach v_role in array array['authenticated', 'service_role', 'postgres'] loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      raise notice 'SKIP: role % does not exist in this environment; its grant cannot be checked.', v_role;
      continue;
    end if;
    select has_function_privilege(v_role, 'public.refresh_style_group_counts_batch(uuid[])', 'EXECUTE') into v_ok;
    if v_ok is distinct from true then
      raise exception 'CONTRACT: role % lost EXECUTE on public.refresh_style_group_counts_batch(uuid[]). Issue #2214 preserves the grants exactly.', v_role;
    end if;
  end loop;
  raise notice 'OK: EXECUTE grants preserved.';
end $grants$;

do $behaviour$
declare
  v_populated uuid := '2214a000-0000-4000-8000-000000000001';
  v_empty     uuid := '2214a000-0000-4000-8000-000000000002';
  v_dated     uuid := '2214a000-0000-4000-8000-000000000003';
  v_ids       uuid[];
  v_written   integer;
  v_ctid_pop  tid;
  v_ctid_emp  tid;
  v_ctid_dat  tid;
  v_now_ctid  tid;
  v_count     integer;
  v_latest    timestamptz;
  v_thumb     text;
  v_modified  timestamptz := timestamptz '2026-01-02 03:04:05+00';
begin
  v_ids := array[v_populated, v_empty, v_dated];

  insert into public.style_groups (id, sku, folder_path, asset_count, latest_file_date)
  values
    (v_populated, 'ISSUE2214A1', '/contract/issue-2214/populated', 0, null),
    (v_empty,     'ISSUE2214B1', '/contract/issue-2214/empty',     0, null),
    (v_dated,     'ISSUE2214C1', '/contract/issue-2214/dated',     0, null);

  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, style_group_id, is_deleted)
  values
    ('issue2214-a1.png', '/contract/issue-2214/populated/a1.png', 'png', 'issue2214-quickhash-a1', v_modified, v_populated, false),
    ('issue2214-a2.png', '/contract/issue-2214/populated/a2.png', 'png', 'issue2214-quickhash-a2', v_modified + interval '1 day', v_populated, false),
    ('issue2214-a3.png', '/contract/issue-2214/populated/a3.png', 'png', 'issue2214-quickhash-a3', v_modified, v_populated, true),
    ('issue2214-c1.png', '/contract/issue-2214/dated/c1.png',     'png', 'issue2214-quickhash-c1', v_modified, v_dated,     false);

  -- Step 1: bring every row to the correct value, whatever the asset triggers already
  -- did during seeding. After this the three rows are by definition up to date.
  perform public.refresh_style_group_counts_batch(v_ids);

  -- Step 2: prove the seeding produced the values we are about to assert are stable.
  select asset_count, latest_file_date into v_count, v_latest
  from public.style_groups where id = v_populated;
  if v_count is distinct from 2 then
    raise exception 'SETUP: populated group should hold 2 live assets (the third is is_deleted), got %. The rest of this test would prove nothing.', v_count;
  end if;
  if v_latest is distinct from v_modified + interval '1 day' then
    raise exception 'SETUP: populated group latest_file_date should be the MAX over live assets, got %.', v_latest;
  end if;

  select ctid into v_ctid_pop from public.style_groups where id = v_populated;
  select ctid into v_ctid_emp from public.style_groups where id = v_empty;
  select ctid into v_ctid_dat from public.style_groups where id = v_dated;

  -- Step 3: THE CENTRAL ASSERTION. Re-running over already-correct rows writes nothing.
  -- Without the change predicate this returns 3 and moves all three ctids.
  v_written := public.refresh_style_group_counts_batch(v_ids);
  if v_written is distinct from 0 then
    raise exception 'CONTRACT: re-running refresh_style_group_counts_batch over three already-correct rows wrote % row(s); it must write 0. The change predicate from issue #2214 is missing or ineffective.', v_written;
  end if;

  select ctid into v_now_ctid from public.style_groups where id = v_populated;
  if v_now_ctid is distinct from v_ctid_pop then
    raise exception 'CONTRACT: the populated group was rewritten (ctid % -> %) even though nothing changed. Every such rewrite re-fires trg_dam_search_style_groups_refresh.', v_ctid_pop, v_now_ctid;
  end if;
  select ctid into v_now_ctid from public.style_groups where id = v_empty;
  if v_now_ctid is distinct from v_ctid_emp then
    raise exception 'CONTRACT: the empty group was rewritten (ctid % -> %) even though nothing changed.', v_ctid_emp, v_now_ctid;
  end if;
  select ctid into v_now_ctid from public.style_groups where id = v_dated;
  if v_now_ctid is distinct from v_ctid_dat then
    raise exception 'CONTRACT: the dated group was rewritten (ctid % -> %) even though nothing changed.', v_ctid_dat, v_now_ctid;
  end if;

  -- Step 4: CONTROL. ctid must be able to move, or step 3 proves nothing.
  update public.style_groups set asset_count = 999 where id = v_populated;
  select ctid into v_now_ctid from public.style_groups where id = v_populated;
  if v_now_ctid is not distinct from v_ctid_pop then
    raise exception 'CONTROL: ctid did not move across a real UPDATE, so the no-rewrite assertions above cannot detect a rewrite and prove nothing.';
  end if;

  -- Step 5: a genuinely wrong asset_count is still corrected.
  v_written := public.refresh_style_group_counts_batch(array[v_populated]);
  if v_written is distinct from 1 then
    raise exception 'CONTRACT: a group with a wrong asset_count was not corrected (% rows written, expected 1). The predicate must skip unchanged rows, never stale ones.', v_written;
  end if;
  select asset_count into v_count from public.style_groups where id = v_populated;
  if v_count is distinct from 2 then
    raise exception 'CONTRACT: asset_count is % after correction, expected 2.', v_count;
  end if;

  -- Step 6: a stale latest_file_date is still corrected, including the NULL-to-value
  -- transition. `<>` instead of IS DISTINCT FROM would return NULL here and skip it.
  update public.style_groups set latest_file_date = null where id = v_dated;
  v_written := public.refresh_style_group_counts_batch(array[v_dated]);
  if v_written is distinct from 1 then
    raise exception 'CONTRACT: a NULL latest_file_date was not restored (% rows written, expected 1). A `<>` comparison instead of IS DISTINCT FROM produces exactly this failure.', v_written;
  end if;
  select latest_file_date into v_latest from public.style_groups where id = v_dated;
  if v_latest is distinct from v_modified then
    raise exception 'CONTRACT: latest_file_date is % after correction, expected %.', v_latest, v_modified;
  end if;

  -- Step 7: leftover primary_* fields on an empty group are still cleared.
  update public.style_groups
     set primary_thumbnail_url = 'https://example.invalid/issue-2214-stale.png',
         primary_asset_type    = 'png'
   where id = v_empty;
  v_written := public.refresh_style_group_counts_batch(array[v_empty]);
  if v_written is distinct from 1 then
    raise exception 'CONTRACT: an empty group with leftover primary_* fields was not cleared (% rows written, expected 1).', v_written;
  end if;
  select primary_thumbnail_url into v_thumb from public.style_groups where id = v_empty;
  if v_thumb is not null then
    raise exception 'CONTRACT: primary_thumbnail_url is % on an empty group; the CASE branch that clears it must survive the new predicate.', v_thumb;
  end if;

  -- Step 8: and having just corrected all three, a further run writes nothing again.
  v_written := public.refresh_style_group_counts_batch(v_ids);
  if v_written is distinct from 0 then
    raise exception 'CONTRACT: a run immediately after correction wrote % row(s); it must write 0.', v_written;
  end if;

  -- Step 9: an empty input array writes nothing and does not error.
  v_written := public.refresh_style_group_counts_batch(array[]::uuid[]);
  if v_written is distinct from 0 then
    raise exception 'CONTRACT: an empty id array wrote % row(s), expected 0.', v_written;
  end if;

  raise notice 'OK: unchanged rows are never rewritten, and stale counts, dates and primary fields are still corrected.';
end $behaviour$;

rollback;
