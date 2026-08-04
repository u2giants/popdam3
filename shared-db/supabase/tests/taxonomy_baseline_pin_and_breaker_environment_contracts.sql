-- Rollback-safe contract tests for
--   20260804120000_taxonomy_baseline_pins_table.sql
--   20260804120100_taxonomy_breaker_environment_and_provenance.sql
--
-- Run against preview AFTER both migrations are applied AND after the post-apply
-- steps (name the database, then activate 'phase4_preview'). Every fixture rolls
-- back.
--
-- Proves, for the baseline pins:
--   * the expected baseline is DATA, not compiled-in constants -- neither function
--     body contains the retired hash d9b07759bf80ff227e2fa9bd635d2138
--   * all twelve metrics have exactly one live pin, and the live licensor status
--     hash is the post-owner-ruling value
--   * a live observation passes with baseline_ok = true carrying the NEW hash
--   * changing a pin changes the verdict -- the gate really reads the table
--   * a forced drill STILL produces a critical alert after the fix
--
-- Proves, for the production-safety gate (AGENTS.md 6.5):
--   * with NO baseline activated, both detectors REFUSE: failed sync_run, WARNING
--     alert, no observation row, and NO breaker trip -- not a false green and not
--     a false red
--   * activation refuses a baseline declared for a different environment
--
-- Proves, for the blind-detector path:
--   * superseding a pin with no replacement leaves DURABLE evidence -- a failed
--     sync_run and a CRITICAL alert -- rather than raising out of the function and
--     rolling back every trace that it ran
--
-- Proves, for the append-only guarantee:
--   * DELETE refused, value UPDATE refused, superseded_at may be stamped once,
--     TRUNCATE refused
--   * the guard is STRUCTURAL: it fires while auth.role() is NULL, exactly the
--     state inside a migration
--
-- Proves, for the breaker environment:
--   * environment holds a deployment identifier, never a version number and never
--     a cause description; provenance lands in trip_provenance
--
-- Every negative assertion below matches the SPECIFIC error it expects. A bare
-- `exception when others` would pass on a typo or a missing table, which is not a
-- test of anything.

begin;

do $$
declare
  v_health_def text;
  v_obs_def text;
  v_live_pins integer;
  v_hash text;
  v_res jsonb;
