-- ColdLion licensor/property circuit breaker — AUTO-TRIP, gap closure, and anti-disarm.
--
-- WHY THIS EXISTS (the mistake it corrects)
-- -----------------------------------------
-- 20260727221500 built a breaker that refuses ColdLion canonical writes while
-- tripped, and that part works. But NOTHING TRIPPED IT. Every trip in the repo
-- was a human calling plm.trip_taxonomy_circuit_breaker() by hand — including
-- the 2026-07-27 drill, which tripped the breaker first and only then watched a
-- promotion fail. The session reported this as "blocks unsafe changes in
-- milliseconds whether or not a human hears about it". That was wrong: in steady
-- state the lane was OPEN, and the protection depended on somebody noticing and
-- throwing a switch. A GLM second-opinion review caught it on 2026-07-28.
--
-- The real exposure window was:
--     time to next detection run  +  alert latency  +  a human running the trip
-- Making alerts faster only shrank the middle term. This migration removes the
-- human from the critical path entirely.
--
-- WHAT THIS ADDS
--   1. AUTO-TRIP. Both Phase 6 detection paths already write a CRITICAL row to
--      plm.taxonomy_sync_alert on failure (the daily comparison at
--      20260726180000 line ~719, the health check at line ~1019). One AFTER
--      INSERT trigger on that table therefore catches both, plus any future
--      detector that follows the same convention. No 400-line applied function
--      is rewritten.
--   2. GAP CLOSURE. The original guards covered INSERT/UPDATE on ColdLion source
--      refs and UPDATE on the mirror link columns. They did NOT cover DELETE of a
--      ColdLion source ref, or INSERT of a mirror row that already carries a
--      canonical link. Both are now refused while tripped.
--   3. ANTI-DISARM. plm.taxonomy_circuit_breaker is granted to service_role, so
--      a direct `update ... set state='closed'` bypassed the reset authorization
--      entirely. Closing now requires going through
--      plm.reset_taxonomy_circuit_breaker(), which demands a named authorizer, a
--      green readiness evaluation, and evidence.
--   4. WATCHDOG. plm.taxonomy_breaker_enforcement_status() reports whether every
--      expected trigger still exists and is enabled, so a dropped or disabled
--      trigger blocks readiness instead of silently removing protection.
--
-- DRILLS STILL TRIP. A forced-failure drill writes a critical alert with
-- is_drill=true, so it now trips the breaker too — flagged as a drill. That is
-- deliberate: a drill that does not exercise the real consequence proves nothing,
-- and the authorized reset is exactly the rehearsed recovery path.

-- =====================================================================================
-- 1. AUTO-TRIP on any critical non-breaker alert
-- =====================================================================================

create or replace function plm.autotrip_taxonomy_breaker_on_critical_alert()
returns trigger
language plpgsql
security definer
set search_path = plm, public
as $$
begin
  -- Only critical alerts arm the breaker.
  if new.severity is distinct from 'critical' then
    return null;
  end if;

  -- The breaker's OWN alert must never re-enter this path, or trip -> alert ->
  -- trip recurses forever. Belt and braces: name check AND trigger depth.
  if new.source_name = 'coldlion_licensor_property_circuit_breaker' then
    return null;
  end if;
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- Already tripped: leave the ORIGINAL trip reason in place. The first failure
  -- is the one worth reading; later ones must not overwrite it.
  if plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property') then
    insert into plm.taxonomy_circuit_breaker_event (
      lane, event, reason, failed_invariant, alert_id, actor, is_drill, payload)
    values (
      'coldlion_licensor_property', 'blocked_attempt',
      'additional critical alert while already tripped: ' || left(new.reason, 500),
      'circuit_breaker_already_open', new.id, session_user,
      coalesce(new.is_drill, false),
      jsonb_build_object('alert_source', new.source_name));
    return null;
  end if;

  perform plm.trip_taxonomy_circuit_breaker(
    'AUTO-TRIP on critical alert from ' || new.source_name || ': ' || left(new.reason, 1000),
    coalesce(nullif(new.payload->>'failed_invariant', ''), new.source_name),
    'coldlion_licensor_property',
    new.related_run_id,
    'auto (alert ' || new.id::text || ')',
    'auto-trip',
    coalesce(new.is_drill, false),
    jsonb_build_object(
      'triggering_alert_id', new.id,
      'alert_source_name', new.source_name,
      'observation_id', new.observation_id,
      'auto_trip', true));

  return null;
