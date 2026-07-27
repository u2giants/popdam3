-- ColdLion Licensor/Property — deterministic mapping-identity proof + operational
-- circuit breaker (accelerated cutover plan Steps 3 and 4).
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Phase 6 already proves counts, freshness, protected hashes, and "no unexplained
-- difference". None of that proves IDENTITY: two mappings could swap canonical
-- UUIDs, one could flip entity type (licensor <-> property), one could vanish and
-- another appear, and every count and hash bucket used so far would still balance.
-- The accelerated plan therefore requires a row-by-row proof that all 542 approved
-- typed source rows still resolve to the exact approved canonical UUIDs.
--
-- It also requires a fail-closed operational circuit breaker: once any protected
-- invariant fails, the ColdLion lane must be unable to make a further canonical
-- change, even if a scheduled job tries again, and even if the caller is the
-- security-definer Phase 4 linking function.
--
-- DESIGN NOTES (read before changing anything here)
-- -------------------------------------------------
--   * The applied migration 20260726180000 is IMMUTABLE. Nothing here edits it.
--     The breaker is enforced with TRIGGERS on the tables the ColdLion lane
--     actually writes, not by rewriting the ~600-line Phase 4 linking function.
--     Trigger enforcement is strictly stronger: it holds for every caller,
--     including a future one nobody has written yet.
--   * The breaker is deliberately scoped to the ColdLion lane objects:
--       - core.taxonomy_source_ref rows with source_system = 'coldlion'
--       - plm.erp_licensor.licensor_id / plm.erp_property.property_id link changes
--     It must NEVER block DesignFlow writes, curated status edits, or Property
--     parent edits. ColdLion does not own those facts, so a tripped ColdLion
--     breaker must not take the curated path down with it.
--   * The breaker NEVER deletes data and NEVER rolls back schema. It only refuses
--     new ColdLion canonical promotion. Mirrors, raw records, observations,
--     alerts, and failed runs all remain writable so evidence keeps accruing.
--   * Every trip and every reset is appended to plm.taxonomy_circuit_breaker_event.
--     That log is append-only by design: no UPDATE/DELETE path is provided.
--   * The identity verifier is read-only (STABLE, no writes) so it can be run at
--     any time, including immediately before a production write, without side
--     effects.

-- =====================================================================================
-- 1. Circuit-breaker state + append-only event log
-- =====================================================================================

create table if not exists plm.taxonomy_circuit_breaker (
  lane text primary key,
  state text not null default 'closed'
    check (state in ('closed', 'tripped')),
  tripped_at timestamptz,
  tripped_reason text,
  tripped_by text,
  failed_invariant text,
  related_run_id uuid,
  alert_id uuid references plm.taxonomy_sync_alert(id) on delete set null,
  environment text,
  reset_at timestamptz,
  reset_by text,
  reset_authorization jsonb,
  updated_at timestamptz not null default now()
);

comment on table plm.taxonomy_circuit_breaker is
  'Operational circuit breaker for the ColdLion taxonomy lane. state=tripped refuses every further ColdLion canonical promotion (source refs + typed mirror links) until an explicitly authorized reset. Never deletes data; never touches curated status or Property parents.';

create table if not exists plm.taxonomy_circuit_breaker_event (
  id uuid primary key default gen_random_uuid(),
  lane text not null,
  event text not null check (event in ('trip', 'reset', 'blocked_attempt')),
  occurred_at timestamptz not null default now(),
  reason text,
  failed_invariant text,
  related_run_id uuid,
  alert_id uuid,
  environment text,
  actor text,
  is_drill boolean not null default false,
  payload jsonb not null default '{}'::jsonb
);

comment on table plm.taxonomy_circuit_breaker_event is
  'APPEND-ONLY circuit-breaker history: every trip, every blocked promotion attempt, and every authorized reset. Never overwritten, never pruned — a later green run must not be able to erase an earlier failure.';

create index if not exists plm_taxonomy_circuit_breaker_event_lane_idx
  on plm.taxonomy_circuit_breaker_event (lane, occurred_at desc);

insert into plm.taxonomy_circuit_breaker (lane, state)
values ('coldlion_licensor_property', 'closed')
on conflict (lane) do nothing;