begin
  -- ------------------------------------------------------------------
  -- 1. The baseline is no longer compiled into the functions
  -- ------------------------------------------------------------------
  v_health_def := pg_get_functiondef('plm.check_taxonomy_sync_health(interval,jsonb)'::regprocedure);
  v_obs_def := pg_get_functiondef('plm.record_taxonomy_parallel_observation(date,jsonb)'::regprocedure);

  if position('taxonomy_baseline_pin_set' in v_health_def) = 0 then
    raise exception 'FAIL: check_taxonomy_sync_health does not read plm.taxonomy_baseline_pin';
  end if;
  if position('taxonomy_baseline_pin_set' in v_obs_def) = 0 then
    raise exception 'FAIL: record_taxonomy_parallel_observation does not read plm.taxonomy_baseline_pin';
  end if;

  if position('d9b07759bf80ff227e2fa9bd635d2138' in v_health_def) > 0
     or position('d9b07759bf80ff227e2fa9bd635d2138' in v_obs_def) > 0 then
    raise exception 'FAIL: the retired licensor status hash is still hardcoded in a health/observation function';
  end if;

  -- The baseline must be resolved in the BODY, not the DECLARE block, or the
  -- blind-detector handler tested further down can never fire.
  if position('v_pins jsonb := plm.taxonomy_baseline_pin_set' in v_health_def) > 0
     or position('v_pins jsonb := plm.taxonomy_baseline_pin_set' in v_obs_def) > 0 then
    raise exception 'FAIL: the baseline is resolved in DECLARE, where no exception handler can catch it';
  end if;

  -- ------------------------------------------------------------------
  -- 2. Exactly one live pin per metric, and the live hash is the new one
  -- ------------------------------------------------------------------
  select count(*) into v_live_pins
  from plm.taxonomy_baseline_pin
  where baseline_key = 'phase4_preview' and superseded_at is null;

  if v_live_pins <> 12 then
    raise exception 'FAIL: expected 12 live pins, found %', v_live_pins;
  end if;

  select expected_text into v_hash
  from plm.taxonomy_baseline_pin
  where baseline_key = 'phase4_preview'
    and metric_key = 'licensor_status_hash'
    and superseded_at is null;

  if v_hash is distinct from '00bf7069fff79b9deab1d14dbd9112b2' then
    raise exception 'FAIL: live licensor_status_hash pin is %, expected the post-owner-ruling value',
      coalesce(v_hash, '<none>');
  end if;

  if exists (
    select 1 from plm.taxonomy_baseline_pin
    where baseline_key = 'phase4_preview'
      and (btrim(coalesce(pinned_reason, '')) = '' or btrim(coalesce(pinned_by, '')) = '')
  ) then
    raise exception 'FAIL: a baseline pin is missing pinned_by or pinned_reason';
  end if;

  -- ------------------------------------------------------------------
  -- 3. POSITIVE PATH: the observation passes with the new hash
  -- ------------------------------------------------------------------
  v_res := plm.record_taxonomy_parallel_observation(p_options => '{"skip_alert": true}'::jsonb);

  if coalesce((v_res ->> 'refused')::boolean, false) then
    raise exception 'FAIL: the detector refused -- is phase4_preview activated on this database? %', v_res;
  end if;
  if (v_res ->> 'baseline_ok')::boolean is not true then
    raise exception 'FAIL: baseline_ok is not true after the refresh: %', v_res;
  end if;
  if (v_res ->> 'licensor_status_hash') is distinct from '00bf7069fff79b9deab1d14dbd9112b2' then
    raise exception 'FAIL: observation did not carry the new licensor status hash: %',
      coalesce(v_res ->> 'licensor_status_hash', '<null>');
  end if;

  -- ------------------------------------------------------------------
  -- 4. The gate really reads the table -- change a pin, the verdict flips.
  --    Without this, a passing baseline proves nothing about where the expected
  --    value came from. Last assertion in the block on purpose: the append-only
  --    guard (correctly) refuses to let the fixture clean up after itself, so the
  --    enclosing ROLLBACK is what restores the table.
  -- ------------------------------------------------------------------
  update plm.taxonomy_baseline_pin
     set superseded_at = now()
   where baseline_key = 'phase4_preview'
     and metric_key = 'licensor_status_hash'
     and superseded_at is null;

  insert into plm.taxonomy_baseline_pin (
    baseline_key, metric_key, metric_kind, expected_text, effective_from,
    pinned_by, pinned_reason, source_migration
  ) values (
    'phase4_preview', 'licensor_status_hash', 'hash',
    '00000000000000000000000000000000', now(),
    'contract-test', 'deliberately wrong pin, rolled back', 'contract-test'
  );

  v_res := plm.record_taxonomy_parallel_observation(p_options => '{"skip_alert": true}'::jsonb);

  if (v_res ->> 'baseline_ok')::boolean is not false then
    raise exception 'FAIL: a deliberately wrong pin still reported baseline_ok -- the gate is not reading the table';
  end if;

  raise notice 'OK: baseline gate reads plm.taxonomy_baseline_pin';
end;
$$;

rollback;

-- ---------------------------------------------------------------------------------------
-- Production-safety gate (AGENTS.md 6.5): with no baseline activated, both
-- detectors must REFUSE -- durable evidence, no pass, no breaker trip.
-- ---------------------------------------------------------------------------------------

begin;

do $$
declare
  v_res jsonb;
  v_runs_before integer;
  v_runs_after integer;
  v_obs_before integer;
  v_obs_after integer;
  v_breaker_before text;
  v_breaker_after text;
  v_trips_before integer;
  v_trips_after integer;
  v_alert record;
  v_msg text;
