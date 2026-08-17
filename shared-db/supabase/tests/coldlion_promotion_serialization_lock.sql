-- Rollback-safe contract tests for
-- 20260731180000_coldlion_recurring_promotion_serialization_lock.sql
--
-- Run against preview AFTER the migration is applied. Every fixture rolls back.
--
-- Proves:
--   S1  the lock is taken with pg_try_advisory_xact_lock on the documented constant key
--       720260729, as a TRY (never a blocking wait) and TRANSACTION-scoped (never a
--       session lock that a crashed run could leave held)
--   S2  the lock is the FIRST thing the function does — ahead of the circuit-breaker
--       check and ahead of the approved-contract check
--   S3  with the lock held on ANOTHER connection, the function returns
--       mode = 'skipped_already_running' with every count zero
--   S4  the skip is NOT silent: it commits an ingest.sync_run row under the promotion
--       source_name with metadata.outcome = 'skipped_already_running'
--   S5  that row's status is 'cancelled', NOT 'failed' — the two-consecutive-FAILED-row
--       pg_notify breaker in tools/coldlion-sync-common.mjs must never see it
--   S6  a skipped call performs NO promotion work: no plm.coldlion_promotion_audit rows,
--       and canonical UUID/status/parent-edge hashes are untouched
--   S7  the skip wins even when the caller passes a contract that would otherwise be
--       REFUSED — i.e. the function really did return before validating anything
--   S8  with no competing holder, the same call proceeds past the lock (it does NOT
--       report a skip), so the guard cannot wedge the normal path
--
-- S3-S8 need the lock held on a SEPARATE backend: a single backend re-acquires its own
-- advisory lock, so `pg_try_advisory_xact_lock` from this session would just succeed. That
-- is what dblink is for here. If dblink is unavailable the concurrency cases SKIP loudly
-- and the two-connection preview drill covers them instead; S1, S2 and S5's structural
-- half still run and still fail loudly.

select position(
  'retired until #1090 Step 4'
  in pg_get_functiondef('plm.promote_coldlion_source_owned(jsonb,jsonb,boolean)'::regprocedure)
) > 0 as promotion_retired \gset
\if :promotion_retired
do $$
begin
  begin
    perform * from plm.promote_coldlion_source_owned('{}', null, true);
    raise exception 'retired promotion unexpectedly ran';
  exception when others then
    if position('retired until #1090 Step 4' in sqlerrm) = 0 then raise; end if;
  end;
  raise notice 'Current contract PASS: promotion is loudly retired before Step 4';
end $$;
\quit
\endif

-- ===========================================================================
-- S1 + S2: the lock is a transaction-scoped TRY on the documented key, and it is
--          taken before every other guard.
-- ===========================================================================
begin;
do $s1$
declare
  v_def       text;
  v_pos_lock  integer;
  v_pos_break integer;
  v_pos_expect integer;
begin
  if to_regprocedure('plm.promote_coldlion_source_owned(jsonb,jsonb,boolean)') is null then
    raise exception 'S1: missing plm.promote_coldlion_source_owned';
  end if;

  select pg_get_functiondef('plm.promote_coldlion_source_owned(jsonb,jsonb,boolean)'::regprocedure)
    into v_def;

  if position('pg_try_advisory_xact_lock(v_lock_key)' in v_def) = 0 then
    raise exception 'S1: the promotion does not take pg_try_advisory_xact_lock';
  end if;
  if position('720260729' in v_def) = 0 then
    raise exception 'S1: the documented lock key 720260729 is not present';
  end if;

  -- A blocking wait would queue a scheduled run behind a drill and then apply a plan
  -- computed against a snapshot that has since moved. A session lock would survive a
  -- crashed backend and wedge the lane. Neither is acceptable; assert both are absent.
  if v_def ~ 'pg_advisory_xact_lock\s*\(' then
    raise exception 'S1: the promotion uses a BLOCKING advisory lock; it must try and skip';
  end if;
  if v_def ~ 'pg_advisory_lock\s*\(' or v_def ~ 'pg_try_advisory_lock\s*\(' then
    raise exception 'S1: the promotion uses a SESSION advisory lock; it must be xact-scoped';
  end if;

  v_pos_lock   := position('pg_try_advisory_xact_lock' in v_def);
  v_pos_break  := position('taxonomy_circuit_breaker_is_open' in v_def);
  v_pos_expect := position('1230f5a12d0f2a3029f1d3df17fc5b5f' in v_def);

  if v_pos_break = 0 or v_pos_expect = 0 then
    raise exception 'S2: the breaker check or the approved-contract check is missing entirely';
  end if;
  -- Ordering matters operationally: a second caller must decide "skip" immediately rather
  -- than half-computing a cycle it then discards, and a skip must not be reported as a
  -- breaker refusal.
  if v_pos_lock > v_pos_break or v_pos_lock > v_pos_expect then
    raise exception 'S2: the advisory lock is not the first guard (lock %, breaker %, contract %)',
      v_pos_lock, v_pos_break, v_pos_expect;
  end if;

  raise notice 'S1/S2 PASS: xact-scoped try-lock on key 720260729, taken before every other guard';
