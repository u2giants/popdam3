-- Rollback-safe contract tests for
--   20260807170100_opa_property_character_importer.sql
--
-- Run against a disposable DB or preview AFTER both OPA migrations are applied:
--   20260807170000_opa_property_character_landing.sql
--   20260807170100_opa_property_character_importer.sql
--
-- ALL FIXTURE DATA IS INVENTED. Not one Disney row, name or ID appears here. This repo
-- is PUBLIC; the extract lives in the private repo u2giants/licensor-source-data.
--
-- Proves:
--   * the privilege guard is a REAL, CALLABLE function -- not a `do $$ ... $$` block,
--     which never lands in pg_proc and cannot be tested at all
--   * the guard REJECTS a NULL role (the null-permissive trap), asserted directly
--   * NEUTRALISE-AND-OBSERVE: the forbidden `not (... or ...)` shape is rebuilt here and
--     shown to ADMIT the NULL case, proving this test would FAIL if the guard regressed
--     to it. A negative test that passes with the bug present is a false safety signal.
--   * every snapshot guard rejects behaviourally: mode, shape, empty rows, missing
--     captured_at, blank source_url, wrong LOB, optionSourceID <> 1007, duplicate
--     ID pair, shrink beyond band
--   * a valid snapshot lands, is idempotent, and reports honest counts
--   * the ID PAIR is the key: identical name pairs under different IDs BOTH land
--   * the importer NEVER resolves -- a human resolution survives a re-import
--   * the importer NEVER deletes -- absence is reported as rows_missing only
--   * the importer writes NOTHING into core.*

begin;

do $$
declare
  v_ok             boolean;
  v_broken         boolean;
  v_snapshot       jsonb;
  v_r              record;
  v_count          integer;
  v_status         text;
  v_propid         uuid;
  v_lic            uuid;
  v_prop           uuid;
  v_core_before    integer;
  v_core_after     integer;
  v_prosecdef      boolean;
  v_caught         boolean;