begin
  -- Simulate a database where nobody has activated a baseline -- i.e. production
  -- on the day this migration lands.
  delete from plm.taxonomy_baseline_activation;

  select count(*) into v_obs_before from plm.taxonomy_parallel_observation;
  select count(*) into v_runs_before from ingest.sync_run
   where source_name = 'coldlion_designflow_daily_comparison';
  select state into v_breaker_before from plm.taxonomy_circuit_breaker
   where lane = 'coldlion_licensor_property';
  select count(*) into v_trips_before from plm.taxonomy_circuit_breaker_event
   where event = 'trip';

  -- --- the daily comparison refuses ---
  v_res := plm.record_taxonomy_parallel_observation();

  if coalesce((v_res ->> 'refused')::boolean, false) is not true then
    raise exception 'FAIL: with no active baseline the comparison did not refuse: %', v_res;
  end if;
  if (v_res ->> 'reason') is distinct from 'no_active_baseline' then
    raise exception 'FAIL: unexpected refusal reason %', coalesce(v_res ->> 'reason', '<null>');
  end if;
  if (v_res ->> 'pass')::boolean is not false then
    raise exception 'FAIL: a refusal reported pass -- that is a false green';
  end if;

  -- durable evidence, and NO observation row
  select count(*) into v_runs_after from ingest.sync_run
   where source_name = 'coldlion_designflow_daily_comparison';
  if v_runs_after <> v_runs_before + 1 then
    raise exception 'FAIL: the refusal left no ingest.sync_run evidence';
  end if;
  if not exists (
    select 1 from ingest.sync_run
    where id = (v_res ->> 'comparison_run_id')::uuid
      and status = 'failed'
      and (metadata ->> 'refused')::boolean
  ) then
    raise exception 'FAIL: the refusal sync_run is not a failed/refused row';
  end if;

  select count(*) into v_obs_after from plm.taxonomy_parallel_observation;
  if v_obs_after <> v_obs_before then
    raise exception 'FAIL: a refusal wrote an observation row (% -> %), which would arm the failed-observation auto-trip',
      v_obs_before, v_obs_after;
  end if;

  -- A standing WARNING must exist for this source. Note the refusal alert is
  -- deliberately deduplicated -- one standing warning, not one per run, because
  -- this is a configuration state that persists until somebody acts. So the
  -- assertion is "an unacknowledged warning exists", NOT "this call minted a new
  -- one": if a previous refusal already raised it, alert_id here is legitimately
  -- null.
  select * into v_alert
  from plm.taxonomy_sync_alert
  where source_name = 'coldlion_designflow_daily_comparison'
    and acknowledged_at is null
    and reason like 'refused: no active taxonomy baseline%'
  order by fired_at desc
  limit 1;

  if v_alert.id is null then
    raise exception 'FAIL: no standing refusal alert exists for the daily comparison -- the refusal is silent';
  end if;
  if v_alert.severity <> 'warning' then
    raise exception 'FAIL: refusal alert severity is %, expected warning (critical would auto-trip the lane for a configuration state)',
      v_alert.severity;
  end if;

  -- Whatever this particular call did, it must never have raised a CRITICAL for a
  -- configuration state -- that is the false red.
  if (v_res ->> 'alert_id') is not null and exists (
    select 1 from plm.taxonomy_sync_alert
    where id = (v_res ->> 'alert_id')::uuid and severity = 'critical'
  ) then
    raise exception 'FAIL: the refusal raised a CRITICAL alert, which auto-trips the lane';
  end if;

  select state into v_breaker_after from plm.taxonomy_circuit_breaker
   where lane = 'coldlion_licensor_property';
  select count(*) into v_trips_after from plm.taxonomy_circuit_breaker_event
   where event = 'trip';
  if v_breaker_after is distinct from v_breaker_before then
    raise exception 'FAIL: a refusal changed the breaker state % -> %', v_breaker_before, v_breaker_after;
  end if;
  if v_trips_after <> v_trips_before then
    raise exception 'FAIL: a refusal recorded % new trip event(s) -- that is a false red',
      v_trips_after - v_trips_before;
  end if;

  -- --- the health check refuses the same way ---
  v_res := plm.check_taxonomy_sync_health();
  if coalesce((v_res ->> 'refused')::boolean, false) is not true then
    raise exception 'FAIL: with no active baseline the health check did not refuse: %', v_res;
  end if;
  if (v_res ->> 'ok')::boolean is not false then
    raise exception 'FAIL: a refusing health check reported ok';
  end if;

  -- --- activation cannot borrow another environment's baseline ---
  begin
    perform plm.activate_taxonomy_baseline(
      'phase4_preview', 'production qsllyeztdwjgirsysgai',
      'contract-test', 'must be refused');
    raise exception 'FAIL: activation accepted a baseline declared for another environment';
  exception when sqlstate 'P0001' then
    v_msg := sqlerrm;
    if position('refusing to activate' in v_msg) = 0 then
      raise exception 'FAIL: wrong error from cross-environment activation: %', v_msg;
    end if;
  end;

  raise notice 'OK: no active baseline => refuse, with evidence, no trip';