end;
$$;

comment on function plm.autotrip_taxonomy_breaker_on_critical_alert() is
  'Removes the human from the critical path: any CRITICAL alert (comparison failure, health failure, or a future detector following the same convention) trips the ColdLion breaker immediately, in the same transaction that recorded the failure. Skips the breaker''s own alert to avoid recursion, and never overwrites the first trip reason.';

drop trigger if exists coldlion_autotrip_on_critical_alert on plm.taxonomy_sync_alert;
create trigger coldlion_autotrip_on_critical_alert
  after insert on plm.taxonomy_sync_alert
  for each row
  execute function plm.autotrip_taxonomy_breaker_on_critical_alert();

-- Defence in depth: a failed non-drill observation trips even if the alert write
-- were ever skipped (record_taxonomy_parallel_observation accepts a skip_alert
-- option, and a future caller could pass it).
create or replace function plm.autotrip_taxonomy_breaker_on_failed_observation()
returns trigger
language plpgsql
security definer
set search_path = plm, public
as $$
begin
  if new.pass is not false then
    return null;
  end if;
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property') then
    return null;
  end if;

  perform plm.trip_taxonomy_circuit_breaker(
    'AUTO-TRIP on failed parallel-run observation ' || new.id::text
      || ' (' || coalesce(new.unexplained_diff_count, 0)::text || ' unexplained difference(s))',
    'parallel_run_observation_failed',
    'coldlion_licensor_property',
    new.comparison_run_id,
    'auto (observation ' || new.id::text || ')',
    'auto-trip',
    coalesce(new.is_drill, false),
    jsonb_build_object('observation_id', new.id, 'auto_trip', true));

  return null;
end;
$$;

drop trigger if exists coldlion_autotrip_on_failed_observation on plm.taxonomy_parallel_observation;
create trigger coldlion_autotrip_on_failed_observation
  after insert on plm.taxonomy_parallel_observation
  for each row
  execute function plm.autotrip_taxonomy_breaker_on_failed_observation();

-- =====================================================================================
-- 2. Gap closure — DELETE of a ColdLion source ref, INSERT of a linked mirror row
-- =====================================================================================

create or replace function plm.guard_coldlion_source_ref_delete_breaker()
returns trigger
language plpgsql
security definer
set search_path = plm, core, public
as $$
begin
  if old.source_system = 'coldlion'
     and plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property')
  then
    raise exception
      'ColdLion taxonomy circuit breaker is TRIPPED: refusing DELETE of core.taxonomy_source_ref for source_id % — approved links are protected evidence; reset requires a named authorization and a green readiness evaluation',
      old.source_id
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists coldlion_source_ref_delete_breaker_guard on core.taxonomy_source_ref;
create trigger coldlion_source_ref_delete_breaker_guard
  before delete on core.taxonomy_source_ref
  for each row
  execute function plm.guard_coldlion_source_ref_delete_breaker();

-- The original mirror guard reads OLD, so it cannot serve INSERT. A separate
-- guard refuses a NEW mirror row that arrives already carrying a canonical link.
create or replace function plm.guard_coldlion_mirror_link_insert_breaker()
returns trigger
language plpgsql
security definer
set search_path = plm, core, public
as $$
declare
  v_new uuid;
  v_col text;