begin
  -- ==================================================================================
  -- 1. THE GUARD IS TESTABLE AT ALL.
  --    An anonymous DO block never lands in pg_proc. A previous test file in this repo
  --    queried pg_proc.prosrc for a DO block and therefore asserted nothing. The guard
  --    must be a real function.
  -- ==================================================================================
  if to_regprocedure('plm.opa_loader_privilege_ok(text,text)') is null then
    raise exception 'plm.opa_loader_privilege_ok(text,text) does not exist in pg_proc. If '
      'the privilege check is a DO block it is untestable and must be refactored.';
  end if;

  -- ==================================================================================
  -- 2. THE NULL-PERMISSIVE TRAP. The guard must REJECT a null identity.
  --    Inside a migration auth.role() is NULL; a guard shaped
  --      if not ( ... or auth.role() = 'service_role' ) then raise
  --    evaluates `if not NULL then`, never runs the body, and admits everyone forever.
  -- ==================================================================================
  if plm.opa_loader_privilege_ok(null, null) then
    raise exception 'GUARD IS NULL-PERMISSIVE: opa_loader_privilege_ok(null, null) returned '
      'TRUE. A null identity must be REJECTED.';
  end if;
  if plm.opa_loader_privilege_ok(null, null) is null then
    raise exception 'GUARD RETURNED NULL for (null, null). NULL is not FALSE in an IF; the '
      'predicate must return a concrete boolean.';
  end if;

  -- Empty strings are not an identity either.
  if plm.opa_loader_privilege_ok('', '') then
    raise exception 'GUARD accepted empty-string identity';
  end if;

  -- A logged-in ordinary user is not a loader.
  if plm.opa_loader_privilege_ok('authenticated', 'authenticator') then
    raise exception 'GUARD accepted role=authenticated; only service_role and '
      'postgres/supabase_admin may load';
  end if;
  if plm.opa_loader_privilege_ok('anon', 'anon') then
    raise exception 'GUARD accepted role=anon';
  end if;

  -- Positive matches must still work, or the guard is merely broken the other way.
  if not plm.opa_loader_privilege_ok('service_role', null) then
    raise exception 'GUARD rejected role=service_role';
  end if;
  if not plm.opa_loader_privilege_ok(null, 'postgres') then
    raise exception 'GUARD rejected session_user=postgres';
  end if;
  if not plm.opa_loader_privilege_ok(null, 'supabase_admin') then
    raise exception 'GUARD rejected session_user=supabase_admin';
  end if;

  -- ==================================================================================
  -- 3. NEUTRALISE AND OBSERVE.
  --    Rebuild the FORBIDDEN shape and demonstrate that it admits the NULL case. This
  --    is the proof that assertion 2 is a real test and not a false safety signal: if
  --    the guard ever regressed to this shape, assertion 2 would fail.
  --    The broken function is created inside this transaction and rolls back with it.
  -- ==================================================================================
  create function pg_temp.opa_guard_broken(p_role text, p_session_user text)
  returns boolean language plpgsql immutable as $broken$
  begin
    -- WRONG SHAPE, ON PURPOSE. Never use this.
    if not (p_session_user = 'postgres' or p_role = 'service_role') then
      return false;   -- "reject" -- but with NULL inputs this line is NEVER REACHED
    end if;
    return true;
  end;
  $broken$;

  v_broken := pg_temp.opa_guard_broken(null, null);
  v_ok     := plm.opa_loader_privilege_ok(null, null);

  if v_broken is not distinct from v_ok then
    raise exception 'NEUTRALISE-AND-OBSERVE FAILED: the deliberately broken guard and the '
      'real guard behave identically on (null, null) (both %). Either the real guard has '
      'regressed to the null-permissive shape, or this test can no longer detect it.',
      coalesce(v_ok::text, 'null');
  end if;

  if v_broken is distinct from true then
    raise exception 'NEUTRALISE-AND-OBSERVE inconclusive: the broken shape returned % on '
      '(null, null); it was expected to ADMIT (true). The demonstration of the trap is '
      'no longer valid and this test must be rewritten.', coalesce(v_broken::text, 'null');
  end if;

  raise notice 'neutralise-and-observe OK: broken shape admits NULL (%), real guard rejects it (%)',
    v_broken, v_ok;

  -- ==================================================================================
  -- 4. THE IMPORTER IS SECURITY DEFINER AND IS NOT EXECUTABLE BY public.
  -- ==================================================================================
  select p.prosecdef into v_prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm' and p.proname = 'sync_opa_property_character';
  if not coalesce(v_prosecdef, false) then
    raise exception 'plm.sync_opa_property_character is not SECURITY DEFINER';
  end if;

  if has_function_privilege('public', 'plm.sync_opa_property_character(jsonb,text,numeric)', 'execute')
  then
    raise exception 'public can EXECUTE plm.sync_opa_property_character';
  end if;
  if has_function_privilege('public', 'public.sync_opa_property_character(jsonb,text,numeric)', 'execute')
  then
    raise exception 'public can EXECUTE public.sync_opa_property_character';
  end if;
  if not has_function_privilege('service_role',
       'public.sync_opa_property_character(jsonb,text,numeric)', 'execute')
  then
    raise exception 'service_role cannot EXECUTE the public wrapper';
  end if;

  -- ==================================================================================
  -- 5. SNAPSHOT GUARDS. Each must RAISE. A guard that exists but never fires is the
  --    exact defect this file is for, so every one is exercised.
  -- ==================================================================================
  v_snapshot := jsonb_build_object(
    'captured_at', '2026-08-06',
    'source_url',  'https://example.invalid/contract-test',
    'line_of_business', 'Home',
    'rows', jsonb_build_array(
      jsonb_build_object('licensedPropertyID', 910000001, 'characterID', 910000101,
        'property', 'Fixture Property One', 'character', 'Fixture Character One',
        'brandPropertyID', 910000001, 'optionSourceID', 1007),
      jsonb_build_object('licensedPropertyID', 910000002, 'characterID', 910000102,
        'property', 'Fixture Property One', 'character', 'Fixture Character One',
        'brandPropertyID', 910000002, 'optionSourceID', 1007),
      jsonb_build_object('licensedPropertyID', -9999, 'characterID', -9998,
        'property', 'Fixture Sentinel', 'character', 'Fixture Sentinel Character',
        'brandPropertyID', -9999, 'optionSourceID', 1007)
    ));

  -- NOTE ON THE PATTERN BELOW. Every guard raises P0001. If the "was ACCEPTED" failure
  -- were also raised INSIDE the begin block, its own P0001 would be caught by the very
  -- handler meant to absorb the guard, and the test would pass no matter what. That is
  -- precisely the false-safety-signal defect this suite exists to prevent. So each case
  -- sets a flag inside the block and asserts OUTSIDE it.

  -- 5a. mode
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(v_snapshot, 'promote_approved');
  exception when others then v_caught := true;
  end;
  if not v_caught then
    raise exception 'mode promote_approved was ACCEPTED; only mirror_only exists';
  end if;

  -- 5b. snapshot not an object
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character('[]'::jsonb);
  exception when others then v_caught := true;
  end;
  if not v_caught then raise exception 'a JSON array snapshot was ACCEPTED'; end if;

  -- 5c. rows missing / not an array
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(
      jsonb_build_object('captured_at','2026-08-06','source_url','u','rows','nope'));
  exception when others then v_caught := true;
  end;
  if not v_caught then raise exception 'a non-array rows was ACCEPTED'; end if;

  -- 5d. empty rows -- a failed extract must not look like a successful one
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(
      jsonb_build_object('captured_at','2026-08-06',
        'source_url','https://example.invalid/x','rows', '[]'::jsonb));
  exception when others then v_caught := true;
  end;
  if not v_caught then raise exception 'an EMPTY snapshot was ACCEPTED'; end if;

  -- 5e. captured_at missing -- must never fall back to now()
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(v_snapshot - 'captured_at');
  exception when others then v_caught := true;
  end;
  if not v_caught then
    raise exception 'a snapshot with no captured_at was ACCEPTED; it must never be '
      'derived from a clock';
  end if;

  -- 5f. source_url blank
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(
      jsonb_set(v_snapshot, '{source_url}', '"   "'::jsonb));
  exception when others then v_caught := true;
  end;
  if not v_caught then raise exception 'a blank source_url was ACCEPTED'; end if;

  -- 5g. wrong line of business
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(
      jsonb_set(v_snapshot, '{line_of_business}', '"Apparel"'::jsonb));
  exception when others then v_caught := true;
  end;
  if not v_caught then
    raise exception 'line_of_business Apparel was ACCEPTED; this landing is Home-scoped';
  end if;

  -- 5h. optionSourceID pin
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(
      jsonb_set(v_snapshot, '{rows,0,optionSourceID}', '1008'::jsonb));
  exception when others then v_caught := true;
  end;
  if not v_caught then
    raise exception 'optionSourceID 1008 was ACCEPTED; the pin does not fire';
  end if;

  -- 5i. blank character name
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(
      jsonb_set(v_snapshot, '{rows,0,character}', '"  "'::jsonb));
  exception when others then v_caught := true;
  end;
  if not v_caught then raise exception 'a blank character name was ACCEPTED'; end if;

  -- 5j. duplicate ID pair inside one snapshot. BOTH key parts must be made to collide;
  --     changing only one produces a different, legal pair.
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(
      jsonb_set(
        jsonb_set(v_snapshot, '{rows,1,licensedPropertyID}', '910000001'::jsonb),
        '{rows,1,characterID}', '910000101'::jsonb));
  exception when others then v_caught := true;
  end;
  if not v_caught then
    raise exception 'a duplicate (licensedPropertyID, characterID) pair was ACCEPTED';
  end if;

  -- 5k. THE SHRINK BAND MUST REJECT A NULL FRACTION (migration 20260807190000).
  --     The old form was `greatest(0, least(1, p_max_shrink_fraction))`. Postgres
  --     LEAST/GREATEST IGNORE NULL, so a NULL collapsed it to 1, the threshold became
  --     rows_held * 0, and `rows_seen < 0` could never fire — the truncated-extract
  --     guard was SILENTLY DISABLED while still reading as a bounded clamp.
  --     NOTE FOR ANYONE "FIXING" A SIMILAR CLAMP: wrapping coalesce() around the
  --     OUTSIDE of greatest(...) does NOT help — it returns 1, not NULL, so the guard
  --     stays off while looking corrected. Validate the PARAMETER, as the code does.
  --     A NULL usually means the caller sent NaN (JSON serialises NaN as null).
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(v_snapshot, 'mirror_only', null::numeric);
  exception when others then v_caught := true;
  end;
  if not v_caught then
    raise exception 'a NULL p_max_shrink_fraction was ACCEPTED. LEAST/GREATEST ignore '
      'NULL, so this silently disables the truncated-extract guard: a one-row extract '
      'could overwrite the whole mirror without complaint.';
  end if;

  -- 5l. …and an out-of-range fraction.
  for v_count in 1..2 loop
    v_caught := false;
    begin
      perform * from plm.sync_opa_property_character(
        v_snapshot, 'mirror_only', case when v_count = 1 then -0.5 else 2.0 end::numeric);
    exception when others then v_caught := true;
    end;
    if not v_caught then
      raise exception 'an out-of-range p_max_shrink_fraction (case %) was ACCEPTED', v_count;
    end if;
  end loop;

  -- 5m. THE ROW-SHAPE GUARD MUST NOT ECHO ROW CONTENT (migration 20260807190000).
  --     It previously embedded the first offending row's full JSON, which reaches
  --     terminals, CI logs and the runner. The extract is confidential Disney data and
  --     this repository is PUBLIC, so a diagnostic that quotes a row is a leak.
  --     It must report the row ORDINAL and WHICH CHECK FAILED, and nothing else.
  v_status := null;
  begin
    perform * from plm.sync_opa_property_character(
      jsonb_set(
        jsonb_set(v_snapshot, '{rows,1,character}', '"Leak Canary Character Name"'::jsonb),
        '{rows,1,optionSourceID}', '1008'::jsonb));
    raise exception 'the malformed-row guard did not fire at all';
  exception when others then v_status := sqlerrm;
  end;

  if v_status like '%Leak Canary Character Name%' then
    raise exception 'THE GUARD LEAKS ROW CONTENT: its error message quoted the offending '
      'character name. It must report the row ordinal and the failed check only. '
      'Message was: %', left(v_status, 200);
  end if;
  if v_status not like '%row 2%' then
    raise exception 'the guard did not report the 1-based row ordinal (expected "row 2"). '
      'Without it an operator cannot find the bad row without the content. Message: %',
      left(v_status, 300);
  end if;
  if v_status not like '%optionSourceID is not 1007%' then
    raise exception 'the guard did not report WHICH check failed. Message: %',
      left(v_status, 300);
  end if;

  -- ==================================================================================
  -- 6. THE HAPPY PATH. Counts must be honest.
  -- ==================================================================================
  select count(*) into v_core_before from core.property_character;

  select * into v_r from plm.sync_opa_property_character(v_snapshot);

  if v_r.rows_seen <> 3 or v_r.rows_inserted <> 3
     or v_r.rows_updated <> 0 or v_r.rows_unchanged <> 0 then
    raise exception 'first import reported seen=% ins=% upd=% unch=% (expected 3/3/0/0)',
      v_r.rows_seen, v_r.rows_inserted, v_r.rows_updated, v_r.rows_unchanged;
  end if;
  if v_r.captured_at <> date '2026-08-06' then
    raise exception 'captured_at came back as % (expected 2026-08-06)', v_r.captured_at;
  end if;
  if v_r.distinct_property <> 3 or v_r.distinct_character <> 3 then
    raise exception 'distinct counts wrong: property=% character=%',
      v_r.distinct_property, v_r.distinct_character;
  end if;

  -- 6a. THE ID-PAIR KEY. Two rows share one display-name pair; BOTH entity identities
  -- and BOTH links must be present. Names live on the normalized entity tables now.
  select count(*) into v_count
  from plm.opa_property p
  join plm.opa_property_character l using (licensed_property_id)
  join plm.opa_character c using (character_id)
  where p.property_name = 'Fixture Property One'
    and c.character_name = 'Fixture Character One';
  if v_count <> 2 then
    raise exception 'ID-pair key regression: expected 2 rows sharing a name pair under '
      'different IDs, got %. Keying on names drops 22 rows of the real extract.', v_count;
  end if;

  -- 6b. Negative sentinels survived the loader, not just the table.
  if not exists (select 1 from plm.opa_property_character
                 where licensed_property_id = -9999 and character_id = -9998) then
    raise exception 'the negative sentinel row did not land through the importer';
  end if;

  -- 6c. The importer resolves NOTHING. Resolution now belongs on the entities.
  select count(*) into v_count
  from plm.opa_property
  where licensed_property_id in (910000001, 910000002, -9999)
    and (resolution_status <> 'unresolved' or core_property_id is not null
         or resolved_at is not null or resolved_by is not null
         or resolution_reason is not null);
  if v_count <> 0 then
    raise exception 'the importer set a resolution column on % row(s). Resolution is an '
      'OPEN OWNER GATE and has no code path.', v_count;
  end if;

  -- 6d. RE-ENTRANCY WITHIN ONE TRANSACTION (regression guard for the defect fixed by
  --     migration 20260807180000). The staging table is created ON COMMIT DROP, which
  --     fires only at COMMIT -- so before the fix a SECOND call in the SAME transaction
  --     raised 42P07 'relation "_opa_incoming" already exists'. Section 7 below depends
  --     on this working; asserted explicitly here so a regression names itself instead
  --     of surfacing as a confusing failure three assertions later.
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(v_snapshot);
  exception when others then
    v_caught := true;
    v_status := sqlerrm;
  end;
  if v_caught then
    raise exception 'NOT RE-ENTRANT: a second call to plm.sync_opa_property_character in '
      'the same transaction failed with: %. Migration 20260807180000 adds the required '
      '"drop table if exists _opa_incoming" before the staging create; it appears to be '
      'missing or reverted.', v_status;
  end if;

  -- ==================================================================================
  -- 7. IDEMPOTENCE, and a human resolution must SURVIVE a re-import.
  -- ==================================================================================
  insert into core.licensor (name, code) values ('Contract Test Licensor OPA2', 'ZZTESTOPA2')
    returning id into v_lic;
  insert into core.property (licensor_id, name, code)
    values (v_lic, 'Contract Test Property OPA2', 'ZZTESTPROPOPA2') returning id into v_prop;

  update plm.opa_property
     set core_property_id = v_prop,
         resolution_status = 'resolved',
         resolution_reason = 'contract test manual resolution',
         resolved_at = timestamptz '2026-08-06 12:00:00+00',
         resolved_by = 'contract-test'
   where licensed_property_id = 910000001;

  select * into v_r from plm.sync_opa_property_character(v_snapshot);

  if v_r.rows_inserted <> 0 or v_r.rows_unchanged <> 3 then
    raise exception 'second identical import was not idempotent: ins=% unch=%',
      v_r.rows_inserted, v_r.rows_unchanged;
  end if;

  select resolution_status, core_property_id into v_status, v_propid
  from plm.opa_property where licensed_property_id = 910000001;

  if v_status is distinct from 'resolved' or v_propid is distinct from v_prop then
    raise exception 'a re-import WIPED a human resolution (status=%, core_property_id=%). The '
      'resolution columns must be absent from the upsert SET list.', v_status, v_propid;
  end if;

  -- ==================================================================================
  -- 8. ABSENCE NEVER REMOVES. A snapshot missing a held row must LEAVE IT and only
  --    report it. Deletion propagation is an open owner gate.
  -- ==================================================================================
  select * into v_r from plm.sync_opa_property_character(
    jsonb_set(v_snapshot, '{rows}',
      (v_snapshot -> 'rows') - 2),        -- drop the sentinel row from the snapshot
    'mirror_only',
    1.0);                                  -- widen the shrink band deliberately

  if v_r.rows_seen <> 2 then
    raise exception 'reduced snapshot reported rows_seen=% (expected 2)', v_r.rows_seen;
  end if;
  if v_r.rows_missing < 1 then
    raise exception 'a held row absent from the snapshot was not REPORTED as missing '
      '(rows_missing=%)', v_r.rows_missing;
  end if;
  if not exists (select 1 from plm.opa_property_character
                 where licensed_property_id = -9999 and character_id = -9998) then
    raise exception 'ABSENCE REMOVED A ROW. The importer must never delete; absence is '
      'reported only. Owner ruling 2026-08-07.';
  end if;

  -- ==================================================================================
  -- 9. THE SHRINK BAND fires when not deliberately widened.
  -- ==================================================================================
  v_caught := false;
  begin
    perform * from plm.sync_opa_property_character(
      jsonb_set(v_snapshot, '{rows}',
        jsonb_build_array(v_snapshot -> 'rows' -> 0)),
      'mirror_only',
      0.10);
  exception when others then v_caught := true;
  end;
  if not v_caught then
    raise exception 'a snapshot losing two thirds of the held rows was ACCEPTED inside a '
      '10%% shrink band; a truncated extract would land silently';
  end if;

  -- ==================================================================================
  -- 10. THE IMPORTER WROTE NOTHING INTO core.*
  -- ==================================================================================
  select count(*) into v_core_after from core.property_character;
  if v_core_after <> v_core_before then
    raise exception 'the importer wrote % row(s) into core.property_character; it may write '
      'ONLY the normalized plm.opa_* landing tables', v_core_after - v_core_before;
  end if;

  if exists (select 1 from core.character where name like 'Fixture %') then
    raise exception 'the importer populated core.character. It must not.';
  end if;

  raise notice 'OPA importer contracts passed.';
end $$;

rollback;