alter table plm.taxonomy_circuit_breaker enable row level security;
alter table plm.taxonomy_circuit_breaker_event enable row level security;

drop policy if exists plm_taxonomy_circuit_breaker_admin_select
  on plm.taxonomy_circuit_breaker;
create policy plm_taxonomy_circuit_breaker_admin_select
  on plm.taxonomy_circuit_breaker
  for select
  to authenticated
  using (app.has_role('administrator'));

drop policy if exists plm_taxonomy_circuit_breaker_event_admin_select
  on plm.taxonomy_circuit_breaker_event;
create policy plm_taxonomy_circuit_breaker_event_admin_select
  on plm.taxonomy_circuit_breaker_event
  for select
  to authenticated
  using (app.has_role('administrator'));

grant select on plm.taxonomy_circuit_breaker, plm.taxonomy_circuit_breaker_event
  to authenticated;
grant all on plm.taxonomy_circuit_breaker, plm.taxonomy_circuit_breaker_event
  to service_role;

-- =====================================================================================
-- 2. Breaker read / trip / reset
-- =====================================================================================

create or replace function plm.taxonomy_circuit_breaker_is_open(
  p_lane text default 'coldlion_licensor_property'
)
returns boolean
language sql
stable
security definer
set search_path = plm, public
as $$
  select coalesce(
    (select b.state = 'tripped'
       from plm.taxonomy_circuit_breaker b
      where b.lane = coalesce(nullif(btrim(p_lane), ''), 'coldlion_licensor_property')),
    false);
$$;

comment on function plm.taxonomy_circuit_breaker_is_open(text) is
  'True when the named lane is tripped and ColdLion canonical promotion must be refused. Missing lane row = closed (a lane nobody configured must not silently block unrelated writes).';

create or replace function plm.taxonomy_circuit_breaker_state(
  p_lane text default 'coldlion_licensor_property'
)
returns jsonb
language sql
stable
security definer
set search_path = plm, public
as $$
  select coalesce(
    (select to_jsonb(b) from plm.taxonomy_circuit_breaker b
      where b.lane = coalesce(nullif(btrim(p_lane), ''), 'coldlion_licensor_property')),
    jsonb_build_object('lane', p_lane, 'state', 'absent'));
$$;

create or replace function plm.trip_taxonomy_circuit_breaker(
  p_reason text,
  p_failed_invariant text,
  p_lane text default 'coldlion_licensor_property',
  p_related_run_id uuid default null,
  p_environment text default null,
  p_actor text default null,
  p_is_drill boolean default false,
  p_payload jsonb default '{}'::jsonb
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
  v_env text := coalesce(nullif(btrim(p_environment), ''), current_setting('server_version_num', true));
  v_actor text := coalesce(nullif(btrim(p_actor), ''), session_user);
  v_alert_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb) - 'api_key' - 'password' - 'token' - 'secret';
begin
  -- Durable alert FIRST so the alert exists even if the state write races.
  -- The alert body names the human response owner; the monitor that pages a
  -- person reads it from here, so it must never be left implicit.
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
           'circuit_breaker', 'tripped',
           'human_response_owner', 'Albert Hazan',
           'first_response',
             'Disable the ColdLion schedule/promotion variable, leave mirrors and evidence intact, compare protected hashes, reproduce on preview, fix forward through shared-db. Do not improvise a data cleanup.')
  );

  insert into plm.taxonomy_circuit_breaker as b (
    lane, state, tripped_at, tripped_reason, tripped_by,
    failed_invariant, related_run_id, alert_id, environment, updated_at
  )
  values (
    v_lane, 'tripped', now(), v_reason, v_actor,
    v_invariant, p_related_run_id, v_alert_id, v_env, now()
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
        reset_at = null,
        reset_by = null,
        reset_authorization = null,
        updated_at = now();

  insert into plm.taxonomy_circuit_breaker_event (
    lane, event, reason, failed_invariant, related_run_id,
    alert_id, environment, actor, is_drill, payload
  )
  values (
    v_lane, 'trip', v_reason, v_invariant, p_related_run_id,
    v_alert_id, v_env, v_actor, coalesce(p_is_drill, false), v_payload
  );

  return jsonb_build_object(
    'lane', v_lane,
    'state', 'tripped',
    'alert_id', v_alert_id,
    'failed_invariant', v_invariant,
    'reason', v_reason,
    'is_drill', coalesce(p_is_drill, false),
    'human_response_owner', 'Albert Hazan');
end;
$$;

comment on function plm.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb) is
  'Fail-closed: writes a durable critical alert naming Albert Hazan as human response owner, trips the lane, and appends an immutable trip event. After this, ColdLion source refs and typed mirror links are refused by trigger until an authorized reset.';

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

  update plm.taxonomy_circuit_breaker
     set state = 'closed',
         reset_at = now(),
         reset_by = v_by,
         reset_authorization = p_authorization,
         updated_at = now()
   where lane = v_lane;

  if not found then
    raise exception 'circuit-breaker lane % does not exist', v_lane using errcode = 'P0001';
  end if;

  insert into plm.taxonomy_circuit_breaker_event (
    lane, event, reason, actor, payload
  )
  values (
    v_lane, 'reset',
    'authorized re-enable after a green readiness evaluation',
    v_by,
    p_authorization
  );

  return jsonb_build_object('lane', v_lane, 'state', 'closed', 'reset_by', v_by);