end;
$$;

rollback;

-- ---------------------------------------------------------------------------------------
-- Blind detector: a pin superseded with no replacement must leave durable evidence.
-- ---------------------------------------------------------------------------------------

begin;

do $$
declare
  v_res jsonb;
  v_alert record;
  v_runs_before integer;
  v_runs_after integer;
begin
  update plm.taxonomy_baseline_pin
     set superseded_at = now()
   where baseline_key = 'phase4_preview'
     and metric_key = 'licensor_status_hash'
     and superseded_at is null;

  select count(*) into v_runs_before from ingest.sync_run
   where source_name = 'coldlion_designflow_sync_health';

  v_res := plm.check_taxonomy_sync_health();

  if coalesce((v_res ->> 'baseline_unreadable')::boolean, false) is not true then
    raise exception 'FAIL: an incomplete baseline did not report baseline_unreadable: %', v_res;
  end if;
  if (v_res ->> 'ok')::boolean is not false then
    raise exception 'FAIL: a blind health check reported ok';
  end if;

  select count(*) into v_runs_after from ingest.sync_run
   where source_name = 'coldlion_designflow_sync_health';
  if v_runs_after <> v_runs_before + 1 then
    raise exception 'FAIL: the blind path left no ingest.sync_run evidence -- the raise escaped and rolled it back';
  end if;

  select * into v_alert from plm.taxonomy_sync_alert where id = (v_res ->> 'alert_id')::uuid;
  if v_alert.id is null then
    raise exception 'FAIL: a blind detector produced no alert';
  end if;
  if v_alert.severity <> 'critical' then
    raise exception 'FAIL: blind-detector alert severity is %, expected critical (a blind detector must fail CLOSED)',
      v_alert.severity;
  end if;
  if position('unreadable' in v_alert.reason) = 0 then
    raise exception 'FAIL: blind-detector alert does not say what went wrong: %', v_alert.reason;
  end if;

  -- The daily comparison must behave identically, and must not write an
  -- observation row it cannot evaluate.
  v_res := plm.record_taxonomy_parallel_observation();
  if coalesce((v_res ->> 'baseline_unreadable')::boolean, false) is not true then
    raise exception 'FAIL: the daily comparison did not report baseline_unreadable: %', v_res;
  end if;
  if v_res ? 'observation_id' then
    raise exception 'FAIL: the blind daily comparison still wrote an observation row';
  end if;

  raise notice 'OK: blind detector fails closed and leaves durable evidence';
end;
$$;

rollback;

-- ---------------------------------------------------------------------------------------
-- Append-only guarantees.
-- ---------------------------------------------------------------------------------------

begin;

do $$
declare
  v_msg text;
