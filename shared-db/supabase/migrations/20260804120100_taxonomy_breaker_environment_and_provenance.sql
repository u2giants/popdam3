-- ColdLion circuit breaker: `environment` becomes an actual environment identifier,
-- and trip provenance gets its own column.
--
-- WHY THIS FILE EXISTS (verified live on preview rjyboqwcdzcocqgmsyel, 2026-08-04)
-- --------------------------------------------------------------------------------
-- Two defects, both fixed forward. 20260727221500 and 20260728134500 are APPLIED
-- and are not edited.
--
-- DEFECT 1 -- the column holds the wrong kind of value.
--   plm.taxonomy_circuit_breaker.environment on the live tripped row reads:
--       'auto (alert 4f44ec88-553c-45eb-ba7e-642e83819a1e)'
--   That is provenance ("what caused this trip"), not an environment. It got there
--   because the auto-trip functions added in 20260728134500 (lines 88 and 136) call
--   plm.trip_taxonomy_circuit_breaker POSITIONALLY, and the 5th positional slot is
--   p_environment. Four of the six rows in plm.taxonomy_circuit_breaker_event carry
--   the same shape; the only two well-formed values ('preview rjyboqwcdzcocqgmsyel',
--   from the 2026-07-27 drills) were typed by a human.
--
-- DEFECT 2 -- the fallback is not an environment at all.
--   20260727221500 line 170:
--       v_env := coalesce(nullif(btrim(p_environment),''),
--                         current_setting('server_version_num', true))
--   With p_environment null that records '170006', a PostgreSQL version number.
--
-- WHAT CHANGES
--   1. trip_provenance columns on both breaker tables. Provenance moves there.
--   2. plm.deployment_environment -- a one-row configuration table naming THIS
--      database. There is genuinely no in-database identifier that distinguishes
--      preview from production (probed on 2026-08-04: no project ref in
--      pg_settings, pg_db_role_setting, pg_roles, current_database (both are
--      'postgres') or cluster_name (both 'main')). So it is configuration, seeded
--      LOUD as 'unconfigured' rather than guessed. A migration cannot know which
--      database it is being applied to, and inventing an answer here is exactly
--      how '170006' got written in the first place.
--
--      Set it per environment with ONE statement, run once after this migration:
--          update plm.deployment_environment
--             set environment_name = 'preview rjyboqwcdzcocqgmsyel',
--                 configured_by    = 'Albert Hazan (owner)',
--                 configured_at    = now(),
--                 configured_reason= 'Supabase preview project for the shared backend'
--           where singleton;
--      Production uses 'production qsllyeztdwjgirsysgai' with the same statement.
--      Until it is set, every trip records 'unconfigured (db=postgres)' -- visibly
--      wrong on sight, which is the point. It never records a version number, and
--      it never silently claims to be an environment it is not.
--   3. plm.trip_taxonomy_circuit_breaker gains p_provenance as a NINTH parameter
--      with a default, so all nine existing call sites keep working untouched. The
--      8-arg signature is dropped first so the two cannot coexist and make an
--      8-argument call ambiguous.
--   4. The two auto-trip functions are reissued to call the trip function with
--      NAMED arguments (=>). Positional calling is what put provenance in the
--      environment slot; named arguments make that class of mistake impossible.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   plm.taxonomy_circuit_breaker_event is append-only history. Its existing
--   `environment` values are NOT rewritten -- that is what was recorded, and
--   rewriting an append-only log to look tidier destroys the evidence of the
--   defect. Provenance is COPIED forward into the new trip_provenance column so
--   the correct reading is available without falsifying the original.

-- =====================================================================================
-- 1. Provenance columns
-- =====================================================================================

alter table plm.taxonomy_circuit_breaker
  add column if not exists trip_provenance text;

alter table plm.taxonomy_circuit_breaker_event
  add column if not exists trip_provenance text;

comment on column plm.taxonomy_circuit_breaker.environment is
  'WHICH DEPLOYMENT this breaker row belongs to (e.g. "preview rjyboqwcdzcocqgmsyel"). Resolved from plm.deployment_environment when the caller supplies none. Never a version number, never a cause description -- see trip_provenance for the cause.';
comment on column plm.taxonomy_circuit_breaker.trip_provenance is
  'WHAT caused this trip (e.g. "auto (alert <uuid>)", "manual drill"). Previously mis-stored in environment by the positional auto-trip calls in 20260728134500.';
comment on column plm.taxonomy_circuit_breaker_event.trip_provenance is
  'WHAT caused this event. Backfilled from environment for the historical auto-trip rows; environment itself is left exactly as recorded because this log is append-only.';

