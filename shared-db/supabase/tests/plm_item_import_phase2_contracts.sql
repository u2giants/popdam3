-- =====================================================================================
-- Issue #853 / claim #857 — contract tests for fix_schema_for_api.md PHASE 2.
--
-- READ THIS FIRST: PHASE 2 WAS ALREADY SHIPPED.
--   Phase 2 ("stand up plm.item_import + plm.import_item_master_data") is NOT pending.
--   It landed on 2026-07-20 via migrations 20260720120000_item_taxonomy_phase2a_foundation
--   and 20260720121000_item_taxonomy_phase2b_resolver, under the *item-taxonomy* workstream
--   (fix_item_taxonomy_wiring.md) rather than under fix_schema_for_api.md, which is why
--   fix_schema_for_api.md still lists Phase 2 as pending. Both migrations are in the
--   production AND preview ledgers.
--
--   The shipped shape DIVERGES from what fix_schema_for_api.md line 339 asked for:
--     asked for : plm.item_import keyed on (source_system, source_id) + sync_run_id column
--     shipped   : plm.item_import keyed on (company_code, division_code, item_no)
--                 + a plm.item_import_staging sweep table; the sync-run linkage lives in
--                 ingest.sync_run / ingest.raw_record, written by the resolver.
--     asked for : plm.import_item_master_data(p_sync_run_id uuid)
--     shipped   : plm.import_item_master_data(import_payload jsonb)
--
--   No new Phase 2 migration was authored. Re-creating these objects under a second
--   version would have DROPPED or diverged from a live contract. This file exists to
--   pin the contract that is actually deployed, and to prove the Phase 3/4 preconditions.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel ONLY:
--       \i supabase/tests/plm_item_import_phase2_contracts.sql
--   Run each `do $$` block as a SEPARATE statement. Submitting the whole file as one
--   batch through the transaction pooler (port 6543) wraps them in one implicit
--   transaction and stalls.
--
-- WHY IT IS SHAPED THIS WAY
--   NOT ONE assertion reads supabase_migrations.schema_migrations. "It applied
--   successfully" proves nothing here: this repo has shipped a migration that recorded a
--   clean ledger row while its object did nothing (a BEFORE trigger reading a
--   GENERATED ... STORED column, which Postgres populates after before-triggers, so the
--   guard silently never fired). Everything below checks an OBJECT via the catalog
--   (to_regclass / pg_proc / pg_constraint / pg_policies / pg_get_viewdef) or a BEHAVIOUR
--   by actually invoking it.
--
--   Section C is the important one: it drives the resolver's REFUSAL paths and then
--   proves the refusals wrote nothing. A guard that raises but leaves a half-written
--   sync run behind is not a guard.
--
-- SIDE EFFECTS
--   None that persist. Section C calls the resolver only with payloads it must REJECT;
--   each rejection rolls back its own plpgsql subtransaction, and the block asserts that
--   ingest.sync_run, plm.item_import and plm.item are all unchanged afterwards. Nothing
--   reads or writes public.erp_items_current, and plm.style_tracker_item_bridge is never
--   touched.
-- =====================================================================================

-- ---------------------------------------------------------------------------- A + B
do $$
declare
  v_msg text; v_n integer; v_def text; v_pass integer := 0; v_fail integer := 0;