begin
  -- The guard is STRUCTURAL, not role-based. auth.role() is NULL here -- the exact
  -- condition under which `if not (... or auth.role() = 'service_role')` would
  -- never fire. These must still be refused.
  if auth.role() is not null then
    raise exception 'FAIL: this test is only meaningful with auth.role() NULL, got %', auth.role();
  end if;

  begin
    delete from plm.taxonomy_baseline_pin
     where baseline_key = 'phase4_preview' and metric_key = 'licensor_status_hash';
    raise exception 'FAIL: DELETE of a baseline pin was allowed';
  exception when sqlstate 'P0001' then
    v_msg := sqlerrm;
    if position('refusing DELETE' in v_msg) = 0 then
      raise exception 'FAIL: DELETE was refused, but for the wrong reason: %', v_msg;
    end if;
  end;

  begin
    update plm.taxonomy_baseline_pin
       set expected_text = 'deadbeefdeadbeefdeadbeefdeadbeef'
     where baseline_key = 'phase4_preview' and metric_key = 'licensor_status_hash';
    raise exception 'FAIL: in-place UPDATE of a pin value was allowed';
  exception when sqlstate 'P0001' then
    v_msg := sqlerrm;
    if position('superseded_at is the only column' in v_msg) = 0 then
      raise exception 'FAIL: UPDATE was refused, but for the wrong reason: %', v_msg;
    end if;
  end;

  -- TRUNCATE is not a DELETE: row triggers never see it, and service_role holds it.
  begin
    truncate plm.taxonomy_baseline_pin;
    raise exception 'FAIL: TRUNCATE of the pin table was allowed -- the append-only guard is bypassable';
  exception when sqlstate 'P0001' then
    v_msg := sqlerrm;
    if position('TRUNCATE is refused' in v_msg) = 0 then
      raise exception 'FAIL: TRUNCATE was refused, but for the wrong reason: %', v_msg;
    end if;
  end;

  raise notice 'OK: append-only holds against DELETE, UPDATE and TRUNCATE';
end;
$$;

rollback;

begin;

do $$
declare
  v_msg text;
begin
  -- superseded_at is the one permitted update...
  update plm.taxonomy_baseline_pin
     set superseded_at = now()
   where baseline_key = 'phase4_preview' and metric_key = 'licensor_status_hash'
     and superseded_at is null;

  -- ...and it may not be re-dated afterwards.
  begin
    update plm.taxonomy_baseline_pin
       set superseded_at = now() + interval '1 day'
     where baseline_key = 'phase4_preview' and metric_key = 'licensor_status_hash'
       and superseded_at is not null;
    raise exception 'FAIL: a retired pin was re-dated';
  exception when sqlstate 'P0001' then
    v_msg := sqlerrm;
    if position('already superseded' in v_msg) = 0 then
      raise exception 'FAIL: re-dating was refused, but for the wrong reason: %', v_msg;
    end if;
  end;

  -- An incomplete baseline RAISES from the accessor. It must never read as
  -- "nothing to compare", which would turn the gate into a no-op reporting green.
  begin
    perform plm.taxonomy_baseline_pin_set('phase4_preview');
    raise exception 'FAIL: an incomplete baseline did not raise';
  exception when sqlstate 'P0001' then
    v_msg := sqlerrm;
    if position('is incomplete' in v_msg) = 0 then
      raise exception 'FAIL: incomplete baseline raised the wrong error: %', v_msg;
    end if;
  end;

  begin
    perform plm.taxonomy_baseline_pin_set('a_baseline_that_does_not_exist');
    raise exception 'FAIL: an unknown baseline key did not raise';
  exception when sqlstate 'P0001' then
    v_msg := sqlerrm;
    if position('is incomplete' in v_msg) = 0 then
      raise exception 'FAIL: unknown baseline key raised the wrong error: %', v_msg;
    end if;
  end;

  raise notice 'OK: supersede-once, and fail-loud accessor';
end;
$$;

rollback;

-- ---------------------------------------------------------------------------------------
-- Drill still alerts; breaker environment vs provenance.
-- ---------------------------------------------------------------------------------------

begin;

do $$
declare
  v_res jsonb;
  v_alert record;
  v_trip_def text;
  v_breaker record;
  v_events integer;