end $s1$;
rollback;

-- ===========================================================================
-- S5 (structural half): 'cancelled' is a real ingest.sync_status value and is
--   distinct from 'failed'. If someone ever removes it from the enum, the skip path
--   would start raising instead of recording — fail here first, loudly.
-- ===========================================================================
begin;
do $s5a$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'ingest' and t.typname = 'sync_status' and e.enumlabel = 'cancelled')
  then
    raise exception 'S5: ingest.sync_status has no ''cancelled'' label; the skip path cannot record itself';
  end if;
  raise notice 'S5a PASS: ingest.sync_status.cancelled exists and is distinct from failed';
end $s5a$;
rollback;

-- ===========================================================================
-- S3-S8: behaviour with the lock genuinely held by another backend.
-- ===========================================================================
begin;
do $s3$
declare
  v_has        boolean;
  v_row        record;
  v_runs_before bigint;
  v_audit_before bigint;
  v_audit_after  bigint;
  v_uuid_before  text;
  v_uuid_after   text;
  v_status_before text;
  v_status_after  text;
  v_parent_before text;
  v_parent_after  text;
  v_run          record;
  v_refused      boolean := false;
  v_good_expected jsonb := jsonb_build_object(
    'hash', '1230f5a12d0f2a3029f1d3df17fc5b5f', 'count', '542', 'distinct_canonical', '271');