begin
  raise notice '=== A. OBJECT EXISTENCE (catalog, never schema_migrations) ===';
  foreach v_msg in array array['plm.item_import','plm.item_import_staging','plm.item','ingest.sync_run','ingest.raw_record','ingest.dedupe_candidate'] loop
    if to_regclass(v_msg) is null then
      v_fail := v_fail + 1; raise notice 'FAIL table missing: %', v_msg;
    else
      v_pass := v_pass + 1; raise notice 'PASS table exists: %  (oid %)', v_msg, to_regclass(v_msg)::oid;
    end if;
  end loop;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plm' and p.proname = 'import_item_master_data';
  if v_n = 1 then v_pass := v_pass + 1; raise notice 'PASS plm.import_item_master_data exists (1 overload)';
  else v_fail := v_fail + 1; raise notice 'FAIL plm.import_item_master_data overload count = % (expect 1)', v_n; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plm' and p.proname = 'import_item_master_data'
     and p.prosecdef and pg_get_function_identity_arguments(p.oid) = 'import_payload jsonb';
  if v_n = 1 then v_pass := v_pass + 1; raise notice 'PASS resolver is SECURITY DEFINER with the SHIPPED signature (import_payload jsonb)';
  else v_fail := v_fail + 1; raise notice 'FAIL resolver signature/secdef is not the shipped contract'; end if;

  raise notice '=== B. THE DURABILITY PROPERTY THAT MAKES PHASE 4 SAFE ===';

  -- B1. The silver mirror is keyed on a DURABLE business key. public.erp_items_current.id
  --     is a random uuid (gen_random_uuid()) that does NOT survive truncate-and-re-pull;
  --     nothing in the new path may key on it.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conrelid = 'plm.item_import'::regclass and contype = 'p';
  if v_def = 'PRIMARY KEY (company_code, division_code, item_no)' then
    v_pass := v_pass + 1; raise notice 'PASS plm.item_import pk is the durable ColdLion key: %', v_def;
  else
    v_fail := v_fail + 1; raise notice 'FAIL plm.item_import pk is %', coalesce(v_def, 'MISSING');
  end if;

  -- B2. plm.item resolves on (source_system, source_id) and that pair is UNIQUE. This is
  --     what guarantees plm.item.id is allocated once and never re-allocated on a re-pull.
  select count(*) into v_n from pg_constraint
   where conrelid = 'plm.item'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) like '%(source_system, source_id)%';
  if v_n = 1 then v_pass := v_pass + 1; raise notice 'PASS plm.item has UNIQUE (source_system, source_id) — the durable canonical key';
  else v_fail := v_fail + 1; raise notice 'FAIL plm.item UNIQUE (source_system, source_id) count = % (expect 1)', v_n; end if;

  -- B3. NOTHING in the new path may FK to the volatile erp_items_current.id.
  select count(*) into v_n from pg_constraint
   where conrelid in ('plm.item_import'::regclass, 'plm.item_import_staging'::regclass, 'plm.item'::regclass)
     and contype = 'f' and confrelid = 'public.erp_items_current'::regclass;
  if v_n = 0 then v_pass := v_pass + 1; raise notice 'PASS no FK from the new path to the volatile public.erp_items_current.id';
  else v_fail := v_fail + 1; raise notice 'FAIL % FK(s) in the new path point at erp_items_current.id', v_n; end if;

  -- B4. item_import links to the canonical item, not the other way round.
  select count(*) into v_n from pg_constraint
   where conrelid = 'plm.item_import'::regclass and contype = 'f' and confrelid = 'plm.item'::regclass;
  if v_n = 1 then v_pass := v_pass + 1; raise notice 'PASS plm.item_import.item_id FK -> plm.item present';
  else v_fail := v_fail + 1; raise notice 'FAIL expected 1 FK to plm.item, found %', v_n; end if;

  -- B5. `dismissed` is OUR curation flag. It must NOT live on a truncate-and-replace mirror.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm' and table_name = 'item_import' and column_name = 'dismissed';
  if v_n = 0 then v_pass := v_pass + 1; raise notice 'PASS plm.item_import carries no `dismissed` column';
  else v_fail := v_fail + 1; raise notice 'FAIL `dismissed` leaked onto the truncate-and-replace mirror'; end if;

  -- B6. No GENERATED ... STORED columns hiding under a BEFORE trigger.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'plm' and table_name in ('item_import','item_import_staging') and is_generated <> 'NEVER';
  if v_n = 0 then v_pass := v_pass + 1; raise notice 'PASS no GENERATED columns on the import tables';
  else v_fail := v_fail + 1; raise notice 'FAIL % GENERATED column(s) present — any BEFORE trigger reading them is unreliable', v_n; end if;

  -- B7. RLS on, and nothing reachable by anon.
  select count(*) into v_n from pg_class where oid = 'plm.item_import'::regclass and relrowsecurity;
  if v_n = 1 then v_pass := v_pass + 1; raise notice 'PASS RLS enabled on plm.item_import';
  else v_fail := v_fail + 1; raise notice 'FAIL RLS is NOT enabled on plm.item_import'; end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'plm' and table_name in ('item_import','item_import_staging')
     and grantee in ('anon','PUBLIC');
  if v_n = 0 then v_pass := v_pass + 1; raise notice 'PASS no anon/PUBLIC table grants on the import tables';
  else v_fail := v_fail + 1; raise notice 'FAIL % anon/PUBLIC grant(s) on the import tables', v_n; end if;

  -- B8. The resolver is not reachable from a browser session. NOTE: the shipped function
  --     has NO in-body role check; its only defence is the absence of EXECUTE grants.
  --     If this ever fails, it is a live privilege hole, not a style nit.
  select count(*) into v_n from information_schema.routine_privileges
   where routine_schema = 'plm' and routine_name = 'import_item_master_data'
     and grantee in ('anon','authenticated','PUBLIC');
  if v_n = 0 then v_pass := v_pass + 1; raise notice 'PASS resolver EXECUTE not granted to anon/authenticated/PUBLIC (its ONLY defence — it has no in-body role guard)';
  else v_fail := v_fail + 1; raise notice 'FAIL resolver EXECUTE reachable by % browser principal(s) AND it has no in-body role guard', v_n; end if;

  raise notice '--- PART 1 RESULT: % passed / % failed ---', v_pass, v_fail;
  if v_fail > 0 then raise exception 'Phase 2 contract tests part 1 FAILED: % failure(s)', v_fail; end if;