end;
$$;

comment on function plm.reset_taxonomy_circuit_breaker(jsonb, text) is
  'Authorized re-enable. Refuses unless the caller supplies authorized_by, readiness_pass=true, and readiness_evidence. Appends an immutable reset event; never removes the earlier trip events.';

revoke all on function plm.taxonomy_circuit_breaker_is_open(text) from public;
revoke all on function plm.taxonomy_circuit_breaker_state(text) from public;
revoke all on function plm.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb) from public;
revoke all on function plm.reset_taxonomy_circuit_breaker(jsonb, text) from public;
grant execute on function plm.taxonomy_circuit_breaker_is_open(text) to service_role;
grant execute on function plm.taxonomy_circuit_breaker_state(text) to service_role;
grant execute on function plm.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb) to service_role;
grant execute on function plm.reset_taxonomy_circuit_breaker(jsonb, text) to service_role;

-- public wrappers (service_role only; browser roles explicitly revoked)

create or replace function public.trip_taxonomy_circuit_breaker(
  p_reason text,
  p_failed_invariant text,
  p_lane text default 'coldlion_licensor_property',
  p_related_run_id uuid default null,
  p_environment text default null,
  p_actor text default null,
  p_is_drill boolean default false,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language sql
security definer
set search_path = public, plm
as $$
  select plm.trip_taxonomy_circuit_breaker(
    p_reason, p_failed_invariant, p_lane, p_related_run_id,
    p_environment, p_actor, p_is_drill, p_payload);
$$;

create or replace function public.reset_taxonomy_circuit_breaker(
  p_authorization jsonb,
  p_lane text default 'coldlion_licensor_property'
)
returns jsonb
language sql
security definer
set search_path = public, plm
as $$
  select plm.reset_taxonomy_circuit_breaker(p_authorization, p_lane);
$$;

create or replace function public.taxonomy_circuit_breaker_state(
  p_lane text default 'coldlion_licensor_property'
)
returns jsonb
language sql
stable
security definer
set search_path = public, plm
as $$
  select plm.taxonomy_circuit_breaker_state(p_lane);
$$;

revoke all on function public.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb) from public;
revoke all on function public.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb) from anon, authenticated;
grant execute on function public.trip_taxonomy_circuit_breaker(text, text, text, uuid, text, text, boolean, jsonb) to service_role;

revoke all on function public.reset_taxonomy_circuit_breaker(jsonb, text) from public;
revoke all on function public.reset_taxonomy_circuit_breaker(jsonb, text) from anon, authenticated;
grant execute on function public.reset_taxonomy_circuit_breaker(jsonb, text) to service_role;

revoke all on function public.taxonomy_circuit_breaker_state(text) from public;
revoke all on function public.taxonomy_circuit_breaker_state(text) from anon, authenticated;
grant execute on function public.taxonomy_circuit_breaker_state(text) to service_role;