begin
  -- NEGATIVE PATH: a forced drill must STILL produce a critical alert. Refreshing
  -- a baseline and muting an alarm look identical unless this passes alongside the
  -- positive path above.
  v_res := plm.check_taxonomy_sync_health(interval '36 hours', '{"force_fail": true}'::jsonb);

  if coalesce((v_res ->> 'refused')::boolean, false) then
    raise exception 'FAIL: the drill refused -- is phase4_preview activated on this database?';
  end if;
  if (v_res ->> 'ok')::boolean is not false then
    raise exception 'FAIL: a forced drill reported ok';
  end if;
  if (v_res ->> 'alert_id') is null then
    raise exception 'FAIL: a forced drill produced no alert -- the alarm is muted';
  end if;

  select * into v_alert from plm.taxonomy_sync_alert where id = (v_res ->> 'alert_id')::uuid;
  if v_alert.id is null then
    raise exception 'FAIL: the drill alert id does not resolve to a row';
  end if;
  if v_alert.severity <> 'critical' then
    raise exception 'FAIL: drill alert severity is %, expected critical', v_alert.severity;
  end if;
  if v_alert.is_drill is not true then
    raise exception 'FAIL: drill alert is not flagged is_drill';
  end if;

  -- Breaker environment vs provenance
  v_trip_def := pg_get_functiondef(
    'plm.trip_taxonomy_circuit_breaker(text,text,text,uuid,text,text,boolean,jsonb,text)'::regprocedure);

  if position('server_version_num' in v_trip_def) > 0 then
    raise exception 'FAIL: trip_taxonomy_circuit_breaker still falls back to server_version_num';
  end if;
  if position('resolve_deployment_environment' in v_trip_def) = 0 then
    raise exception 'FAIL: trip_taxonomy_circuit_breaker does not resolve a deployment environment';
  end if;

  -- The row must EXIST before anything is asserted about it, or every check below
  -- is vacuously true.
  select * into v_breaker
  from plm.taxonomy_circuit_breaker where lane = 'coldlion_licensor_property';
  if v_breaker.lane is null then
    raise exception 'FAIL: the coldlion_licensor_property breaker row is missing';
  end if;

  if coalesce(btrim(v_breaker.environment), '') = '' then
    raise exception 'FAIL: breaker environment is empty -- the database was never named';
  end if;
  if v_breaker.environment ~ '^[0-9]+$' then
    raise exception 'FAIL: breaker environment is a bare number (%), not an environment', v_breaker.environment;
  end if;
  if v_breaker.environment like 'auto (%' then
    raise exception 'FAIL: breaker environment still holds provenance (%)', v_breaker.environment;
  end if;
  if v_breaker.environment is distinct from plm.resolve_deployment_environment() then
    raise exception 'FAIL: breaker environment % does not match this database (%)',
      v_breaker.environment, plm.resolve_deployment_environment();
  end if;

  -- The auto-trip currently on the row must have kept its provenance. Asserted
  -- without a state='tripped' precondition -- that made it vacuous once the
  -- breaker is reset.
  if v_breaker.tripped_by = 'auto-trip' and coalesce(btrim(v_breaker.trip_provenance), '') = '' then
    raise exception 'FAIL: an auto-trip lost its provenance instead of moving it to trip_provenance';
  end if;

  -- Every historical auto-trip event kept its provenance too. Assert the set is
  -- non-empty first, so "none lost it" cannot be true merely because none exist.
  select count(*) into v_events
  from plm.taxonomy_circuit_breaker_event where environment like 'auto (%';
  if v_events = 0 then
    raise exception 'FAIL: expected historical auto-trip events to backfill; found none';
  end if;
  if exists (
    select 1 from plm.taxonomy_circuit_breaker_event
    where environment like 'auto (%' and trip_provenance is null
  ) then
    raise exception 'FAIL: a breaker event lost its provenance';
  end if;

  raise notice 'OK: drill still alerts; environment and provenance are separate';
end;
$$;

rollback;