begin
  if tg_table_name = 'erp_licensor' then
    v_col := 'licensor_id';
    v_new := (to_jsonb(new)->>'licensor_id')::uuid;
  else
    v_col := 'property_id';
    v_new := (to_jsonb(new)->>'property_id')::uuid;
  end if;

  if v_new is not null
     and plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property')
  then
    raise exception
      'ColdLion taxonomy circuit breaker is TRIPPED: refusing INSERT of plm.% carrying %=% — reset requires a named authorization and a green readiness evaluation',
      tg_table_name, v_col, v_new
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists coldlion_erp_licensor_insert_breaker_guard on plm.erp_licensor;
create trigger coldlion_erp_licensor_insert_breaker_guard
  before insert on plm.erp_licensor
  for each row
  execute function plm.guard_coldlion_mirror_link_insert_breaker();

drop trigger if exists coldlion_erp_property_insert_breaker_guard on plm.erp_property;
create trigger coldlion_erp_property_insert_breaker_guard
  before insert on plm.erp_property
  for each row
  execute function plm.guard_coldlion_mirror_link_insert_breaker();

-- =====================================================================================
-- 3. Anti-disarm — closing the breaker requires the reset function
-- =====================================================================================
--
-- service_role holds `grant all` on plm.taxonomy_circuit_breaker, so a direct
-- `update ... set state='closed'` previously bypassed every authorization check
-- in plm.reset_taxonomy_circuit_breaker(). The reset function now sets a
-- transaction-local flag; a direct close without that flag is refused.

create or replace function plm.guard_taxonomy_circuit_breaker_state()
returns trigger
language plpgsql
security definer
set search_path = plm, public
as $$
begin
  if old.state = 'tripped' and new.state = 'closed'
     and coalesce(current_setting('plm.breaker_reset_authorized', true), '') <> 'on'
  then
    raise exception
      'refusing to close the ColdLion taxonomy circuit breaker by direct UPDATE: use plm.reset_taxonomy_circuit_breaker(authorization) — it requires a named authorizer, readiness_pass=true, and readiness_evidence'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists coldlion_breaker_state_guard on plm.taxonomy_circuit_breaker;
create trigger coldlion_breaker_state_guard
  before update on plm.taxonomy_circuit_breaker
  for each row
  execute function plm.guard_taxonomy_circuit_breaker_state();

-- Reset function reissued so it sets the transaction-local authorization flag.
-- Body is otherwise identical to 20260727221500.
create or replace function plm.reset_taxonomy_circuit_breaker(
  p_authorization jsonb,
  p_lane text default 'coldlion_licensor_property'
)
returns jsonb
language plpgsql
security definer
set search_path = plm, public
as $$
declare
  v_lane text := coalesce(nullif(btrim(p_lane), ''), 'coldlion_licensor_property');
  v_by text := nullif(btrim(coalesce(p_authorization->>'authorized_by', '')), '');
  v_evidence text := nullif(btrim(coalesce(p_authorization->>'readiness_evidence', '')), '');
  v_pass boolean;
begin
  if p_authorization is null or jsonb_typeof(p_authorization) <> 'object' then
    raise exception 'circuit-breaker reset requires an explicit authorization object'
      using errcode = 'P0001';
  end if;

  begin
    v_pass := (p_authorization->>'readiness_pass')::boolean;
  exception when others then
    v_pass := null;
  end;

  if v_by is null then
    raise exception 'circuit-breaker reset requires authorization.authorized_by (a named human)'
      using errcode = 'P0001';
  end if;
  if v_pass is distinct from true then
    raise exception 'circuit-breaker reset requires authorization.readiness_pass = true (a green readiness evaluation on preview)'
      using errcode = 'P0001';
  end if;
  if v_evidence is null then
    raise exception 'circuit-breaker reset requires authorization.readiness_evidence (the exact evaluation run/report reference)'
      using errcode = 'P0001';
  end if;

  -- Transaction-local: the state guard accepts this close, and the flag dies with
  -- the transaction so it can never leave a standing bypass behind.
  perform set_config('plm.breaker_reset_authorized', 'on', true);

  update plm.taxonomy_circuit_breaker
     set state = 'closed',
         reset_at = now(),
         reset_by = v_by,
         reset_authorization = p_authorization,
         updated_at = now()
   where lane = v_lane;

  if not found then
    perform set_config('plm.breaker_reset_authorized', 'off', true);
    raise exception 'circuit-breaker lane % does not exist', v_lane using errcode = 'P0001';
  end if;

  perform set_config('plm.breaker_reset_authorized', 'off', true);

  insert into plm.taxonomy_circuit_breaker_event (lane, event, reason, actor, payload)
  values (v_lane, 'reset',
          'authorized re-enable after a green readiness evaluation',
          v_by, p_authorization);

  return jsonb_build_object('lane', v_lane, 'state', 'closed', 'reset_by', v_by);