end $$;

-- ---------------------------------------------------------------------------- C
-- BEHAVIOUR: every refusal path must FIRE, and must leave nothing behind.
do $$
declare
  v_pass integer := 0; v_fail integer := 0;
  v_runs_before integer; v_runs_after integer;
  v_imp_before integer; v_imp_after integer;
  v_item_before integer; v_item_after integer;
  v_stg_before integer; v_stg_after integer;
begin
  raise notice '=== C. NEGATIVE PATHS (the guards must actually fire, and roll back) ===';

  select count(*) into v_runs_before from ingest.sync_run;
  select count(*) into v_imp_before  from plm.item_import;
  select count(*) into v_item_before from plm.item;
  select count(*) into v_stg_before  from plm.item_import_staging;
  raise notice 'INFO baseline: sync_run=% item_import=% item=% staging=%',
    v_runs_before, v_imp_before, v_item_before, v_stg_before;

  -- C1. items must be a JSON array.
  begin
    perform * from plm.import_item_master_data('{"items": "not-an-array", "terminalReached": true}'::jsonb);
    v_fail := v_fail + 1; raise notice 'FAIL resolver accepted a non-array items payload';
  exception when others then
    if sqlerrm like '%items must be a JSON array%' then
      v_pass := v_pass + 1; raise notice 'PASS refused non-array items: %', sqlerrm;
    else v_fail := v_fail + 1; raise notice 'FAIL wrong error for non-array items: %', sqlerrm; end if;
  end;

  -- C2. An incomplete sweep must NOT promote silver. This is the guard that stops a
  --     partial page from wiping the mirror.
  begin
    perform * from plm.import_item_master_data(
      '{"items": [{"companyCode":"X","divisionCode":"Y","itemNo":"Z"}], "terminalReached": false}'::jsonb);
    v_fail := v_fail + 1; raise notice 'FAIL resolver promoted silver from a NON-TERMINAL sweep';
  exception when others then
    if sqlerrm like '%terminal or empty page%' then
      v_pass := v_pass + 1; raise notice 'PASS refused non-terminal sweep: %', sqlerrm;
    else v_fail := v_fail + 1; raise notice 'FAIL wrong error for non-terminal sweep: %', sqlerrm; end if;
  end;

  -- C3. An empty sweep must NOT promote silver (otherwise a bad pull truncates the mirror).
  begin
    perform * from plm.import_item_master_data('{"items": [], "terminalReached": true}'::jsonb);
    v_fail := v_fail + 1; raise notice 'FAIL resolver promoted silver from an EMPTY sweep';
  exception when others then
    if sqlerrm like '%sweep is empty%' then
      v_pass := v_pass + 1; raise notice 'PASS refused empty sweep: %', sqlerrm;
    else v_fail := v_fail + 1; raise notice 'FAIL wrong error for empty sweep: %', sqlerrm; end if;
  end;

  -- C4. A row missing any part of the natural key must abort the whole sweep, not be
  --     silently dropped. A silently-dropped row is a silent data loss.
  --
  --     FINDING (measured on preview 2026-08-12, recorded rather than hidden): the
  --     resolver's OWN explicit check —
  --       `raise exception 'items payload contains a row missing companyCode, ...'`
  --     — is DEAD CODE. It sits AFTER the insert into plm.item_import_staging, whose
  --     columns are NOT NULL, so the insert raises not_null_violation first and the
  --     hand-written message is never reached. The observable behaviour is still
  --     correct (refuse + roll back), so this is a clarity defect, not a data-safety
  --     one. The assertion therefore checks the BEHAVIOUR and accepts either error,
  --     while naming the dead branch so nobody "verifies" a check that cannot run.
  begin
    perform * from plm.import_item_master_data(
      '{"items": [{"companyCode":"EDGEHOME","divisionCode":"83","itemNo":"OK1"},{"companyCode":"EDGEHOME","itemNo":"NOKEY"}], "terminalReached": true}'::jsonb);
    v_fail := v_fail + 1; raise notice 'FAIL resolver silently accepted a row missing divisionCode';
  exception when others then
    if sqlerrm like '%missing companyCode, divisionCode, or itemNo%' then
      v_pass := v_pass + 1;
      raise notice 'PASS refused a key-incomplete row via the resolver''s explicit check: %', sqlerrm;
    elsif sqlstate = '23502' and sqlerrm like '%item_import_staging%' then
      v_pass := v_pass + 1;
      raise notice 'PASS refused a key-incomplete row (via the staging NOT NULL constraint; the resolver''s own explicit check is DEAD CODE — see comment): %', sqlerrm;
    else
      v_fail := v_fail + 1; raise notice 'FAIL wrong error for key-incomplete row: % %', sqlstate, sqlerrm;
    end if;
  end;

  -- C5. An out-of-range sanity ratio must be refused.
  begin
    perform * from plm.import_item_master_data(
      '{"items": [], "terminalReached": true, "minimumSilverRatio": "0"}'::jsonb);
    v_fail := v_fail + 1; raise notice 'FAIL resolver accepted minimumSilverRatio = 0';
  exception when others then
    if sqlerrm like '%minimumSilverRatio%' then
      v_pass := v_pass + 1; raise notice 'PASS refused minimumSilverRatio = 0: %', sqlerrm;
    else v_fail := v_fail + 1; raise notice 'FAIL wrong error for bad ratio: %', sqlerrm; end if;
  end;

  -- C6. THE POINT OF SECTION C: every refusal above rolled back completely. The resolver
  --     inserts an ingest.sync_run row BEFORE several of these guards run, so if the
  --     subtransaction did not unwind, orphaned 'running' sync runs would accumulate.
  select count(*) into v_runs_after from ingest.sync_run;
  select count(*) into v_imp_after  from plm.item_import;
  select count(*) into v_item_after from plm.item;
  select count(*) into v_stg_after  from plm.item_import_staging;

  if v_runs_after = v_runs_before then
    v_pass := v_pass + 1; raise notice 'PASS no orphaned ingest.sync_run rows left by the refusals (% -> %)', v_runs_before, v_runs_after;
  else
    v_fail := v_fail + 1; raise notice 'FAIL refusals leaked sync_run rows: % -> %', v_runs_before, v_runs_after;
  end if;

  if v_imp_after = v_imp_before and v_item_after = v_item_before and v_stg_after = v_stg_before then
    v_pass := v_pass + 1; raise notice 'PASS refusals wrote nothing to item_import/item/staging (%/%/% unchanged)', v_imp_after, v_item_after, v_stg_after;
  else
    v_fail := v_fail + 1; raise notice 'FAIL refusals mutated data: import %->%, item %->%, staging %->%',
      v_imp_before, v_imp_after, v_item_before, v_item_after, v_stg_before, v_stg_after;
  end if;

  raise notice '--- PART 2 RESULT: % passed / % failed ---', v_pass, v_fail;
  if v_fail > 0 then raise exception 'Phase 2 contract tests part 2 FAILED: % failure(s)', v_fail; end if;
