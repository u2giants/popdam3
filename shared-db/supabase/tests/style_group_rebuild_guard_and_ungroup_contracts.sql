-- Contracts for 20260906035323_style_group_rebuild_guard_and_ungroup.sql (issue #2408).
--
-- What is being pinned:
--   1. Catalog posture of public.rebuild_style_groups_batch(uuid, int) is unchanged:
--      argument names p_last_asset_id / p_batch_size, the five-column RETURNS TABLE with
--      its exact column names and types, LANGUAGE plpgsql, SECURITY DEFINER,
--      search_path=public, statement_timeout=120s, lock_timeout=0, and EXECUTE granted
--      to authenticated, service_role and postgres.
--   2. CHANGE 1 - an asset already sitting in the correct style group is NOT rewritten.
--      Proved by ctid: a heap tuple survives only if the UPDATE never touched the row.
--   3. CHANGE 2 - an asset whose path no longer yields a SKU IS ungrouped, and an asset
--      that is already ungrouped is NOT rewritten. Before this migration the function
--      had no ungroup arm at all: the stale asset kept resolving the wrong licensor
--      through style_groups forever.
--   4. CHANGE 3 - a style group whose values already match is NOT rewritten
--      (groups_created falls to 0 on a converged batch).
--   5. THE INTERACTION BETWEEN 3 AND 1, which is the whole reason this file exists.
--      `ON CONFLICT ... DO UPDATE ... WHERE` suppresses the RETURNING row for a
--      suppressed conflict. If `assigned` still joined the upsert's RETURNING, then a
--      group correctly skipped by change 3 would disappear from the join and its assets
--      would silently stop being assigned. Step 7 below assigns an asset to a group
--      whose upsert was suppressed in the very same statement - it passes only because
--      the function derives its targets from the UNION of the RETURNING and a snapshot
--      read of public.style_groups.
--
-- Why ctid and not xmin or updated_at: the whole test runs inside one transaction, so
-- xmin is constant and now() is frozen. Neither can distinguish a rewrite from a skip.
-- ctid changes on every UPDATE, HOT updates included. Step 8 is the control that proves
-- ctid can move at all, without which steps 4 and 7 would prove nothing.
--
-- How this file would fail against the PRE-#2408 body:
--   * step 4 would report assets_assigned = 2 instead of 0 and both ctids would move;
--   * step 4 would report groups_created = 2 instead of 0;
--   * step 7 would leave the stale asset still pointing at its old group.
-- And against a naive implementation that adds change 3 while leaving `assigned` joined
-- to `upserted_groups`, step 7 would report assets_assigned = 0 and leave the
-- newly-unassigned asset ungrouped.

begin;

do $catalog$
declare
  v_oid oid;
  v_prokind "char";
  v_secdef boolean;
  v_lang name;
  v_argnames text[];
  v_outnames text[];
  v_config text[];
  v_def text;
  v_missing text;
begin
  select p.oid, p.prokind, p.prosecdef, l.lanname, p.proargnames, p.proconfig
    into v_oid, v_prokind, v_secdef, v_lang, v_argnames, v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.proname = 'rebuild_style_groups_batch'
    -- Match on argument TYPES. pg_get_function_identity_arguments() includes the
    -- parameter names, so comparing it to 'uuid, integer' matches nothing and would
    -- report a present function as missing.
    and p.pronargs = 2
    and p.proargtypes[0] = 'uuid'::regtype
    and p.proargtypes[1] = 'integer'::regtype;

  if v_oid is null then
    raise exception 'CONTRACT: public.rebuild_style_groups_batch(uuid, integer) is missing. Issue #2408 replaces this exact signature and must not change it.';
  end if;

  if v_prokind is distinct from 'f' then
    raise exception 'CONTRACT: rebuild_style_groups_batch is no longer a plain function (prokind=%).', v_prokind;
  end if;

  if v_lang is distinct from 'plpgsql' then
    raise exception 'CONTRACT: rebuild_style_groups_batch is now LANGUAGE %, not plpgsql.', v_lang;
  end if;

  if v_secdef is distinct from true then
    raise exception 'CONTRACT: rebuild_style_groups_batch lost SECURITY DEFINER. Its callers rely on the definer''s privileges on public.assets and public.style_groups.';
  end if;

  -- proargnames on a RETURNS TABLE function holds the IN argument names followed by the
  -- OUT column names, in order.
  v_outnames := v_argnames;
  if v_argnames[1] is distinct from 'p_last_asset_id' or v_argnames[2] is distinct from 'p_batch_size' then
    raise exception 'CONTRACT: the arguments are now named %, %, not p_last_asset_id, p_batch_size. PostgREST named-argument RPC calls bind by name and the popdam3 worker passes both by name.',
      coalesce(v_argnames[1], '<unnamed>'), coalesce(v_argnames[2], '<unnamed>');
  end if;

  if v_outnames[3:7] is distinct from array['next_cursor','groups_created','assets_assigned','assets_ungrouped','done'] then
    raise exception 'CONTRACT: the returned column names are now %, not next_cursor, groups_created, assets_assigned, assets_ungrouped, done. The popdam3 worker reads row.done and row.next_cursor by name.', v_outnames[3:7]::text;
  end if;

  foreach v_missing in array array['search_path=public', 'statement_timeout=120s', 'lock_timeout=0'] loop
    if v_config is null or not (v_missing = any (v_config)) then
      raise exception 'CONTRACT: rebuild_style_groups_batch lost its % setting. proconfig is now %.', v_missing, coalesce(v_config::text, '<null>');
    end if;
  end loop;

  v_def := pg_get_functiondef(v_oid);

  -- Source-level assertions for the three changes. The behavioural block below is the
  -- one that proves they work; these catch a body that was replaced wholesale.
  if v_def !~* 'a\.style_group_id\s+IS DISTINCT FROM' then
    raise exception 'CONTRACT: the stored body has no IS DISTINCT FROM guard on the assignment UPDATE. Issue #2408 change 1 is missing.';
  end if;

  if v_def !~* 'SET style_group_id = NULL' then
    raise exception 'CONTRACT: the stored body has no ungroup arm. Issue #2408 change 2 exists to add one, and without it a renamed folder leaves the asset resolving the WRONG LICENSOR indefinitely.';
  end if;

  if v_def !~* 'style_groups\.folder_path\s+IS DISTINCT FROM' then
    raise exception 'CONTRACT: the stored body has no change predicate on the style_groups ON CONFLICT DO UPDATE. Issue #2408 change 3 is missing.';
  end if;

  -- The assignment target must NOT be taken from the upsert''s RETURNING alone. With
  -- change 3 in place that RETURNING no longer contains the suppressed groups.
  if v_def ~* 'JOIN\s+upserted_groups\s+ug\s+ON\s+ug\.sku\s*=\s*ga\.sku' then
    raise exception 'CONTRACT: the assignment UPDATE still joins upserted_groups directly. With the ON CONFLICT WHERE guard in place, every suppressed group vanishes from that RETURNING and its assets silently stop being assigned.';
  end if;

  if v_def !~* 'batch_groups' then
    raise exception 'CONTRACT: the batch_groups CTE is gone. It is the UNION of the upsert RETURNING with a snapshot read of style_groups, and both arms are required - see the migration header.';
  end if;

  raise notice 'OK: catalog posture of rebuild_style_groups_batch(uuid, integer) preserved and all three changes present in the body.';
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
    select has_function_privilege(v_role, 'public.rebuild_style_groups_batch(uuid, int)', 'EXECUTE') into v_ok;
    if v_ok is distinct from true then
      raise exception 'CONTRACT: role % lost EXECUTE on public.rebuild_style_groups_batch(uuid, int). Issue #2408 preserves the grants exactly.', v_role;
    end if;
  end loop;

  -- anon holds no EXECUTE in production and must not gain one here.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_function_privilege('anon', 'public.rebuild_style_groups_batch(uuid, int)', 'EXECUTE') then
      raise exception 'CONTRACT: anon gained EXECUTE on rebuild_style_groups_batch. Production ACL is {postgres,authenticated,service_role} only.';
    end if;
  end if;

  raise notice 'OK: EXECUTE grants preserved, anon still excluded.';
end $grants$;

do $behaviour$
declare
  -- The cursor sits immediately below the four fixture ids, so the batch this test
  -- drives contains exactly those four assets and nothing else. Step 0 proves it.
  v_cursor uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff0';
  v_a1 uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff1';  -- SKU folder AAAA2408AA
  v_a2 uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff2';  -- SKU folder BBBB2408BB
  v_a3 uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff3';  -- no SKU in path
  v_a4 uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff4';  -- no SKU in path, already ungrouped
  v_g1 uuid;
  v_g2 uuid;
  v_strays int;
  v_created int;
  v_assigned int;
  v_ungrouped int;
  v_done boolean;
  v_cur uuid;
  v_ctid_a2 tid;
  v_now_ctid tid;
  v_group uuid;
  v_modified timestamptz := timestamptz '2026-01-02 03:04:05+00';
begin
  -- Step 0: SETUP GUARD. If any other live asset sorts above the cursor, the returned
  -- counters below would include it and every assertion in this block would be
  -- meaningless. Fail loudly instead of passing by accident.
  select count(*)::int into v_strays
  from public.assets a
  where a.is_deleted = false
    and a.id > v_cursor
    and a.id not in (v_a1, v_a2, v_a3, v_a4);
  if v_strays <> 0 then
    raise exception 'SETUP: % live asset(s) already sort above the fixture cursor %. This test drives the function by cursor and its counter assertions would silently include those rows.', v_strays, v_cursor;
  end if;

  -- Step 1: seed. No path segment before the filename in the A3/A4 paths satisfies the
  -- SKU rule (alphanumeric, >= 7 chars, at least one letter AND one digit), so those two
  -- assets are ungroupable by construction. "contract", "twofouroheight" and
  -- "plainfolder" all lack digits; "AAAA2408AA" and "BBBB2408BB" are valid SKUs.
  insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, style_group_id, is_deleted)
  values
    (v_a1, 'a1.png', 'contract/twofouroheight/AAAA2408AA/a1.png', 'png', 'issue2408-quickhash-a1', v_modified, null, false),
    (v_a2, 'a2.png', 'contract/twofouroheight/BBBB2408BB/a2.png', 'png', 'issue2408-quickhash-a2', v_modified, null, false),
    (v_a3, 'a3.png', 'contract/twofouroheight/plainfolder/a3.png', 'png', 'issue2408-quickhash-a3', v_modified, null, false),
    (v_a4, 'a4.png', 'contract/twofouroheight/plainfolder/a4.png', 'png', 'issue2408-quickhash-a4', v_modified, null, false);

  -- Step 2: converge. This call creates the two groups and assigns A1 and A2.
  select r.groups_created, r.assets_assigned, r.done
    into v_created, v_assigned, v_done
  from public.rebuild_style_groups_batch(v_cursor, 500) r;

  if v_assigned is distinct from 2 then
    raise exception 'SETUP: the first rebuild assigned % asset(s), expected 2. The two SKU folders are not being recognised, so nothing below would be testing what it claims.', v_assigned;
  end if;
  if v_done is distinct from true then
    raise exception 'SETUP: the first rebuild reported done=%, expected true for a 4-row batch under a 500-row limit.', v_done;
  end if;

  select style_group_id into v_g1 from public.assets where id = v_a1;
  select style_group_id into v_g2 from public.assets where id = v_a2;
  if v_g1 is null or v_g2 is null or v_g1 = v_g2 then
    raise exception 'SETUP: expected two distinct style groups, got % and %.', v_g1, v_g2;
  end if;
  if (select style_group_id from public.assets where id = v_a3) is not null then
    raise exception 'SETUP: the SKU-less asset A3 was given a style group by the rebuild. The SKU rule is not behaving as the fixture assumes.';
  end if;

  select ctid into v_ctid_a2 from public.assets where id = v_a2;

  -- Step 3: THE CENTRAL NO-OP ASSERTION. Everything is now converged, so a second run
  -- must write NOTHING at all - not the groups, not the assignments, not the two
  -- already-ungrouped assets.
  select r.groups_created, r.assets_assigned, r.assets_ungrouped
    into v_created, v_assigned, v_ungrouped
  from public.rebuild_style_groups_batch(v_cursor, 500) r;

  if v_created is distinct from 0 then
    raise exception 'CONTRACT (change 3): a converged batch rewrote % style group row(s); it must rewrite 0. The ON CONFLICT DO UPDATE change predicate is missing or ineffective, and every such rewrite re-fires trg_dam_search_style_groups_refresh.', v_created;
  end if;
  if v_assigned is distinct from 0 then
    raise exception 'CONTRACT (change 1): a converged batch re-stamped % asset(s) with the style group they already held; it must write 0. style_group_id is indexed, so none of those rewrites can be HOT.', v_assigned;
  end if;
  if v_ungrouped is distinct from 0 then
    raise exception 'CONTRACT (change 2 guard): a converged batch rewrote % already-ungrouped asset(s); it must write 0. Without the `style_group_id IS NOT NULL` guard the new ungroup arm would rewrite all 37,593 legitimately ungrouped assets every night.', v_ungrouped;
  end if;

  -- Step 4: and the untouched asset's heap tuple must be byte-identical.
  select ctid into v_now_ctid from public.assets where id = v_a2;
  if v_now_ctid is distinct from v_ctid_a2 then
    raise exception 'CONTRACT (change 1): an already-correctly-grouped asset was rewritten (ctid % -> %) even though its style group did not change.', v_ctid_a2, v_now_ctid;
  end if;

  -- Step 5: create the two conditions the rest of the test measures.
  --   A1 loses its group, standing in for a newly-ingested asset dropped into an
  --   EXISTING, already-correct SKU folder. Its group's upsert will be suppressed by
  --   change 3, so this is exactly the case that breaks if `assigned` is joined to the
  --   upsert's RETURNING.
  --   A3 is given a stale group, standing in for the renamed folder: the asset no
  --   longer matches any SKU but still carries - and still resolves its licensor,
  --   property and customer facets through - its old group.
  update public.assets set style_group_id = null where id = v_a1;
  update public.assets set style_group_id = v_g2 where id = v_a3;

  select ctid into v_ctid_a2 from public.assets where id = v_a2;

  -- Step 6/7: one run must fix both, and must still rewrite no style group at all.
  select r.groups_created, r.assets_assigned, r.assets_ungrouped, r.next_cursor
    into v_created, v_assigned, v_ungrouped, v_cur
  from public.rebuild_style_groups_batch(v_cursor, 500) r;

  if v_created is distinct from 0 then
    raise exception 'CONTRACT (change 3): % style group row(s) were rewritten although no group value changed.', v_created;
  end if;

  -- THE INTERACTION ASSERTION. groups_created = 0 above proves both upserts were
  -- suppressed and therefore returned NO rows; the assignment below must still happen.
  if v_assigned is distinct from 1 then
    raise exception 'CONTRACT (changes 1 and 3 together): expected exactly 1 assignment, got %. If this is 0, the assignment UPDATE is drawing its groups from the upsert RETURNING, which the ON CONFLICT WHERE guard has just emptied - so an asset added to an existing, already-correct SKU folder is silently never grouped.', v_assigned;
  end if;
  select style_group_id into v_group from public.assets where id = v_a1;
  if v_group is distinct from v_g1 then
    raise exception 'CONTRACT (changes 1 and 3 together): the unassigned asset holds style group % after the rebuild, expected %. Its group''s upsert was suppressed in this same statement, so the function must be reading the group from public.style_groups, not only from the upsert RETURNING.', coalesce(v_group::text, '<null>'), v_g1;
  end if;

  -- THE UNGROUP ASSERTION. Exactly one asset is cleared: A3, which carried a stale
  -- group. A4 has no SKU either but is already ungrouped and must not be rewritten -
  -- this is what separates "rows actually cleared" from the old counter's "batch rows
  -- with no SKU", which would report 2 here.
  if v_ungrouped is distinct from 1 then
    raise exception 'CONTRACT (change 2): expected exactly 1 asset to be ungrouped, got %. 2 means assets_ungrouped is still counting SKU-less batch rows rather than rows actually cleared; 0 means the ungroup arm is missing and a renamed folder leaves the asset resolving the WRONG LICENSOR indefinitely.', v_ungrouped;
  end if;
  select style_group_id into v_group from public.assets where id = v_a3;
  if v_group is not null then
    raise exception 'CONTRACT (change 2): the asset whose path no longer yields a SKU still holds style group %. It goes on appearing under that group''s licensor in the DAM libraries with no error surfaced.', v_group;
  end if;
  if (select style_group_id from public.assets where id = v_a4) is not null then
    raise exception 'CONTRACT: the already-ungrouped asset A4 acquired a style group. Nothing in this change may assign a SKU-less asset.';
  end if;

  -- The cursor contract is untouched: it is what the popdam3 worker loops on.
  if v_cur is distinct from v_a4 then
    raise exception 'CONTRACT: next_cursor is %, expected the highest asset id in the batch (%). The worker advances solely on this value.', coalesce(v_cur::text, '<null>'), v_a4;
  end if;

  -- The untouched, correctly-grouped asset must STILL not have been rewritten, even in
  -- a run that did write two other rows of the same table.
  select ctid into v_now_ctid from public.assets where id = v_a2;
  if v_now_ctid is distinct from v_ctid_a2 then
    raise exception 'CONTRACT (change 1): the correctly-grouped asset was rewritten (ctid % -> %) by a run that only needed to touch two other assets.', v_ctid_a2, v_now_ctid;
  end if;

  -- Step 8: CONTROL. ctid must be able to move, or every no-rewrite assertion above is
  -- vacuous.
  update public.assets set style_group_id = null where id = v_a2;
  select ctid into v_now_ctid from public.assets where id = v_a2;
  if v_now_ctid is not distinct from v_ctid_a2 then
    raise exception 'CONTROL: ctid did not move across a real UPDATE of assets.style_group_id, so the no-rewrite assertions above cannot detect a rewrite and prove nothing.';
  end if;

  -- Step 9: and the function still repairs that deliberate damage - the guard skips
  -- unchanged rows, never stale ones.
  select r.assets_assigned into v_assigned
  from public.rebuild_style_groups_batch(v_cursor, 500) r;
  if v_assigned is distinct from 1 then
    raise exception 'CONTRACT: a genuinely unassigned asset was not re-assigned (% write(s), expected 1). The guard must skip unchanged rows only.', v_assigned;
  end if;
  select style_group_id into v_group from public.assets where id = v_a2;
  if v_group is distinct from v_g2 then
    raise exception 'CONTRACT: the repaired asset holds style group %, expected %.', coalesce(v_group::text, '<null>'), v_g2;
  end if;

  -- Step 10: fully converged again, a further run writes nothing.
  select r.groups_created, r.assets_assigned, r.assets_ungrouped
    into v_created, v_assigned, v_ungrouped
  from public.rebuild_style_groups_batch(v_cursor, 500) r;
  if (v_created, v_assigned, v_ungrouped) is distinct from (0, 0, 0) then
    raise exception 'CONTRACT: a run immediately after convergence wrote groups=%, assignments=%, ungroups=%; all three must be 0.', v_created, v_assigned, v_ungrouped;
  end if;

  raise notice 'OK: converged rows are never rewritten; a stale group is cleared; and a group whose upsert was suppressed is still assigned to its assets.';
end $behaviour$;

rollback;