-- =====================================================================================
-- 3. Trigger enforcement — the part that actually stops an unsafe canonical change
-- =====================================================================================
--
-- Scope reminder: ColdLion rows and ColdLion mirror links ONLY. A tripped
-- ColdLion breaker must leave DesignFlow refs, curated status, and Property
-- parents fully writable, because ColdLion does not supply those facts and the
-- operational response depends on them staying available.

create or replace function plm.guard_coldlion_source_ref_breaker()
returns trigger
language plpgsql
security definer
set search_path = plm, core, public
as $$
begin
  if new.source_system = 'coldlion'
     and plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property')
  then
    insert into plm.taxonomy_circuit_breaker_event (
      lane, event, reason, failed_invariant, actor, payload)
    values (
      'coldlion_licensor_property', 'blocked_attempt',
      'refused ColdLion taxonomy source-ref write while the circuit breaker is tripped',
      'circuit_breaker_open', session_user,
      jsonb_build_object(
        'entity_table', new.entity_table,
        'source_id', new.source_id,
        'operation', tg_op));

    raise exception
      'ColdLion taxonomy circuit breaker is TRIPPED: refusing % of core.taxonomy_source_ref for source_id % — reset requires a named authorization and a green readiness evaluation',
      tg_op, new.source_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists coldlion_source_ref_breaker_guard on core.taxonomy_source_ref;
create trigger coldlion_source_ref_breaker_guard
  before insert or update on core.taxonomy_source_ref
  for each row
  execute function plm.guard_coldlion_source_ref_breaker();

create or replace function plm.guard_coldlion_mirror_link_breaker()
returns trigger
language plpgsql
security definer
set search_path = plm, core, public
as $$
declare
  v_old uuid;
  v_new uuid;
  v_col text;
begin
  if tg_table_name = 'erp_licensor' then
    v_col := 'licensor_id';
    v_old := (to_jsonb(old)->>'licensor_id')::uuid;
    v_new := (to_jsonb(new)->>'licensor_id')::uuid;
  else
    v_col := 'property_id';
    v_old := (to_jsonb(old)->>'property_id')::uuid;
    v_new := (to_jsonb(new)->>'property_id')::uuid;
  end if;

  if v_new is distinct from v_old
     and plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property')
  then
    insert into plm.taxonomy_circuit_breaker_event (
      lane, event, reason, failed_invariant, actor, payload)
    values (
      'coldlion_licensor_property', 'blocked_attempt',
      'refused ColdLion typed mirror canonical link change while the circuit breaker is tripped',
      'circuit_breaker_open', session_user,
      jsonb_build_object(
        'mirror_table', tg_table_name,
        'column', v_col,
        'old', v_old,
        'new', v_new));

    raise exception
      'ColdLion taxonomy circuit breaker is TRIPPED: refusing %.% change on plm.% — reset requires a named authorization and a green readiness evaluation',
      tg_table_name, v_col, tg_table_name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists coldlion_erp_licensor_breaker_guard on plm.erp_licensor;
create trigger coldlion_erp_licensor_breaker_guard
  before update on plm.erp_licensor
  for each row
  execute function plm.guard_coldlion_mirror_link_breaker();

drop trigger if exists coldlion_erp_property_breaker_guard on plm.erp_property;
create trigger coldlion_erp_property_breaker_guard
  before update on plm.erp_property
  for each row
  execute function plm.guard_coldlion_mirror_link_breaker();

-- =====================================================================================
-- 4. Deterministic 542-row mapping-IDENTITY proof (read-only)
-- =====================================================================================
--
-- Counts and hashes cannot detect a swap, a type flip, or a compensating
-- missing/extra pair. This function resolves EVERY approved mapping by its full
-- typed source identity (company/division/mgTypeCode/mgCode + entity type) and
-- asserts the exact canonical UUID, in both directions.
--
-- Reminder from AGENTS.md 6.1: merch-group codes are unique only within
-- (division, mgTypeCode), and 'FR' is a licensor here and a property in ColdLion.
-- That is precisely why the composite key and the entity type are both required
-- and why a cross-typed resolution is a hard block, never a warning.