-- =====================================================================================
-- 2. Deployment identity -- configuration, seeded loud, never guessed
-- =====================================================================================

create table if not exists plm.deployment_environment (
  singleton boolean primary key default true check (singleton),
  environment_name text not null,
  configured_by text,
  configured_at timestamptz,
  configured_reason text,
  updated_at timestamptz not null default now()
);

comment on table plm.deployment_environment is
  'Single-row identity of THIS database, e.g. "preview rjyboqwcdzcocqgmsyel" or "production qsllyeztdwjgirsysgai". No in-database value distinguishes the two Supabase projects, so this is explicit configuration. Seeded as "unconfigured (db=...)" on purpose: an obviously wrong marker beats a plausible wrong guess.';

insert into plm.deployment_environment (
  singleton, environment_name, configured_reason
)
values (
  true,
  'unconfigured (db=' || current_database() || ')',
  'Seeded by 20260804120100. Replace with the real environment name -- see the UPDATE in this migration''s header.'
)
on conflict (singleton) do nothing;

grant select on plm.deployment_environment to authenticated;
grant all on plm.deployment_environment to service_role;

alter table plm.deployment_environment enable row level security;

drop policy if exists plm_deployment_environment_admin_select on plm.deployment_environment;
create policy plm_deployment_environment_admin_select
  on plm.deployment_environment
  for select
  to authenticated
  using (app.has_role('administrator'));

create or replace function plm.resolve_deployment_environment()
returns text
language sql
stable
security definer
set search_path = plm, public
as $$
  select coalesce(
    (select nullif(btrim(d.environment_name), '') from plm.deployment_environment d where d.singleton),
    'unconfigured (db=' || current_database() || ')');
$$;

comment on function plm.resolve_deployment_environment() is
  'The environment identifier for this database. Falls back to an explicit "unconfigured" marker -- never to server_version_num, which is a PostgreSQL version and not an environment (the bug in 20260727221500 line 170).';

revoke all on function plm.resolve_deployment_environment() from public;
grant execute on function plm.resolve_deployment_environment() to service_role;

create or replace function plm.deployment_environment_is_configured()
returns boolean
language sql
stable
security definer
set search_path = plm, public
as $$
  select plm.resolve_deployment_environment() not like 'unconfigured%';
$$;

comment on function plm.deployment_environment_is_configured() is
  'False while plm.deployment_environment still holds the seeded placeholder. Lets readiness surface an unnamed environment instead of quietly recording a meaningless one.';

revoke all on function plm.deployment_environment_is_configured() from public;
grant execute on function plm.deployment_environment_is_configured() to service_role;

-- =====================================================================================
-- 3. Trip function -- ninth parameter for provenance, real environment fallback
-- =====================================================================================
--
-- Grants enumerated from pg_proc.proacl BEFORE this migration, on preview:
--   plm.trip_taxonomy_circuit_breaker(...)     postgres=X/postgres ; service_role=X/postgres
--   public.trip_taxonomy_circuit_breaker(...)  postgres=X/postgres ; service_role=X/postgres
-- Both are dropped and recreated here, so both are re-granted at the bottom.

drop function if exists plm.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb);
drop function if exists public.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb);

create or replace function plm.trip_taxonomy_circuit_breaker(
  p_reason text,
  p_failed_invariant text,
  p_lane text default 'coldlion_licensor_property',
  p_related_run_id uuid default null,
  p_environment text default null,
  p_actor text default null,
  p_is_drill boolean default false,
  p_payload jsonb default '{}'::jsonb,
  p_provenance text default null
)
returns jsonb
language plpgsql
security definer
set search_path = plm, ingest, public
as $$
declare
  v_lane text := coalesce(nullif(btrim(p_lane), ''), 'coldlion_licensor_property');
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'unspecified protected-invariant failure'), 4000);
  v_invariant text := coalesce(nullif(btrim(p_failed_invariant), ''), 'unspecified');
  -- An environment identifier, or an explicit "unconfigured" marker. Never a
  -- PostgreSQL version number, and never a description of the cause.
  v_env text := coalesce(nullif(btrim(p_environment), ''), plm.resolve_deployment_environment());
  v_provenance text := nullif(btrim(coalesce(p_provenance, '')), '');
  v_actor text := coalesce(nullif(btrim(p_actor), ''), session_user);
  v_alert_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb) - 'api_key' - 'password' - 'token' - 'secret';
