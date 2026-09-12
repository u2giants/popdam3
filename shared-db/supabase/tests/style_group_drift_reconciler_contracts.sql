-- Contracts for 20260907031246_style_group_drift_reconciler.sql (issue #2419).
--
-- What is being pinned:
--   1. THE FUNCTION WRITES NOTHING, proved rather than asserted. The first block runs
--      before this transaction has written anything, so no transaction id has been
--      assigned yet; calling the reconciler must leave it unassigned. Any INSERT,
--      UPDATE or DELETE - including one buried in a future "just fix it while we're
--      here" edit - assigns one. Step 1c is the control that proves the detector can
--      see a write at all, without which step 1b would prove nothing.
--   2. Catalog posture: LANGUAGE sql, STABLE (PostgreSQL itself then refuses a body
--      containing DML), SECURITY DEFINER, search_path/statement_timeout/lock_timeout,
--      the argument name p_effective_tag_sample, and the fourteen output column names
--      in order - the scheduled alerting job reads them by name.
--   3. Grants: EXECUTE for postgres and service_role only; PUBLIC, anon and
--      authenticated hold none.
--   4. THE SKU RULE IS THE SAME RULE THE REBUILD USES. #2419 says in terms that a
--      reconciler deriving the SKU differently from rebuild_style_groups_batch reports
--      drift that is really a rule mismatch. Issue #2478 extracts the helper: both
--      live bodies must call it and contain no duplicate derivation, while the helper
--      must retain every original predicate. Behavior and security tests below are
--      unchanged; separate parity contracts compare the old expression to the helper.
--   5. Behaviour, measured as DELTAS around a fixture rather than as absolute counts.
--      The reconciler reads the whole live asset population, so an absolute assertion
--      would depend on whatever else the database happens to hold. Deltas hold on an
--      empty CI database and on a populated one alike.
--        * an asset in the right group contributes nothing;
--        * an asset whose path yields a SKU but which carries no group, the wrong
--          group, or a SKU with no style_groups row yet, counts in
--          assets_missing_or_wrong_group;
--        * an asset whose path yields NO SKU but which still carries a group counts in
--          assets_with_unexpected_group - the direction the pre-#2408 rebuild could not
--          detect at all, and the one that leaves an asset resolving the WRONG
--          LICENSOR in the DAM libraries;
--        * a style_group_id pointing at no style_groups row counts in
--          orphan_group_references. That state cannot be reached while
--          assets_style_group_id_fkey exists, so the block drops the FK by its catalog
--          name inside this rolled-back transaction to build a genuine positive
--          control. Asserting a baseline of 0 without one would be asserting nothing.
--        * effective-tag drift is detected in BOTH directions: a projection row that
--          should exist and does not, and one that exists and should not.
--
-- Every call below passes a sample size far larger than any plausible live asset
-- count, so `order by random() limit n` selects every live asset and the sampled
-- assertions are deterministic.

begin;

-- ---------------------------------------------------------------------------------
-- 1. THE READ-ONLY PROOF. This must be the first thing the file does.
-- ---------------------------------------------------------------------------------
do $readonly$
declare
  v_before xid8;
  v_after xid8;
  v_control xid8;
begin
  v_before := pg_current_xact_id_if_assigned();
  if v_before is not null then
    raise exception 'SETUP: transaction id % was already assigned before the first reconciler call. Something wrote before this block, so the read-only proof below cannot distinguish the function''s writes from that one. This block must run first in the file.', v_before;
  end if;

  perform * from public.reconcile_style_group_drift(100000000);

  v_after := pg_current_xact_id_if_assigned();
  if v_after is not null then
    raise exception 'CONTRACT: calling public.reconcile_style_group_drift assigned transaction id %, which only a write does. This function is a DETECTOR. A detector that repairs what it finds stops being evidence that the system is correct and hides the recurrence rate that says whether the underlying fix worked (issue #2419).', v_after;
  end if;

  -- CONTROL: the same probe must go non-null across a real write, or the assertion
  -- above is vacuous.
  create temporary table zz_2419_readonly_control (probe int) on commit drop;
  insert into zz_2419_readonly_control values (1);
  v_control := pg_current_xact_id_if_assigned();
  if v_control is null then
    raise exception 'CONTROL: pg_current_xact_id_if_assigned() is still null after a real INSERT, so it cannot detect a write and the read-only assertion above proves nothing.';
  end if;

  raise notice 'OK: reconcile_style_group_drift performed no write, and the probe used to prove it is known to fire on one.';
end $readonly$;

-- ---------------------------------------------------------------------------------
-- 2. CATALOG POSTURE
-- ---------------------------------------------------------------------------------
do $catalog$
declare
  v_oid oid;
  v_prokind "char";
  v_volatile "char";
  v_secdef boolean;
  v_lang name;
  v_names text[];
  v_config text[];
  v_missing text;
  v_expected_out text[] := array[
    'observed_at','live_assets','grouped_assets','ungrouped_assets','style_group_rows',
    'effective_tag_rows','assets_missing_or_wrong_group','assets_with_unexpected_group',
    'orphan_group_references','effective_tag_sample_assets','effective_tag_missing_rows',
    'effective_tag_extra_rows','effective_tag_drifted_assets','effective_tag_drift_rate'
  ];
begin
  select p.oid, p.prokind, p.provolatile, p.prosecdef, l.lanname, p.proargnames, p.proconfig
    into v_oid, v_prokind, v_volatile, v_secdef, v_lang, v_names, v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.proname = 'reconcile_style_group_drift'
    -- Match on argument TYPES: pg_get_function_identity_arguments() carries the
    -- parameter name too, so comparing it to 'integer' would report a present
    -- function as missing.
    and p.pronargs = 1
    and p.proargtypes[0] = 'integer'::regtype;

  if v_oid is null then
    raise exception 'CONTRACT: public.reconcile_style_group_drift(integer) is missing. Issue #2419 creates exactly this signature, and the issues that retire the nightly full pass are blocked until it is live and reading clean.';
  end if;

  if v_prokind is distinct from 'f' then
    raise exception 'CONTRACT: reconcile_style_group_drift is no longer a plain function (prokind=%).', v_prokind;
  end if;

  if v_lang is distinct from 'sql' then
    raise exception 'CONTRACT: reconcile_style_group_drift is now LANGUAGE %, not sql. The read-only guarantee below rests on PostgreSQL refusing DML in a non-volatile SQL function.', v_lang;
  end if;

  -- 's' = STABLE. This is the structural half of the no-repair-mode rule: PostgreSQL
  -- refuses "INSERT/UPDATE/DELETE is not allowed in a non-volatile function", so a
  -- repair arm cannot be installed without first flipping this flag, which fails here.
  if v_volatile is distinct from 's' then
    raise exception 'CONTRACT: reconcile_style_group_drift has volatility ''%'', expected ''s'' (STABLE). VOLATILE would let a future edit add a repair arm that PostgreSQL currently refuses outright.', v_volatile;
  end if;

  if v_secdef is distinct from true then
    raise exception 'CONTRACT: reconcile_style_group_drift lost SECURITY DEFINER. The scheduled caller relies on the definer''s read privileges on public.assets and the tag tables.';
  end if;

  if v_names[1] is distinct from 'p_effective_tag_sample' then
    raise exception 'CONTRACT: the argument is now named %, not p_effective_tag_sample. PostgREST RPC binds named arguments by name.', coalesce(v_names[1], '<unnamed>');
  end if;

  if v_names[2:15] is distinct from v_expected_out then
    raise exception 'CONTRACT: the returned column names are now %, expected %. The alerting job reads them by name.', v_names[2:15]::text, v_expected_out::text;
  end if;

  foreach v_missing in array array['search_path=public, pg_temp', 'statement_timeout=600s', 'lock_timeout=5s'] loop
    if v_config is null or not (v_missing = any (v_config)) then
      raise exception 'CONTRACT: reconcile_style_group_drift lost its % setting. proconfig is now %.', v_missing, coalesce(v_config::text, '<null>');
    end if;
  end loop;

  raise notice 'OK: catalog posture of reconcile_style_group_drift(integer) is as issue #2419 specifies.';
end $catalog$;

-- ---------------------------------------------------------------------------------
-- 3. GRANTS
-- ---------------------------------------------------------------------------------
do $grants$
declare
  v_role text;
begin
  foreach v_role in array array['postgres', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      raise notice 'SKIP: role % does not exist in this environment; its grant cannot be checked.', v_role;
      continue;
    end if;
    if not has_function_privilege(v_role, 'public.reconcile_style_group_drift(integer)', 'EXECUTE') then
      raise exception 'CONTRACT: role % lost EXECUTE on public.reconcile_style_group_drift(integer). The scheduled reconciliation job runs as service_role.', v_role;
    end if;
  end loop;

  foreach v_role in array array['anon', 'authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      continue;
    end if;
    if has_function_privilege(v_role, 'public.reconcile_style_group_drift(integer)', 'EXECUTE') then
      raise exception 'CONTRACT: role % gained EXECUTE on reconcile_style_group_drift. It is SECURITY DEFINER over the whole live asset population and the migration revokes the default PUBLIC grant on purpose.', v_role;
    end if;
  end loop;

  if has_function_privilege('public', 'public.reconcile_style_group_drift(integer)', 'EXECUTE') then
    raise exception 'CONTRACT: PUBLIC holds EXECUTE on reconcile_style_group_drift. A new function is EXECUTE-to-PUBLIC by default and the migration revokes it; that revoke is missing.';
  end if;

  raise notice 'OK: EXECUTE is held by postgres and service_role only.';
end $grants$;

-- ---------------------------------------------------------------------------------
-- 4. BOTH CONSUMERS USE THE SHARED SKU DERIVATION
-- ---------------------------------------------------------------------------------
do $skurule$
declare
  v_recon text;
  v_rebuild text;
  v_helper text;
  v_token text;
  v_tokens text[] := array[
    'seg ~ ''^[A-Za-z0-9]+$''',
    'seg ~ ''[A-Za-z]''',
    'seg ~ ''[0-9]''',
    'pg_catalog.length(seg) >= 7',
    'ord < pg_catalog.array_length(pg_catalog.string_to_array('
  ];
begin
  select pg_get_functiondef(p.oid) into v_recon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'reconcile_style_group_drift'
    and p.pronargs = 1 and p.proargtypes[0] = 'integer'::regtype;

  select pg_get_functiondef(p.oid) into v_rebuild
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'rebuild_style_groups_batch'
    and p.pronargs = 2 and p.proargtypes[0] = 'uuid'::regtype and p.proargtypes[1] = 'integer'::regtype;

  if v_recon is null then
    raise exception 'CONTRACT: reconcile_style_group_drift is missing (see the catalog block).';
  end if;
  if v_rebuild is null then
    raise exception 'CONTRACT: public.rebuild_style_groups_batch(uuid, integer) is missing, so the shared SKU rule cannot be compared. The reconciler exists to agree with it; without it there is no rule to agree with.';
  end if;

  select pg_get_functiondef('public.style_group_key_for_sku(text)'::regprocedure)
    into v_helper;
  if position('public.style_group_key_for_sku(ab.relative_path)' in v_rebuild) = 0
    or position('public.style_group_key_for_sku(a.relative_path)' in v_recon) = 0 then
    raise exception 'CONTRACT: rebuild and detector must delegate their path to the shared SKU helper.';
  end if;
  foreach v_token in array v_tokens loop
    if position(v_token in v_helper) = 0 then
      raise exception 'CONTRACT: shared SKU helper lost derivation token "%".', v_token;
    end if;
    if position(v_token in v_rebuild) <> 0 or position(v_token in v_recon) <> 0 then
      raise exception 'CONTRACT: consumer duplicated shared SKU derivation token "%".', v_token;
    end if;
  end loop;
  raise notice 'OK: both consumers use the one shared SKU derivation.';
end $skurule$;

-- ---------------------------------------------------------------------------------
-- 5. BEHAVIOUR, MEASURED AS DELTAS
-- ---------------------------------------------------------------------------------
do $behaviour$
declare
  v0 record;
  v1 record;
  v2 record;
  v3 record;
  v4 record;
  v_g1 uuid;
  v_g2 uuid;
  v_fk name;
  v_a1 uuid := 'eeeeeeee-2419-4fff-8fff-000000000001';  -- SKU AAAA2419AA, correct group
  v_a2 uuid := 'eeeeeeee-2419-4fff-8fff-000000000002';  -- SKU AAAA2419AA, NO group
  v_a3 uuid := 'eeeeeeee-2419-4fff-8fff-000000000003';  -- SKU AAAA2419AA, WRONG group
  v_a4 uuid := 'eeeeeeee-2419-4fff-8fff-000000000004';  -- no SKU, still carries a group
  v_a5 uuid := 'eeeeeeee-2419-4fff-8fff-000000000005';  -- no SKU, no group (clean)
  v_a6 uuid := 'eeeeeeee-2419-4fff-8fff-000000000006';  -- SKU CCCC2419CC, which has no style_groups row
  v_orphan uuid := 'eeeeeeee-2419-4fff-8fff-0000000000ff';
  v_modified timestamptz := timestamptz '2026-01-02 03:04:05+00';
begin
  select * into v0 from public.reconcile_style_group_drift(100000000);

  insert into public.style_groups (sku, folder_path)
  values ('AAAA2419AA', 'contract/twofouronenine/AAAA2419AA')
  returning id into v_g1;

  insert into public.style_groups (sku, folder_path)
  values ('BBBB2419BB', 'contract/twofouronenine/BBBB2419BB')
  returning id into v_g2;

  -- No path segment before the filename in the A4/A5 paths satisfies the SKU rule
  -- (alphanumeric, >= 7 characters, at least one letter AND one digit): "contract",
  -- "twofouronenine" and "plainfolder" all lack digits. AAAA2419AA and CCCC2419CC do
  -- satisfy it.
  insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, style_group_id, is_deleted)
  values
    (v_a1, 'a1.png', 'contract/twofouronenine/AAAA2419AA/a1.png', 'png', 'issue2419-quickhash-a1', v_modified, v_g1, false),
    (v_a2, 'a2.png', 'contract/twofouronenine/AAAA2419AA/a2.png', 'png', 'issue2419-quickhash-a2', v_modified, null,  false),
    (v_a3, 'a3.png', 'contract/twofouronenine/AAAA2419AA/a3.png', 'png', 'issue2419-quickhash-a3', v_modified, v_g2,  false),
    (v_a4, 'a4.png', 'contract/twofouronenine/plainfolder/a4.png', 'png', 'issue2419-quickhash-a4', v_modified, v_g1,  false),
    (v_a5, 'a5.png', 'contract/twofouronenine/plainfolder/a5.png', 'png', 'issue2419-quickhash-a5', v_modified, null,  false),
    (v_a6, 'a6.png', 'contract/twofouronenine/CCCC2419CC/a6.png', 'png', 'issue2419-quickhash-a6', v_modified, null,  false);

  select * into v1 from public.reconcile_style_group_drift(100000000);

  if v1.live_assets - v0.live_assets is distinct from 6 then
    raise exception 'SETUP: live_assets moved by %, expected 6. The fixture is not being seen by the reconciler, so nothing below would be testing what it claims.', v1.live_assets - v0.live_assets;
  end if;
  if v1.grouped_assets - v0.grouped_assets is distinct from 3
     or v1.ungrouped_assets - v0.ungrouped_assets is distinct from 3 then
    raise exception 'SETUP: grouped/ungrouped moved by %/%, expected 3/3.', v1.grouped_assets - v0.grouped_assets, v1.ungrouped_assets - v0.ungrouped_assets;
  end if;
  if v1.style_group_rows - v0.style_group_rows is distinct from 2 then
    raise exception 'SETUP: style_group_rows moved by %, expected 2.', v1.style_group_rows - v0.style_group_rows;
  end if;

  -- Direction 1a: A2 (no group), A3 (wrong group), A6 (SKU with no style_groups row
  -- yet - the rebuild would create one and assign it, so it is drift now). A1 is
  -- correct and must NOT be counted.
  if v1.assets_missing_or_wrong_group - v0.assets_missing_or_wrong_group is distinct from 3 then
    raise exception 'CONTRACT (direction 1a): assets_missing_or_wrong_group moved by %, expected 3 - the ungrouped asset, the wrongly grouped one, and the one whose SKU has no style_groups row. 4 means a correctly grouped asset is being counted as drift, which would make every reading non-zero and the alert worthless.', v1.assets_missing_or_wrong_group - v0.assets_missing_or_wrong_group;
  end if;

  -- Direction 1b: A4 only. This is the direction #2419 calls out as undetectable by
  -- the rebuild, because the pre-#2408 function only ever SET style_group_id.
  if v1.assets_with_unexpected_group - v0.assets_with_unexpected_group is distinct from 1 then
    raise exception 'CONTRACT (direction 1b): assets_with_unexpected_group moved by %, expected exactly 1. 0 means an asset whose path yields no SKU but which still carries a style group goes unreported - and it goes on resolving the WRONG LICENSOR through style_groups in the DAM libraries with nothing surfacing it.', v1.assets_with_unexpected_group - v0.assets_with_unexpected_group;
  end if;

  if v1.orphan_group_references - v0.orphan_group_references is distinct from 0 then
    raise exception 'CONTRACT: orphan_group_references moved by % on a fixture with no orphan. Every group reference above points at a real style_groups row.', v1.orphan_group_references - v0.orphan_group_references;
  end if;

  -- ---------------------------------------------------------------------------
  -- ORPHAN POSITIVE CONTROL. assets_style_group_id_fkey makes an orphan reference
  -- unreachable, which is exactly why a plain "it reported 0" assertion would prove
  -- nothing. Drop the FK by its catalog name inside this rolled-back transaction,
  -- build a real orphan, and require the counter to see it.
  -- ---------------------------------------------------------------------------
  select con.conname into v_fk
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute att on att.attrelid = c.oid and att.attname = 'style_group_id'
  where n.nspname = 'public'
    and c.relname = 'assets'
    and con.contype = 'f'
    and array_length(con.conkey, 1) = 1
    and con.conkey[1] = att.attnum;

  if v_fk is null then
    raise exception 'SETUP: no single-column foreign key was found on public.assets(style_group_id). If that constraint has genuinely been removed, orphan_group_references stops being a defence-in-depth check and becomes the only thing standing between a bad restore and silently mis-attributed assets - which is a finding, not a test artefact.';
  end if;

  execute format('alter table public.assets drop constraint %I', v_fk);
  update public.assets set style_group_id = v_orphan where id = v_a5;

  select * into v2 from public.reconcile_style_group_drift(100000000);

  if v2.orphan_group_references - v0.orphan_group_references is distinct from 1 then
    raise exception 'CONTRACT (direction 2): orphan_group_references moved by %, expected exactly 1 for an asset pointing at a style_groups row that does not exist.', v2.orphan_group_references - v0.orphan_group_references;
  end if;
  -- A5 has no SKU and now carries a group, so it also joins direction 1b.
  if v2.assets_with_unexpected_group - v0.assets_with_unexpected_group is distinct from 2 then
    raise exception 'CONTRACT: assets_with_unexpected_group moved by %, expected 2 once the orphaned asset joined it.', v2.assets_with_unexpected_group - v0.assets_with_unexpected_group;
  end if;

  update public.assets set style_group_id = null where id = v_a5;
  execute format(
    'alter table public.assets add constraint %I foreign key (style_group_id) references public.style_groups(id) on delete set null',
    v_fk);

  -- ---------------------------------------------------------------------------
  -- EFFECTIVE-TAG PROJECTION DRIFT
  -- ---------------------------------------------------------------------------
  -- The triggers installed by 20260830110517 maintain public.asset_effective_tags, so
  -- immediately after these two writes the projection is correct and the reconciler
  -- must report NO new drift. That negative reading is what makes the positive one
  -- below meaningful.
  insert into public.asset_tags (asset_id, tag, category, status, source)
  values (v_a1, 'zz-2419-asset-tag', 'other', 'active', 'manual');

  insert into public.style_group_tags (style_group_id, tag, category, status, source)
  values (v_g1, 'zz-2419-group-tag', 'other', 'active', 'manual');

  select * into v3 from public.reconcile_style_group_drift(100000000);

  if v3.effective_tag_missing_rows - v0.effective_tag_missing_rows is distinct from 0
     or v3.effective_tag_extra_rows - v0.effective_tag_extra_rows is distinct from 0 then
    raise exception 'CONTRACT: the reconciler reports drift (missing %, extra %) on a projection the triggers have just maintained correctly. A detector that cries wolf on healthy data is one people stop reading.',
      v3.effective_tag_missing_rows - v0.effective_tag_missing_rows,
      v3.effective_tag_extra_rows - v0.effective_tag_extra_rows;
  end if;
  if v3.effective_tag_sample_assets is distinct from v3.live_assets then
    raise exception 'SETUP: the sample covered % of % live assets. This file passes a sample larger than any live population precisely so the comparison is exhaustive and deterministic.', v3.effective_tag_sample_assets, v3.live_assets;
  end if;

  -- Now the two failure modes the projection can actually suffer: a row the trigger
  -- should have written and did not, and a row nothing should have written.
  delete from public.asset_effective_tags
  where asset_id = v_a1 and tag = 'zz-2419-asset-tag' and scope = 'asset';

  insert into public.asset_effective_tags (asset_id, tag, scope)
  values (v_a4, 'zz-2419-phantom-tag', 'asset');

  select * into v4 from public.reconcile_style_group_drift(100000000);

  if v4.effective_tag_missing_rows - v3.effective_tag_missing_rows is distinct from 1 then
    raise exception 'CONTRACT (direction 3, missing): effective_tag_missing_rows moved by %, expected 1. A tag that is active on the asset but absent from the projection is a missed trigger firing, and it makes the asset invisible to that filter in the DAM.', v4.effective_tag_missing_rows - v3.effective_tag_missing_rows;
  end if;

  if v4.effective_tag_extra_rows - v3.effective_tag_extra_rows is distinct from 1 then
    raise exception 'CONTRACT (direction 3, extra): effective_tag_extra_rows moved by %, expected 1. A projection row with no live source makes the asset appear under a filter it does not belong to. Comparing one direction only would miss it entirely.', v4.effective_tag_extra_rows - v3.effective_tag_extra_rows;
  end if;

  if v4.effective_tag_drifted_assets - v3.effective_tag_drifted_assets is distinct from 2 then
    raise exception 'CONTRACT: effective_tag_drifted_assets moved by %, expected 2 - the two distinct assets involved. #2419 alerts on a RATE here rather than a row count, so the denominator and the numerator must both be assets.', v4.effective_tag_drifted_assets - v3.effective_tag_drifted_assets;
  end if;

  if v4.effective_tag_drift_rate is null or v4.effective_tag_drift_rate <= 0 then
    raise exception 'CONTRACT: effective_tag_drift_rate is % with % drifted asset(s) in a sample of %. The rate is what the alert is written against.', coalesce(v4.effective_tag_drift_rate::text, '<null>'), v4.effective_tag_drifted_assets, v4.effective_tag_sample_assets;
  end if;

  -- A zero-sized sample must not divide by zero, and must not pretend to be clean.
  if (select r.effective_tag_drift_rate from public.reconcile_style_group_drift(0) r) is not null then
    raise exception 'CONTRACT: a zero-row sample reported a drift rate. With nothing sampled the rate is unknown, not 0 - reporting 0 would let a misconfigured job show a permanently healthy reading.';
  end if;

  raise notice 'OK: both group-drift directions, orphan references and both effective-tag directions are detected, and a converged fixture reports none.';
end $behaviour$;

rollback;