create or replace function plm.verify_coldlion_approved_mapping_identity(
  p_input jsonb,
  p_expected jsonb default null,
  p_sample_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = plm, core, public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_sample_limit, 25), 200));
  v_maps jsonb;
  v_bad_shape integer;
  v_count integer;
  v_distinct integer;
  v_hash text;
  v_dup_keys jsonb;
  v_actual_refs integer;
  v_missing jsonb;
  v_extra jsonb;
  v_cross jsonb;
  v_changed jsonb;
  v_dup_refs jsonb;
  v_link_mismatch jsonb;
  v_canonical_missing jsonb;
  v_counts jsonb;
  v_reasons text[] := array[]::text[];
  v_contract_ok boolean := true;
  v_exp_hash text;
  v_exp_count integer;
  v_exp_distinct integer;
  v_pass boolean;
begin
  if p_input is null or jsonb_typeof(p_input->'mappings') <> 'array' then
    raise exception 'verify_coldlion_approved_mapping_identity requires { "mappings": [...] }'
      using errcode = 'P0001';
  end if;
  v_maps := p_input->'mappings';

  -- ---- shape: reject before anything else so a malformed file cannot "pass" ----
  select count(*) into v_bad_shape
  from jsonb_array_elements(v_maps) e
  where coalesce(e->>'entity_type', '') not in ('licensor', 'property')
     or coalesce(btrim(e->>'company_code'), '') = ''
     or coalesce(btrim(e->>'division_code'), '') = ''
     or coalesce(e->>'mg_type_code', '') !~ '^[0-9]{2}$'
     or coalesce(btrim(e->>'mg_code'), '') = ''
     or coalesce(e->>'canonical_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

  if v_bad_shape > 0 then
    return jsonb_build_object(
      'pass', false,
      'checked_at', timezone('utc', now()),
      'blocking_reasons', to_jsonb(array[
        format('%s approved mapping row(s) are structurally invalid; identity cannot be proven', v_bad_shape)]),
      'difference_counts', jsonb_build_object('invalid_shape', v_bad_shape));
  end if;

  -- One read-only CTE pass. No temp table: this function must stay STABLE so it
  -- can be run immediately before a production write with zero side effects.
  with m as (
    select e->>'entity_type' as entity_type,
           e->>'company_code' as company_code,
           e->>'division_code' as division_code,
           e->>'mg_type_code' as mg_type_code,
           e->>'mg_code' as mg_code,
           (e->>'canonical_id')::uuid as canonical_id,
           concat_ws('/', e->>'company_code', e->>'division_code',
                          e->>'mg_type_code', e->>'mg_code') as source_id
    from jsonb_array_elements(v_maps) e
  ),
  refs as (
    select r.source_id, r.entity_table, r.entity_id
    from core.taxonomy_source_ref r
    where r.source_system = 'coldlion' and r.source_table = 'merchGroupDetails'
  ),
  joined as (
    select m.source_id, m.entity_type, m.canonical_id,
           r.entity_table, r.entity_id
    from m join refs r on r.source_id = m.source_id
  ),
  missing as (
    select m.entity_type, m.source_id, m.canonical_id
    from m where not exists (select 1 from refs r where r.source_id = m.source_id)
  ),
  extra as (
    select r.entity_table, r.source_id, r.entity_id
    from refs r where not exists (select 1 from m where m.source_id = r.source_id)
  ),
  cross_typed as (
    select source_id, entity_type as approved_type, entity_table as actual_type
    from joined where entity_table is distinct from entity_type
  ),
  changed as (
    select source_id, entity_type, canonical_id as approved_id, entity_id as actual_id
    from joined
    where entity_table is not distinct from entity_type
      and entity_id is distinct from canonical_id
  ),
  dup_input as (
    select source_id, count(*) as n from m group by source_id having count(*) > 1
  ),
  dup_refs as (
    select source_id, count(*) as n from refs group by source_id having count(*) > 1
  ),
  link_mismatch as (
    select m.source_id, m.entity_type, m.canonical_id as approved_id,
           e.licensor_id as mirror_id
    from m join plm.erp_licensor e
      on e.company_code = m.company_code and e.division_code = m.division_code
     and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    where m.entity_type = 'licensor' and e.licensor_id is distinct from m.canonical_id
    union all
    select m.source_id, m.entity_type, m.canonical_id, e.property_id
    from m join plm.erp_property e
      on e.company_code = m.company_code and e.division_code = m.division_code
     and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    where m.entity_type = 'property' and e.property_id is distinct from m.canonical_id
  ),
  canonical_missing as (
    select m.source_id, m.entity_type, m.canonical_id
    from m
    where (m.entity_type = 'licensor'
             and not exists (select 1 from core.licensor l where l.id = m.canonical_id))
       or (m.entity_type = 'property'
             and not exists (select 1 from core.property p where p.id = m.canonical_id))
  )
  select
    (select count(*)::integer from m),
    (select count(distinct canonical_id)::integer from m),
    -- Frozen Phase 4 encoding: sort by composite key in code-unit (C) order,
    -- '<entity_type>|<composite>|<canonical_id>' joined by newline, md5 utf8 hex.
    (select md5(coalesce(string_agg(entity_type || '|' || source_id || '|' || canonical_id::text,
                                    E'\n' order by source_id collate "C"), '')) from m),
    (select count(*)::integer from refs),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'entity_type', entity_type, 'source_id', source_id,
              'expected_canonical_id', canonical_id) order by source_id), '[]'::jsonb)
       from (select * from missing order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'entity_table', entity_table, 'source_id', source_id,
              'entity_id', entity_id) order by source_id), '[]'::jsonb)
       from (select * from extra order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'source_id', source_id, 'approved_entity_type', approved_type,
              'actual_entity_table', actual_type) order by source_id), '[]'::jsonb)
       from (select * from cross_typed order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'source_id', source_id, 'entity_type', entity_type,
              'approved_canonical_id', approved_id, 'actual_entity_id', actual_id)
              order by source_id), '[]'::jsonb)
       from (select * from changed order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object('source_id', source_id, 'occurrences', n)
              order by source_id), '[]'::jsonb)
       from (select * from dup_input order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object('source_id', source_id, 'occurrences', n)
              order by source_id), '[]'::jsonb)
       from (select * from dup_refs order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'source_id', source_id, 'entity_type', entity_type,
              'approved_canonical_id', approved_id, 'mirror_link', mirror_id)
              order by source_id), '[]'::jsonb)
       from (select * from link_mismatch order by source_id limit v_limit) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'source_id', source_id, 'entity_type', entity_type,
              'canonical_id', canonical_id) order by source_id), '[]'::jsonb)
       from (select * from canonical_missing order by source_id limit v_limit) s),
    jsonb_build_object(
      'missing', (select count(*) from missing),
      'extra', (select count(*) from extra),
      'cross_typed', (select count(*) from cross_typed),
      'changed_uuid', (select count(*) from changed),
      'duplicate_input_key', (select count(*) from dup_input),
      'duplicate_source_ref', (select count(*) from dup_refs),
      'link_mismatch', (select count(*) from link_mismatch),
      'canonical_missing', (select count(*) from canonical_missing))
  into v_count, v_distinct, v_hash, v_actual_refs,
       v_missing, v_extra, v_cross, v_changed,
       v_dup_keys, v_dup_refs, v_link_mismatch, v_canonical_missing, v_counts;

  -- ---- expected contract (hash / count / distinct), when supplied ----
  if p_expected is not null and jsonb_typeof(p_expected) = 'object' then
    v_exp_hash := p_expected->>'hash';
    v_exp_count := nullif(p_expected->>'count', '')::integer;
    v_exp_distinct := nullif(p_expected->>'distinct_canonical', '')::integer;

    if v_exp_hash is distinct from v_hash then
      v_contract_ok := false;
      v_reasons := v_reasons || format('approved mapping hash mismatch: recomputed %s, expected %s',
                                       v_hash, coalesce(v_exp_hash, 'null'));
    end if;
    if v_exp_count is not null and v_exp_count is distinct from v_count then
      v_contract_ok := false;
      v_reasons := v_reasons || format('approved mapping count mismatch: recomputed %s, expected %s',
                                       v_count, v_exp_count);
    end if;
    if v_exp_distinct is not null and v_exp_distinct is distinct from v_distinct then
      v_contract_ok := false;
      v_reasons := v_reasons || format('approved distinct canonical mismatch: recomputed %s, expected %s',
                                       v_distinct, v_exp_distinct);
    end if;
  end if;

  if (v_counts->>'missing')::integer > 0 then
    v_reasons := v_reasons || format('%s approved mapping(s) have NO ColdLion source ref', v_counts->>'missing');
  end if;
  if (v_counts->>'extra')::integer > 0 then
    v_reasons := v_reasons || format('%s ColdLion source ref(s) are outside the approved set', v_counts->>'extra');
  end if;
  if (v_counts->>'cross_typed')::integer > 0 then
    v_reasons := v_reasons || format('%s mapping(s) resolve to the WRONG entity type (cross-typed)', v_counts->>'cross_typed');
  end if;
  if (v_counts->>'changed_uuid')::integer > 0 then
    v_reasons := v_reasons || format('%s mapping(s) resolve to a DIFFERENT canonical UUID', v_counts->>'changed_uuid');
  end if;
  if (v_counts->>'duplicate_input_key')::integer > 0 then
    v_reasons := v_reasons || 'the approved mapping input contains duplicate composite source keys';
  end if;
  if (v_counts->>'duplicate_source_ref')::integer > 0 then
    v_reasons := v_reasons || 'a ColdLion source identity resolves ambiguously to more than one ref row';
  end if;
  if (v_counts->>'link_mismatch')::integer > 0 then
    v_reasons := v_reasons || format('%s typed mirror link(s) disagree with the approved canonical UUID', v_counts->>'link_mismatch');
  end if;
  if (v_counts->>'canonical_missing')::integer > 0 then
    v_reasons := v_reasons || format('%s approved canonical row(s) no longer exist in the typed table', v_counts->>'canonical_missing');
  end if;

  v_pass := v_contract_ok and array_length(v_reasons, 1) is null;

  return jsonb_build_object(
    'pass', v_pass,
    'checked_at', timezone('utc', now()),
    'approved_count', v_count,
    'approved_distinct_canonical', v_distinct,
    'recomputed_mapping_hash', v_hash,
    'expected_contract', p_expected,
    'expected_contract_ok', v_contract_ok,
    'actual_coldlion_source_refs', v_actual_refs,
    'difference_counts', v_counts,
    'differences', jsonb_build_object(
      'missing', v_missing,
      'extra', v_extra,
      'cross_typed', v_cross,
      'changed_uuid', v_changed,
      'duplicate_input_key', v_dup_keys,
      'duplicate_source_ref', v_dup_refs,
      'link_mismatch', v_link_mismatch,
      'canonical_missing', v_canonical_missing),
    'sample_limit', v_limit,
    'blocking_reasons', to_jsonb(v_reasons),
    'human_response_owner', 'Albert Hazan');