begin
  -- Durable alert FIRST so the alert exists even if the state write races.
  v_alert_id := plm.record_taxonomy_sync_alert(
    'critical',
    'coldlion_licensor_property_circuit_breaker',
    v_reason,
    p_related_run_id,
    null,
    (timezone('utc', now()))::date,
    coalesce(p_is_drill, false),
    v_payload
      || jsonb_build_object(
           'lane', v_lane,
           'failed_invariant', v_invariant,
           'environment', v_env,
           'trip_provenance', v_provenance,
           'environment_configured', plm.deployment_environment_is_configured(),
           'circuit_breaker', 'tripped',
           'human_response_owner', 'Albert Hazan',
           'first_response',
             'Disable the ColdLion schedule/promotion variable, leave mirrors and evidence intact, compare protected hashes, reproduce on preview, fix forward through shared-db. Do not improvise a data cleanup.')
  );

  insert into plm.taxonomy_circuit_breaker as b (
    lane, state, tripped_at, tripped_reason, tripped_by,
    failed_invariant, related_run_id, alert_id, environment, trip_provenance, updated_at
  )
  values (
    v_lane, 'tripped', now(), v_reason, v_actor,
    v_invariant, p_related_run_id, v_alert_id, v_env, v_provenance, now()
  )
  on conflict (lane) do update
    set state = 'tripped',
        tripped_at = now(),
        tripped_reason = excluded.tripped_reason,
        tripped_by = excluded.tripped_by,
        failed_invariant = excluded.failed_invariant,
        related_run_id = excluded.related_run_id,
        alert_id = excluded.alert_id,
        environment = excluded.environment,
        trip_provenance = excluded.trip_provenance,
        reset_at = null,
        reset_by = null,
        reset_authorization = null,
        updated_at = now();

  insert into plm.taxonomy_circuit_breaker_event (
    lane, event, reason, failed_invariant, related_run_id,
    alert_id, environment, trip_provenance, actor, is_drill, payload
  )
  values (
    v_lane, 'trip', v_reason, v_invariant, p_related_run_id,
    v_alert_id, v_env, v_provenance, v_actor, coalesce(p_is_drill, false), v_payload
  );

  return jsonb_build_object(
    'lane', v_lane,
    'state', 'tripped',
    'alert_id', v_alert_id,
    'failed_invariant', v_invariant,
    'reason', v_reason,
    'environment', v_env,
    'trip_provenance', v_provenance,
    'is_drill', coalesce(p_is_drill, false),
    'human_response_owner', 'Albert Hazan');
end;
$$;

comment on function plm.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb, text) is
  'Fail-closed: writes a durable critical alert naming Albert Hazan as human response owner, trips the lane, and appends an immutable trip event. environment identifies the DEPLOYMENT; p_provenance records WHAT caused the trip. Ninth parameter added 20260804120100 so provenance stops landing in the environment column.';

create or replace function public.trip_taxonomy_circuit_breaker(
  p_reason text,
  p_failed_invariant text,
  p_lane text default 'coldlion_licensor_property',
  p_related_run_id uuid default null,
  p_environment text default null,
  p_actor text default null,
  p_is_drill boolean default false,
  p_payload jsonb default '{}'::jsonb,
  p_provenance text default null
)
returns jsonb
language sql
security definer
set search_path = public, plm
as $$
  select plm.trip_taxonomy_circuit_breaker(
    p_reason, p_failed_invariant, p_lane, p_related_run_id,
    p_environment, p_actor, p_is_drill, p_payload, p_provenance);
$$;

-- =====================================================================================
-- 4. Auto-trip callers -- named arguments, provenance in the provenance slot
-- =====================================================================================
--
-- Bodies are 20260728134500 sections 1 verbatim apart from the call itself.

create or replace function plm.autotrip_taxonomy_breaker_on_critical_alert()
returns trigger
language plpgsql
security definer
set search_path = plm, public
as $$
begin
  if new.severity is distinct from 'critical' then
    return null;
  end if;

  if new.source_name = 'coldlion_licensor_property_circuit_breaker' then
    return null;
  end if;
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property') then
    insert into plm.taxonomy_circuit_breaker_event (
      lane, event, reason, failed_invariant, alert_id, environment,
      trip_provenance, actor, is_drill, payload)
    values (
      'coldlion_licensor_property', 'blocked_attempt',
      'additional critical alert while already tripped: ' || left(new.reason, 500),
      'circuit_breaker_already_open', new.id,
      plm.resolve_deployment_environment(),
      'auto (alert ' || new.id::text || ')',
      session_user,
      coalesce(new.is_drill, false),
      jsonb_build_object('alert_source', new.source_name));
    return null;
  end if;

  -- NAMED arguments. The positional form is what put 'auto (alert ...)' into the
  -- environment column: the 5th positional slot is p_environment, not provenance.
  perform plm.trip_taxonomy_circuit_breaker(
    p_reason => 'AUTO-TRIP on critical alert from ' || new.source_name || ': ' || left(new.reason, 1000),
    p_failed_invariant => coalesce(nullif(new.payload->>'failed_invariant', ''), new.source_name),
    p_lane => 'coldlion_licensor_property',
    p_related_run_id => new.related_run_id,
    p_environment => null,
    p_actor => 'auto-trip',
    p_is_drill => coalesce(new.is_drill, false),
    p_payload => jsonb_build_object(
      'triggering_alert_id', new.id,
      'alert_source_name', new.source_name,
      'observation_id', new.observation_id,
      'auto_trip', true),
    p_provenance => 'auto (alert ' || new.id::text || ')');

  return null;