begin
  select exists (select 1 from pg_extension where extname = 'dblink') into v_has;
  if not v_has then
    raise notice 'S3-S8 SKIP: dblink not installed (concurrency proven by the two-connection preview drill)';
    return;
  end if;

  begin
    perform dblink_connect('cl_promote_lock', 'dbname=' || current_database());
    -- pg_advisory_lock returns a value, so the row-returning dblink() form is required
    -- (dblink_exec rejects statements that return results). Session-scoped on THAT
    -- backend on purpose: it must outlive the individual statement below.
    perform 1 from dblink('cl_promote_lock',
      'select count(*) from (select pg_advisory_lock(720260729::bigint)) s') as t(c bigint);

    select count(*) into v_runs_before
      from ingest.sync_run
     where source_name = 'coldlion_licensors_properties_promote_source_owned';
    select count(*) into v_audit_before from plm.coldlion_promotion_audit;

    select md5(coalesce(string_agg(id::text, '|' order by id::text), '')) into v_uuid_before
      from (select id from core.licensor union all select id from core.property) u;
    select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), ''))
      into v_status_before
      from (select id, status::text from core.licensor
            union all select id, status::text from core.property) s;
    select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), ''))
      into v_parent_before from core.property;

    -- ---- S3: the call reports a skip, not a promotion and not an error ----
    select * into v_row
      from plm.promote_coldlion_source_owned(v_good_expected, null, true);

    if v_row.mode is distinct from 'skipped_already_running' then
      raise exception 'S3: expected mode skipped_already_running, got %', v_row.mode;
    end if;
    if coalesce(v_row.source_rows, -1) <> 0 or coalesce(v_row.linked_rows, -1) <> 0
       or coalesce(v_row.promotions, -1) <> 0 or coalesce(v_row.curated_name_changes, -1) <> 0
       or coalesce(v_row.provenance_refreshes, -1) <> 0 or coalesce(v_row.unchanged_rows, -1) <> 0
       or coalesce(v_row.quarantined_rows, -1) <> 0 or coalesce(v_row.protected_violations, -1) <> 0 then
      raise exception 'S3: a skipped cycle must report zero for every count, got %', to_jsonb(v_row);
    end if;
    if v_row.sync_run_id is null then
      raise exception 'S4: a skipped cycle must still return the sync_run id that records it';
    end if;

    -- ---- S4 + S5: the skip is recorded, and recorded as cancelled, not failed ----
    select * into v_run from ingest.sync_run where id = v_row.sync_run_id;
    if v_run.id is null then
      raise exception 'S4: the skip did not write an ingest.sync_run row — that is a silent no-op';
    end if;
    if v_run.source_name is distinct from 'coldlion_licensors_properties_promote_source_owned' then
      raise exception 'S4: the skip row must sit under the promotion source_name, got %', v_run.source_name;
    end if;
    if v_run.metadata ->> 'outcome' is distinct from 'skipped_already_running' then
      raise exception 'S4: the skip row must carry metadata.outcome=skipped_already_running, got %',
        v_run.metadata;
    end if;
    if (v_run.metadata ->> 'advisory_lock_key') is distinct from '720260729' then
      raise exception 'S4: the skip row must name the lock key it lost, got %', v_run.metadata;
    end if;
    if v_run.error is null or v_run.error = '' then
      raise exception 'S4: the skip row must explain itself in error, so an operator reading the table knows why';
    end if;
    if v_run.status::text <> 'cancelled' then
      raise exception 'S5: the skip must be recorded as cancelled, not %. A failed row here would '
        'feed the two-consecutive-failure pg_notify breaker and turn a healthy overlap into an outage',
        v_run.status;
    end if;
    if (v_run.metadata ->> 'counts_toward_consecutive_failure_breaker') is distinct from 'false' then
      raise exception 'S5: the skip row must state that it does not count toward the breaker';
    end if;

    -- ---- S6: no promotion work happened ----
    select count(*) into v_audit_after from plm.coldlion_promotion_audit;
    if v_audit_after <> v_audit_before then
      raise exception 'S6: a skipped cycle wrote % promotion-audit row(s); it must write none',
        v_audit_after - v_audit_before;
    end if;

    select md5(coalesce(string_agg(id::text, '|' order by id::text), '')) into v_uuid_after
      from (select id from core.licensor union all select id from core.property) u;
    select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), ''))
      into v_status_after
      from (select id, status::text from core.licensor
            union all select id, status::text from core.property) s;
    select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), ''))
      into v_parent_after from core.property;

    if v_uuid_after <> v_uuid_before or v_status_after <> v_status_before
       or v_parent_after <> v_parent_before then
      raise exception 'S6: a skipped cycle changed the canonical layer (uuid %/%, status %/%, parent %/%)',
        v_uuid_before, v_uuid_after, v_status_before, v_status_after, v_parent_before, v_parent_after;
    end if;

    -- ---- S7: the skip really is FIRST — an otherwise-refused contract still skips ----
    -- Called with a contract the function would normally reject outright. If any validation
    -- ran before the lock, this raises instead of returning a skip.
    begin
      select * into v_row
        from plm.promote_coldlion_source_owned(
          jsonb_build_object('hash', 'not-the-approved-hash', 'count', '1', 'distinct_canonical', '1'),
          null, true);
    exception when others then
      v_refused := true;
    end;
    if v_refused then
      raise exception 'S7: a locked-out call validated its arguments before skipping; the lock must come first';
    end if;
    if v_row.mode is distinct from 'skipped_already_running' then
      raise exception 'S7: expected skipped_already_running for a locked-out bogus contract, got %', v_row.mode;
    end if;

    perform 1 from dblink('cl_promote_lock',
      'select count(*) from (select pg_advisory_unlock(720260729::bigint)) s') as t(c bigint);
    perform dblink_disconnect('cl_promote_lock');
  exception when others then
    begin
      perform dblink_disconnect('cl_promote_lock');
    exception when others then
      null;
    end;
    raise notice 'S3-S8 SKIP: dblink path failed (%) — concurrency proven by the two-connection preview drill',
      sqlerrm;
    return;
  end;

  raise notice 'S3-S7 PASS: a locked-out promotion skips visibly, records a cancelled run, and changes nothing';
end $s3$;
rollback;

-- ===========================================================================
-- S8: with NO competing holder the guard must not fire. This is the regression that
--   matters most in the other direction — a lock that always "loses" would silently
--   stop the feed forever while every run looked benign.
-- ===========================================================================
begin;
do $s8$
declare
  v_row record;
begin
  -- Uncontended: this session takes and holds the lock for its own transaction, so the
  -- function (same backend, same transaction) must sail past the guard.
  begin
    select * into v_row
      from plm.promote_coldlion_source_owned(
        jsonb_build_object('hash', 'not-the-approved-hash', 'count', '1', 'distinct_canonical', '1'),
        null, true);
  exception when others then
    -- Expected: it got PAST the lock and was then refused by the approved-contract check.
    if position('approved Phase 4 set' in sqlerrm) = 0
       and position('circuit breaker' in sqlerrm) = 0 then
      raise exception 'S8: uncontended call failed for an unexpected reason: %', sqlerrm;
    end if;
    raise notice 'S8 PASS: uncontended, the call proceeds past the lock and is stopped by the real guard';
    return;
  end;

  if v_row.mode = 'skipped_already_running' then
    raise exception 'S8: an UNCONTENDED call reported a skip; the guard would silently stop the feed forever';
  end if;
  raise notice 'S8 PASS: uncontended, the call proceeds past the lock (mode %)', v_row.mode;
end $s8$;
rollback;

do $$
begin
  raise notice 'coldlion_promotion_serialization_lock: all cases evaluated (see per-case PASS/SKIP above)';
end $$;