end;
$$;

-- =====================================================================================
-- 4. Watchdog — is the enforcement actually still installed?
-- =====================================================================================
--
-- A dropped or disabled trigger removes protection with no error and no alarm.
-- Readiness must be able to see that, so it can block instead of reporting green
-- on a database that is no longer guarded.

create or replace function plm.taxonomy_breaker_enforcement_status()
returns jsonb
language sql
stable
security definer
set search_path = plm, core, public
as $$
  with expected(trigger_name, table_ident) as (values
    ('coldlion_source_ref_breaker_guard', 'core.taxonomy_source_ref'),
    ('coldlion_source_ref_delete_breaker_guard', 'core.taxonomy_source_ref'),
    ('coldlion_erp_licensor_breaker_guard', 'plm.erp_licensor'),
    ('coldlion_erp_property_breaker_guard', 'plm.erp_property'),
    ('coldlion_erp_licensor_insert_breaker_guard', 'plm.erp_licensor'),
    ('coldlion_erp_property_insert_breaker_guard', 'plm.erp_property'),
    ('coldlion_autotrip_on_critical_alert', 'plm.taxonomy_sync_alert'),
    ('coldlion_autotrip_on_failed_observation', 'plm.taxonomy_parallel_observation'),
    ('coldlion_breaker_state_guard', 'plm.taxonomy_circuit_breaker')
  ),
  actual as (
    select e.trigger_name, e.table_ident,
           t.tgname is not null as installed,
           coalesce(t.tgenabled, 'D') <> 'D' as enabled
    from expected e
    left join pg_trigger t
      on t.tgname = e.trigger_name
     and t.tgrelid = e.table_ident::regclass
     and not t.tgisinternal
  )
  select jsonb_build_object(
    'expected_count', (select count(*) from expected),
    'installed_count', (select count(*) from actual where installed),
    'enabled_count', (select count(*) from actual where installed and enabled),
    'all_enforced', (select bool_and(installed and enabled) from actual),
    'missing_or_disabled', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trigger', trigger_name, 'table', table_ident,
               'installed', installed, 'enabled', enabled) order by trigger_name), '[]'::jsonb)
      from actual where not (installed and enabled)));
$$;

comment on function plm.taxonomy_breaker_enforcement_status() is
  'Watchdog: confirms every ColdLion breaker trigger is still installed AND enabled. A dropped or disabled trigger silently removes protection, so readiness blocks on all_enforced = false rather than reporting green on an unguarded database.';

create or replace function public.taxonomy_breaker_enforcement_status()
returns jsonb
language sql
stable
security definer
set search_path = public, plm
as $$
  select plm.taxonomy_breaker_enforcement_status();
$$;

revoke all on function plm.taxonomy_breaker_enforcement_status() from public;
grant execute on function plm.taxonomy_breaker_enforcement_status() to service_role;
revoke all on function public.taxonomy_breaker_enforcement_status() from public;
revoke all on function public.taxonomy_breaker_enforcement_status() from anon, authenticated;
grant execute on function public.taxonomy_breaker_enforcement_status() to service_role;