end;
$$;

comment on function plm.autotrip_taxonomy_breaker_on_critical_alert() is
  'Removes the human from the critical path: any CRITICAL alert trips the ColdLion breaker in the same transaction that recorded the failure. Skips the breaker''s own alert to avoid recursion, never overwrites the first trip reason, and (since 20260804120100) records its provenance in trip_provenance instead of environment.';

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
    p_reason => 'AUTO-TRIP on failed parallel-run observation ' || new.id::text
      || ' (' || coalesce(new.unexplained_diff_count, 0)::text || ' unexplained difference(s))',
    p_failed_invariant => 'parallel_run_observation_failed',
    p_lane => 'coldlion_licensor_property',
    p_related_run_id => new.comparison_run_id,
    p_environment => null,
    p_actor => 'auto-trip',
    p_is_drill => coalesce(new.is_drill, false),
    p_payload => jsonb_build_object('observation_id', new.id, 'auto_trip', true),
    p_provenance => 'auto (observation ' || new.id::text || ')');

  return null;
end;
$$;

-- =====================================================================================
-- 5. Move the existing provenance out of environment (state row only)
-- =====================================================================================
--
-- The live tripped row carries 'auto (alert 4f44ec88-...)' in environment. The
-- string is MOVED, not discarded. The state guard from 20260728134500 only
-- refuses tripped -> closed, so this UPDATE (which changes neither state nor
-- reset_at) passes it.
--
-- environment is set to the resolved identity ONLY if this database has already
-- been named. It cannot have been, on the first apply -- the seed two sections
-- above deliberately writes a placeholder, and the real name arrives in the
-- post-apply step below. So the backfill writes NULL ("not identified") rather
-- than stamping the placeholder onto the row, because a column that has just
-- been cleaned of one wrong-kind-of-value must not be handed another. NULL is
-- filled by the post-apply statement, and by every subsequent trip.

update plm.taxonomy_circuit_breaker
   set trip_provenance = coalesce(trip_provenance, environment),
       environment = case
                       when plm.deployment_environment_is_configured()
                         then plm.resolve_deployment_environment()
                       else null
                     end,
       updated_at = now()
 where environment is not null
   and environment not like 'preview %'
   and environment not like 'production %'
   and environment not like 'unconfigured%'
   and trip_provenance is null;

-- POST-APPLY, run once per environment (both statements, in this order).
-- Preview (rjyboqwcdzcocqgmsyel) -- already run on 2026-08-04:
--
--   update plm.deployment_environment
--      set environment_name  = 'preview rjyboqwcdzcocqgmsyel',
--          configured_by     = 'Albert Hazan (owner)',
--          configured_at     = now(),
--          configured_reason = 'Supabase preview project for the shared backend',
--          updated_at        = now()
--    where singleton;
--
--   update plm.taxonomy_circuit_breaker
--      set environment = plm.resolve_deployment_environment(), updated_at = now()
--    where environment is null;
--
-- Production (qsllyeztdwjgirsysgai) uses the same two statements with
-- environment_name = 'production qsllyeztdwjgirsysgai'.

-- Append-only history: COPY provenance into the new column, leave environment
-- exactly as it was recorded.
update plm.taxonomy_circuit_breaker_event
   set trip_provenance = environment
 where trip_provenance is null
   and environment like 'auto (%';

-- =====================================================================================
-- 6. Re-assert grants dropped by the DROP/CREATE above
-- =====================================================================================

revoke all on function plm.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb, text) from public;
revoke all on function plm.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb, text) from anon, authenticated;
grant execute on function plm.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb, text) to service_role;

revoke all on function public.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb, text) from public;
revoke all on function public.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb, text) from anon, authenticated;
grant execute on function public.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb, text) to service_role;