end $$;

-- ---------------------------------------------------------------------------- D
-- PHASE 3/4 PRECONDITIONS. These are NOT pass/fail gates on Phase 2 — they are the
-- measurements the owner needs before approving Phase 3/4, asserted here so they cannot
-- be quoted from a stale document. See docs/plm-item-phase3-4-execution-plan.md.
do $$
declare
  v_pass integer := 0; v_fail integer := 0; v_def text; v_n integer;
  v_erp integer; v_bridge integer; v_bridge_linked integer; v_item integer; v_import integer;
begin
  raise notice '=== D. PHASE 3/4 PRECONDITIONS (no cutover may have happened yet) ===';

  -- D1. api.plm_item_list must STILL read the legacy table. If it does not, Phase 4 shipped.
  select pg_get_viewdef('api.plm_item_list'::regclass, true) into v_def;
  if v_def like '%erp_items_current%' then
    v_pass := v_pass + 1; raise notice 'PASS api.plm_item_list still reads public.erp_items_current (Phase 4 has NOT shipped)';
  else
    v_fail := v_fail + 1; raise notice 'FAIL api.plm_item_list no longer reads erp_items_current — an unapproved cutover shipped';
  end if;

  -- D2. The bridge FK must still point at the legacy table, unrepointed.
  select count(*) into v_n from pg_constraint
   where conrelid = 'plm.style_tracker_item_bridge'::regclass and contype = 'f'
     and confrelid = 'public.erp_items_current'::regclass;
  if v_n = 1 then
    v_pass := v_pass + 1; raise notice 'PASS bridge FK still -> public.erp_items_current (not repointed)';
  else
    v_fail := v_fail + 1; raise notice 'FAIL bridge FK to erp_items_current count = % (expect 1)', v_n;
  end if;

  -- D3. #853 removes the silent-link-loss hazard while keeping the legacy FK additive.
  --     Deletes must now fail loudly until every bridge link has a canonical destination.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'plm.style_tracker_item_bridge'::regclass and contype = 'f'
     and confrelid = 'public.erp_items_current'::regclass;
  if v_def like '%ON DELETE RESTRICT%' or v_def not like '%ON DELETE%' then
    v_pass := v_pass + 1; raise notice 'PASS legacy bridge deletion fails loudly: %', v_def;
  else
    v_fail := v_fail + 1; raise notice 'FAIL legacy bridge FK can still erase a link silently: %', v_def;
  end if;

  -- D4. The reconciliation baseline Phase 3 must hit.
  select count(*) into v_erp from public.erp_items_current;
  select count(*) into v_item from plm.item;
  select count(*) into v_import from plm.item_import;
  select count(*) into v_bridge from plm.style_tracker_item_bridge;
  select count(*) into v_bridge_linked from plm.style_tracker_item_bridge where erp_item_id is not null;
  raise notice 'BASELINE erp_items_current=% | plm.item=% | plm.item_import=% | bridge rows=% | bridge linked=%',
    v_erp, v_item, v_import, v_bridge, v_bridge_linked;

  -- D5. THE PHASE 3 BLOCKER, measured. The shipped resolver builds
  --     plm.item.source_id = companyCode|divisionCode|itemNo, but erp_items_current keys
  --     on a BARE external_id with no pipes. The two key spaces do not overlap, so the
  --     bridge cannot be repointed by a naive source_id join.
  select count(*) into v_n from public.erp_items_current where external_id like '%|%';
  raise notice 'BLOCKER erp_items_current.external_id values containing a pipe: % of % (0 means the key spaces DIVERGE and Phase 3 needs an explicit mapping)',
    v_n, v_erp;
  if v_n = 0 then
    raise notice 'CONFIRMED: external_id is a BARE item number. Phase 3 must derive companyCode+divisionCode per row; it cannot join on external_id alone.';
  end if;

  select count(distinct external_id) into v_n from public.erp_items_current;
  if v_n = v_erp then
    v_pass := v_pass + 1; raise notice 'PASS external_id is unique across all % legacy rows (a 1:1 mapping is at least possible)', v_erp;
  else
    v_fail := v_fail + 1; raise notice 'FAIL external_id is NOT unique (% distinct of %) — Phase 3 mapping cannot be 1:1', v_n, v_erp;
  end if;

  raise notice '--- PART 3 RESULT: % passed / % failed ---', v_pass, v_fail;
  if v_fail > 0 then raise exception 'Phase 3/4 precondition checks FAILED: % failure(s)', v_fail; end if;
end $$;
