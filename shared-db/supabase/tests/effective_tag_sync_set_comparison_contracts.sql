-- Issue #2213 contract: public.sync_asset_effective_tags() must maintain
-- public.asset_effective_tags by SET COMPARISON, not by delete-all-then-reinsert.
--
-- Measured production evidence behind this test (issue #2213): 6,762,623
-- deletes and 6,762,623 inserts in 7.556 days for zero net change, all of them
-- fired by `UPDATE "public"."assets" SET "style_group_id" = ...`.
--
-- THIS TEST GENUINELY FAILS AGAINST THE PREVIOUS BODY. Case A re-fires the
-- assets trigger with an unchanged derived set and asserts that the projection
-- takes zero inserts and zero deletes and that no stored row is even rewritten
-- (ctid identity). The delete-all-then-reinsert body rewrote every row of the
-- asset on every firing, so it fails Case A on all three assertions. Case C
-- asserts the write volume of a genuinely changed set is exactly the size of
-- the difference; the old body would report the whole set.
--
-- Correctness is asserted independently of write volume: Cases B, C, D and E
-- compare the FULL final tag set against the set derived from first principles,
-- including the removal case, soft delete, and restore.
--
-- Measurement instrument: pg_stat_get_xact_tuples_inserted/deleted, which count
-- within the current transaction and need no stats-collector round trip.

begin;

do $$
declare
  v_group_a uuid := gen_random_uuid();
  v_group_b uuid := gen_random_uuid();
  v_asset uuid := gen_random_uuid();
  v_rel oid := 'public.asset_effective_tags'::regclass::oid;
  v_suffix text := txid_current()::text;
  v_file_tag_1 text := 'zz2213_file1_' || v_suffix;
  v_file_tag_2 text := 'zz2213_file2_' || v_suffix;
  v_file_tag_3 text := 'zz2213_file3_' || v_suffix;
  v_group_a_tag_1 text := 'zz2213_ga1_' || v_suffix;
  v_group_a_tag_2 text := 'zz2213_ga2_' || v_suffix;
  v_group_b_tag_1 text := 'zz2213_gb1_' || v_suffix;
  v_ins_before bigint;
  v_del_before bigint;
  v_ins_delta bigint;
  v_del_delta bigint;
  v_expected text[];
  v_actual text[];
  v_ctids_before tid[];
  v_ctids_after tid[];
  v_asset_ctids_before tid[];
  v_asset_ctids_after tid[];
begin
  -- A statistics instrument that is switched off must FAIL, never pass silently:
  -- zero writes and zero counting look identical.
  if current_setting('track_counts') <> 'on' then
    raise exception
      'track_counts is off, so the no-op write assertions below cannot distinguish "no writes" from "no counting"';
  end if;

  if (
    select p.prosecdef is not true or p.provolatile <> 'v'
    from pg_proc p
    where p.oid = 'public.sync_asset_effective_tags()'::regprocedure
  ) then
    raise exception 'sync_asset_effective_tags lost its volatile SECURITY DEFINER posture';
  end if;

  -- The three triggers must still be attached and enabled: this change replaces
  -- the function body only, and a silently detached trigger would make every
  -- "zero writes" assertion below pass for the wrong reason.
  if (
    select count(*)
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where p.proname = 'sync_asset_effective_tags'
      and not t.tgisinternal
      and t.tgenabled = 'O'
  ) <> 3 then
    raise exception 'the three effective-tag sync triggers are not all present and enabled';
  end if;

  -- The projection is derived from tags alone, so this fixture deliberately
  -- carries NO licensor or property identity. That keeps it clear of the
  -- canonical licensing write authority guard without weakening anything the
  -- effective-tag contract actually asserts.
  insert into public.style_groups (id, sku, folder_path)
  values (v_group_a, 'ZZ2213-A-' || v_suffix, 'ZZ2213/A'),
         (v_group_b, 'ZZ2213-B-' || v_suffix, 'ZZ2213/B');

  insert into public.style_group_tags (style_group_id, tag, category, source, status, rejected_at)
  values (v_group_a, v_group_a_tag_1, 'theme', 'manual', 'active', null),
         (v_group_a, v_group_a_tag_2, 'theme', 'manual', 'active', null),
         (v_group_b, v_group_b_tag_1, 'theme', 'manual', 'active', null);

  insert into public.assets
    (id, filename, relative_path, file_type, quick_hash, modified_at, style_group_id,
     licensor_id, property_id, is_deleted)
  values
    (v_asset, 'zz2213.ai', 'ZZ2213/A/zz2213.ai', 'ai', 'zz2213-' || v_suffix, now(),
      v_group_a, null, null, false);

  insert into public.asset_tags (asset_id, tag, category, source, status)
  values (v_asset, v_file_tag_1, 'other', 'manual', 'active'),
         (v_asset, v_file_tag_2, 'other', 'manual', 'active'),
         (v_asset, v_file_tag_3, 'other', 'manual', 'active');

  -- ---------------------------------------------------------------------
  -- Baseline: the projection holds exactly the derived set.
  -- ---------------------------------------------------------------------
  select array_agg(scope || ':' || tag order by scope, tag)
    into v_actual
  from public.asset_effective_tags
  where asset_id = v_asset;

  v_expected := array[
    'asset:' || v_file_tag_1, 'asset:' || v_file_tag_2, 'asset:' || v_file_tag_3,
    'style_group:' || v_group_a_tag_1, 'style_group:' || v_group_a_tag_2
  ];
  select array_agg(x order by x) into v_expected from unnest(v_expected) x;

  if v_actual is distinct from v_expected then
    raise exception 'baseline projection is wrong: got %, expected %', v_actual, v_expected;
  end if;

  -- ---------------------------------------------------------------------
  -- CASE A -- unchanged input set: ZERO deletes, ZERO inserts, no row rewritten.
  -- This is the assertion the previous delete-all-then-reinsert body fails.
  -- ---------------------------------------------------------------------
  select array_agg(ctid order by ctid) into v_ctids_before
  from public.asset_effective_tags where asset_id = v_asset;

  v_ins_before := pg_stat_get_xact_tuples_inserted(v_rel);
  v_del_before := pg_stat_get_xact_tuples_deleted(v_rel);

  -- Exactly the production statement shape: a single-column write of
  -- style_group_id that does not change its value. 710,514 of these fired in
  -- the measured window and every one of them rewrote the whole set.
  update public.assets
     set style_group_id = v_group_a
   where id = v_asset;

  v_ins_delta := pg_stat_get_xact_tuples_inserted(v_rel) - v_ins_before;
  v_del_delta := pg_stat_get_xact_tuples_deleted(v_rel) - v_del_before;

  if v_del_delta <> 0 or v_ins_delta <> 0 then
    raise exception
      'unchanged effective-tag set still wrote to the projection: % inserts, % deletes (expected 0 and 0)',
      v_ins_delta, v_del_delta;
  end if;

  select array_agg(ctid order by ctid) into v_ctids_after
  from public.asset_effective_tags where asset_id = v_asset;

  if v_ctids_after is distinct from v_ctids_before then
    raise exception 'unchanged effective-tag set rewrote stored row versions (ctid identity changed)';
  end if;

  -- A same-value rewrite is not the only no-op shape: re-firing after a real
  -- change has settled must also write nothing.
  v_ins_before := pg_stat_get_xact_tuples_inserted(v_rel);
  v_del_before := pg_stat_get_xact_tuples_deleted(v_rel);

  update public.assets set style_group_id = v_group_a where id = v_asset;
  update public.assets set style_group_id = v_group_a where id = v_asset;

  if pg_stat_get_xact_tuples_inserted(v_rel) - v_ins_before <> 0
     or pg_stat_get_xact_tuples_deleted(v_rel) - v_del_before <> 0 then
    raise exception 'repeated duplicate delivery of an unchanged set still wrote to the projection';
  end if;

  -- ---------------------------------------------------------------------
  -- CASE B -- the set is still exactly correct after the no-op firings.
  -- ---------------------------------------------------------------------
  select array_agg(scope || ':' || tag order by scope, tag)
    into v_actual
  from public.asset_effective_tags
  where asset_id = v_asset;

  if v_actual is distinct from v_expected then
    raise exception 'no-op firings corrupted the projection: got %, expected %', v_actual, v_expected;
  end if;

  -- ---------------------------------------------------------------------
  -- CASE C -- a genuinely CHANGED set: reassignment to another style group.
  -- Both directions must be exact: the old group's two tags are REMOVED, the
  -- new group's one tag is ADDED, and the three asset-scope rows are untouched.
  -- ---------------------------------------------------------------------
  select array_agg(ctid order by ctid) into v_asset_ctids_before
  from public.asset_effective_tags where asset_id = v_asset and scope = 'asset';

  v_ins_before := pg_stat_get_xact_tuples_inserted(v_rel);
  v_del_before := pg_stat_get_xact_tuples_deleted(v_rel);

  update public.assets set style_group_id = v_group_b where id = v_asset;

  v_ins_delta := pg_stat_get_xact_tuples_inserted(v_rel) - v_ins_before;
  v_del_delta := pg_stat_get_xact_tuples_deleted(v_rel) - v_del_before;

  if v_del_delta <> 2 or v_ins_delta <> 1 then
    raise exception
      'reassignment wrote more than the difference: % inserts, % deletes (expected 1 and 2)',
      v_ins_delta, v_del_delta;
  end if;

  select array_agg(ctid order by ctid) into v_asset_ctids_after
  from public.asset_effective_tags where asset_id = v_asset and scope = 'asset';

  if v_asset_ctids_after is distinct from v_asset_ctids_before then
    raise exception 'reassignment rewrote asset-scope rows that did not change';
  end if;

  select array_agg(scope || ':' || tag order by scope, tag)
    into v_actual
  from public.asset_effective_tags
  where asset_id = v_asset;

  v_expected := array[
    'asset:' || v_file_tag_1, 'asset:' || v_file_tag_2, 'asset:' || v_file_tag_3,
    'style_group:' || v_group_b_tag_1
  ];
  select array_agg(x order by x) into v_expected from unnest(v_expected) x;

  if v_actual is distinct from v_expected then
    raise exception 'reassignment produced the wrong final tag set: got %, expected %', v_actual, v_expected;
  end if;

  if exists (
    select 1 from public.asset_effective_tags
    where asset_id = v_asset and tag in (v_group_a_tag_1, v_group_a_tag_2)
  ) then
    raise exception 'the removal case failed: the previous style group''s tags survived reassignment';
  end if;

  -- ---------------------------------------------------------------------
  -- CASE D -- ungrouping: every style-group row is removed, asset rows remain.
  -- ---------------------------------------------------------------------
  update public.assets set style_group_id = null where id = v_asset;

  select array_agg(scope || ':' || tag order by scope, tag)
    into v_actual
  from public.asset_effective_tags
  where asset_id = v_asset;

  v_expected := array[
    'asset:' || v_file_tag_1, 'asset:' || v_file_tag_2, 'asset:' || v_file_tag_3
  ];

  if v_actual is distinct from v_expected then
    raise exception 'ungrouping produced the wrong final tag set: got %, expected %', v_actual, v_expected;
  end if;

  -- ---------------------------------------------------------------------
  -- CASE E -- soft delete clears the projection; restore rebuilds it exactly.
  -- ---------------------------------------------------------------------
  update public.assets set is_deleted = true where id = v_asset;

  if exists (select 1 from public.asset_effective_tags where asset_id = v_asset) then
    raise exception 'soft delete left effective tags behind';
  end if;

  update public.assets set is_deleted = false, style_group_id = v_group_a where id = v_asset;

  select array_agg(scope || ':' || tag order by scope, tag)
    into v_actual
  from public.asset_effective_tags
  where asset_id = v_asset;

  v_expected := array[
    'asset:' || v_file_tag_1, 'asset:' || v_file_tag_2, 'asset:' || v_file_tag_3,
    'style_group:' || v_group_a_tag_1, 'style_group:' || v_group_a_tag_2
  ];
  select array_agg(x order by x) into v_expected from unnest(v_expected) x;

  if v_actual is distinct from v_expected then
    raise exception 'restore after soft delete produced the wrong tag set: got %, expected %', v_actual, v_expected;
  end if;

  -- ---------------------------------------------------------------------
  -- CASE F -- the other two branches are unchanged and still exact. An
  -- asset-tag write must still add and remove exactly its own single row.
  -- ---------------------------------------------------------------------
  -- asset_tags_rejection_check requires rejected_at whenever status is
  -- 'rejected', so set both together.
  update public.asset_tags set status = 'rejected', rejected_at = now()
   where asset_id = v_asset and tag = v_file_tag_2;

  if exists (
    select 1 from public.asset_effective_tags
    where asset_id = v_asset and tag = v_file_tag_2
  ) then
    raise exception 'deactivating an asset tag did not remove its effective row';
  end if;

  -- And a style-group tag write must still reach the current member.
  insert into public.style_group_tags (style_group_id, tag, category, source, status)
  values (v_group_a, 'zz2213_late_' || v_suffix, 'theme', 'manual', 'active');

  if not exists (
    select 1 from public.asset_effective_tags
    where asset_id = v_asset and tag = 'zz2213_late_' || v_suffix and scope = 'style_group'
  ) then
    raise exception 'a new active style-group tag did not reach its member asset';
  end if;

  raise notice 'issue #2213 effective-tag set-comparison contracts passed';
end;
$$;

rollback;