end;
$$;

comment on function plm.verify_coldlion_approved_mapping_identity(jsonb, jsonb, integer) is
  'READ-ONLY row-by-row identity proof for the approved ColdLion licensor/property mapping. Resolves every approved row by full typed source identity (company/division/mgTypeCode/mgCode + entity type) to its exact canonical UUID, in both directions. Fails on missing, extra, duplicate, changed, cross-typed, link-mismatched, or vanished-canonical rows. Counts alone can never pass: the expected hash/count/distinct contract is checked in addition to, never instead of, the per-row proof.';

create or replace function public.verify_coldlion_approved_mapping_identity(
  p_input jsonb,
  p_expected jsonb default null,
  p_sample_limit integer default 25
)
returns jsonb
language sql
stable
security definer
set search_path = public, plm
as $$
  select plm.verify_coldlion_approved_mapping_identity(p_input, p_expected, p_sample_limit);
$$;

revoke all on function plm.verify_coldlion_approved_mapping_identity(jsonb, jsonb, integer) from public;
grant execute on function plm.verify_coldlion_approved_mapping_identity(jsonb, jsonb, integer) to service_role;

revoke all on function public.verify_coldlion_approved_mapping_identity(jsonb, jsonb, integer) from public;
revoke all on function public.verify_coldlion_approved_mapping_identity(jsonb, jsonb, integer) from anon, authenticated;
grant execute on function public.verify_coldlion_approved_mapping_identity(jsonb, jsonb, integer) to service_role;
