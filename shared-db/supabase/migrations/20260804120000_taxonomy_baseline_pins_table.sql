-- Phase 6 baseline pins move OUT of compiled-in PL/pgSQL constants and INTO data.
--
-- WHY THIS FILE EXISTS (the failure it corrects)
-- ----------------------------------------------
-- 20260726180000 pinned the Phase 4 preview baseline as `constant` declarations in
-- TWO functions (plm.record_taxonomy_parallel_observation ~line 361 and
-- plm.check_taxonomy_sync_health ~line 816). On 2026-08-02 the owner ruling in
-- 20260802171000_owner_ruling_friends_tv_frida_kahlo.sql set a licensor to
-- 'inactive'. That is CORRECT data. But it changed core.licensor's status hash
-- from d9b07759bf80ff227e2fa9bd635d2138 to 00bf7069fff79b9deab1d14dbd9112b2, and
-- the pinned constant could not follow, because an applied migration is immutable.
--
-- Result, verified live on preview rjyboqwcdzcocqgmsyel on 2026-08-04:
--   * every other pin still matched exactly (26 / 256 licensors+properties,
--     1047 / 542 / 505 source refs, 38 / 504 links, both uuid hashes, the
--     property status hash, the parent edge hash) -- exactly ONE value differed;
--   * baseline_ok has been false on every non-drill observation since 2026-08-03;
--   * a critical alert fired daily (23 unacknowledged, 2026-08-02..2026-08-04);
--   * the auto-trip trigger from 20260728134500 tripped the
--     coldlion_licensor_property breaker at 2026-08-02 11:16:31-04, reset_at null.
--
-- The DATA was right and the FINGERPRINT was stale. A hardcoded constant rots the
-- moment the owner makes a ruling, and would rot again on the next one. So the
-- expected values become rows, with provenance: what was pinned, to what value,
-- by whom, when, and why.
--
--
-- ############################################################################
-- ##  STOP -- THESE PINS ARE PREVIEW VALUES AND MUST NOT GOVERN PRODUCTION.  ##
-- ############################################################################
--
-- AGENTS.md §6.5 is a standing OWNER RULING (Albert Hazan, 2026-08-03). Quoting it:
--
--     "Until the combined change ships, production and preview DISAGREE about `FR`:
--      production has `FR` active, preview has `FR` inactive. This divergence is
--      KNOWN, EXPECTED and ACCEPTED [...] Do not 'fix' it, do not promote #408 to
--      close it, and do not re-report it as drift, as a failed promotion, or as an
--      incident."
--
-- 20260802171000 -- the migration that produced 00bf7069... -- is deliberately HELD
-- off production until the FR removal work ships. So production's live
-- licensor_status_hash is NOT 00bf7069..., and it is not this session's to guess:
-- production is out of bounds, and no value derived from preview describes it.
--
-- If the pins below simply became active on promotion, production's first
-- observation would report baseline_ok = false, raise a CRITICAL alert, and the
-- auto-trip trigger from 20260728134500 would trip the PRODUCTION ColdLion
-- breaker -- for a divergence the owner has already ruled is not a bug. That is
-- precisely the "re-report it as drift" §6.5 forbids.
--
-- THE GATE THAT PREVENTS IT: a baseline governs nothing until it is explicitly
-- ACTIVATED in a named database, and this migration ACTIVATES NOTHING. See
-- plm.taxonomy_baseline_activation in section 3. Where no baseline is active, both
-- Phase 6 detectors REFUSE: they record a failed ingest.sync_run and a WARNING
-- alert, then return. They do not fabricate a pass, and -- because the alert is
-- 'warning', not 'critical' -- they do not trip the breaker either. Not a false
-- green, not a false red.
--
-- The refusal is the DEFAULT everywhere, including preview, so it is not a state
-- reached only by forgetting something on production. Preview is activated by an
-- explicit post-apply call (section 3). Production stays refused until the FR
-- removal work ships AND production-correct values are derived FROM PRODUCTION
-- and seeded under their own baseline_key, e.g. 'phase4_production'.
--
-- Note the refusal does NOT depend on the environment being named. An unnamed
-- database simply has no activation row, so it refuses on that basis alone --
-- which matters, because plm.deployment_environment reads 'unconfigured' on
-- production until someone names it.
--
-- DESIGN NOTES
--   * Applied migrations are NEVER edited. 20260726180000 stays exactly as it is;
--     this file fixes forward with `create or replace` on the two functions.
--   * A missing pin must never read as "nothing to compare". The accessor raises,
--     and both detectors CATCH that raise and convert it into a failed sync_run
--     plus a CRITICAL alert before returning -- so a blind detector leaves durable
--     in-database evidence and fails CLOSED. Resolving the baseline happens in the
--     function BODY, never the DECLARE block, precisely so it can be caught: a
--     raise in DECLARE is outside every handler and would take both detectors dark
--     with no trace that they ran.
--   * Row triggers never fire on TRUNCATE, and `grant all ... to service_role`
--     includes it, so a statement-level trigger guards that separately.
--   * The pin history is append-only in the same spirit as
--     plm.taxonomy_parallel_observation: a pin is retired by stamping
--     superseded_at, never by UPDATE-in-place or DELETE. A trigger enforces that,
--     structurally -- it never consults auth.role(), which is NULL inside a
--     migration and would make any role-based guard silently permissive.
--   * plm.taxonomy_baseline_pin_set() FAILS LOUDLY if any expected metric is
--     missing. A missing pin must never read as "nothing to compare", which would
--     turn the whole baseline gate into a no-op that reports green.
--   * `create or replace function` DROPS the function's grants in PostgreSQL, so
--     every grant enumerated before this migration is re-asserted at the bottom.
--     Verified state before this migration on preview (pg_proc.proacl):
--       plm.record_taxonomy_parallel_observation  postgres=X/postgres ; service_role=X/postgres
--       plm.check_taxonomy_sync_health            postgres=X/postgres ; service_role=X/postgres
--     i.e. EXECUTE for postgres (owner) and service_role only; no anon, no
--     authenticated. That is restored verbatim below.
--   * Timestamps are pinned to MIDDAY UTC on purpose. The database runs
--     America/New_York, so a midnight-UTC timestamp reads back through ::date as
--     the previous day.

-- =====================================================================================
-- 1. The pin table
-- =====================================================================================

create table if not exists plm.taxonomy_baseline_pin (
  id uuid primary key default gen_random_uuid(),
  baseline_key text not null,
  metric_key text not null,
  metric_kind text not null check (metric_kind in ('count', 'hash')),
  expected_int integer,
  expected_text text,
  effective_from timestamptz not null,
  superseded_at timestamptz,
  pinned_by text not null,
  pinned_reason text not null,
  source_migration text not null,
  created_at timestamptz not null default now(),
  constraint plm_taxonomy_baseline_pin_value_shape check (
    case metric_kind
      when 'count' then expected_int is not null and expected_text is null
      when 'hash'  then expected_text is not null and expected_int is null
      else false
    end
  )
);

comment on table plm.taxonomy_baseline_pin is
  'Phase 6 expected-baseline values, as DATA rather than compiled-in PL/pgSQL constants. One live row per (baseline_key, metric_key) -- the row with superseded_at IS NULL. Retiring a pin means stamping superseded_at and inserting a replacement, so the record of what was expected, when, by whom and why is never lost. Replaces the constants hardcoded in 20260726180000, which could not follow the 2026-08-02 owner ruling that legitimately changed core.licensor statuses.';

comment on column plm.taxonomy_baseline_pin.baseline_key is
  'Which baseline this pin belongs to (e.g. phase4_preview). Lets a second baseline exist without disturbing the first.';
comment on column plm.taxonomy_baseline_pin.metric_key is
  'The snapshot key this pins, matching a key returned by plm.compute_taxonomy_immutability_snapshot().';
comment on column plm.taxonomy_baseline_pin.superseded_at is
  'NULL = this is the value currently expected. Non-null = retired; kept forever as provenance.';
comment on column plm.taxonomy_baseline_pin.pinned_reason is
  'Free text: WHY this value is the expected one. Required -- a pin with no stated reason is how the last one rotted unnoticed.';

create unique index if not exists plm_taxonomy_baseline_pin_live_idx
  on plm.taxonomy_baseline_pin (baseline_key, metric_key)
  where superseded_at is null;

create index if not exists plm_taxonomy_baseline_pin_history_idx
  on plm.taxonomy_baseline_pin (baseline_key, metric_key, effective_from desc);

-- Structural append-only guard. Deliberately NOT role-based: auth.role() is NULL
-- inside a migration, so `if not (... or auth.role() = 'service_role')` would
-- never fire. This checks the SHAPE of the change instead, for every caller.
create or replace function plm.guard_taxonomy_baseline_pin_immutable()
returns trigger
language plpgsql
set search_path = plm, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'plm.taxonomy_baseline_pin is append-only: refusing DELETE of pin %/% (retire it by setting superseded_at and inserting a replacement)',
      old.baseline_key, old.metric_key
      using errcode = 'P0001';
  end if;

  if old.id is distinct from new.id
     or old.baseline_key is distinct from new.baseline_key
     or old.metric_key is distinct from new.metric_key
     or old.metric_kind is distinct from new.metric_kind
     or old.expected_int is distinct from new.expected_int
     or old.expected_text is distinct from new.expected_text
     or old.effective_from is distinct from new.effective_from
     or old.pinned_by is distinct from new.pinned_by
     or old.pinned_reason is distinct from new.pinned_reason
     or old.source_migration is distinct from new.source_migration
     or old.created_at is distinct from new.created_at
  then
    raise exception
      'plm.taxonomy_baseline_pin is append-only: superseded_at is the only column that may be updated (pin %/%)',
      old.baseline_key, old.metric_key
      using errcode = 'P0001';
  end if;

  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
    raise exception
      'pin %/% is already superseded at %; a retired pin may not be re-dated',
      old.baseline_key, old.metric_key, old.superseded_at
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function plm.guard_taxonomy_baseline_pin_immutable() is
  'Keeps plm.taxonomy_baseline_pin append-only: no DELETE, and UPDATE may only stamp superseded_at once. Structural, not role-based, so it also fires inside migrations where auth.role() is NULL.';

drop trigger if exists plm_taxonomy_baseline_pin_immutable on plm.taxonomy_baseline_pin;
create trigger plm_taxonomy_baseline_pin_immutable
  before update or delete on plm.taxonomy_baseline_pin
  for each row
  execute function plm.guard_taxonomy_baseline_pin_immutable();

-- TRUNCATE is not a DELETE: a FOR EACH ROW trigger never sees it, and
-- `grant all ... to service_role` below includes TRUNCATE. Without this, the whole
-- append-only guarantee above is one TRUNCATE away from nothing.
create or replace function plm.guard_taxonomy_baseline_pin_no_truncate()
returns trigger
language plpgsql
set search_path = plm, public
as $$
begin
  raise exception
    'plm.% is append-only: TRUNCATE is refused (row triggers do not fire on TRUNCATE, so this statement trigger is the only guard)',
    tg_table_name
    using errcode = 'P0001';
end;
$$;

drop trigger if exists plm_taxonomy_baseline_pin_no_truncate on plm.taxonomy_baseline_pin;
create trigger plm_taxonomy_baseline_pin_no_truncate
  before truncate on plm.taxonomy_baseline_pin
  for each statement
  execute function plm.guard_taxonomy_baseline_pin_no_truncate();

alter table plm.taxonomy_baseline_pin enable row level security;

drop policy if exists plm_taxonomy_baseline_pin_admin_select on plm.taxonomy_baseline_pin;
create policy plm_taxonomy_baseline_pin_admin_select
  on plm.taxonomy_baseline_pin
  for select
  to authenticated
  using (app.has_role('administrator'));

grant select on plm.taxonomy_baseline_pin to authenticated;
grant all on plm.taxonomy_baseline_pin to service_role;

-- =====================================================================================
-- 2. Seed the CURRENT correct PREVIEW values (read live from preview 2026-08-04)
-- =====================================================================================
--
-- Eleven of these are byte-identical to the constants in 20260726180000. The
-- twelfth, licensor_status_hash, carries the value produced by the approved owner
-- ruling of 2026-08-02 (Friends TV / Frida Kahlo), which is why this file exists.
--
-- SEEDING IS NOT ACTIVATION. These rows govern nothing until section 3's
-- activation call names this database. On production they must stay inert -- see
-- the AGENTS.md 6.5 block at the top of this file.

insert into plm.taxonomy_baseline_pin (
  baseline_key, metric_key, metric_kind, expected_int, expected_text,
  effective_from, pinned_by, pinned_reason, source_migration
)
select
  'phase4_preview', v.metric_key, v.metric_kind, v.expected_int, v.expected_text,
  timestamptz '2026-08-04 12:00:00+00',
  'Albert Hazan (owner)',
  v.reason,
  '20260804120000_taxonomy_baseline_pins_table'
from (values
  ('licensor_count', 'count', 26, null::text,
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('property_count', 'count', 256, null,
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('taxonomy_source_ref_count', 'count', 1047, null,
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('coldlion_source_ref_count', 'count', 542, null,
   'The 542 approved ColdLion links; unchanged from 20260726180000, verified live 2026-08-04.'),
  ('designflow_source_ref_count', 'count', 505, null,
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('linked_licensor_count', 'count', 38, null,
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('linked_property_count', 'count', 504, null,
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('licensor_uuid_hash', 'hash', null, '590ea83ea6df1487fcfc1e18b3ef6a0d',
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('property_uuid_hash', 'hash', null, 'e0e6c36eb02bb2d320c0deaff7aa8f8c',
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('property_status_hash', 'hash', null, 'f436d4acd79761fedbfc9b5796ac7bce',
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('parent_edge_hash', 'hash', null, '7459f6826cc59468779e7ead33ec0edc',
   'Unchanged from the Phase 4 preview baseline pinned in 20260726180000; verified live 2026-08-04.'),
  ('licensor_status_hash', 'hash', null, '00bf7069fff79b9deab1d14dbd9112b2',
   'REFRESHED, PREVIEW ONLY. The old pin d9b07759bf80ff227e2fa9bd635d2138 predates the approved owner ruling of 2026-08-02 (20260802171000_owner_ruling_friends_tv_frida_kahlo.sql), which set a licensor to inactive. The data is correct; the previous fingerprint was stale, and being compiled into an immutable applied migration it could not follow. Every other Phase 4 pin still matched exactly, which is what distinguishes an owner ruling from real drift. PRODUCTION DOES NOT MATCH THIS VALUE and must not: AGENTS.md 6.5 holds 20260802171000 off production until the FR removal work ships, so production still has FR active. Production needs its own baseline_key, derived from production.')
) as v(metric_key, metric_kind, expected_int, expected_text, reason)
where not exists (
  select 1 from plm.taxonomy_baseline_pin p
  where p.baseline_key = 'phase4_preview'
    and p.metric_key = v.metric_key
    and p.superseded_at is null
);

-- =====================================================================================
-- 3. Activation -- which baseline, if any, governs THIS database
-- =====================================================================================
--
-- Deliberately seeded EMPTY. No baseline is active anywhere until somebody names
-- one, in a named database, on purpose. That makes "refuse" the default state on
-- every database this migration ever reaches, rather than a state arrived at only
-- by forgetting something on production.

create table if not exists plm.taxonomy_baseline_activation (
  singleton boolean primary key default true check (singleton),
  baseline_key text not null,
  intended_environment text not null,
  activated_by text not null,
  activated_at timestamptz not null default now(),
  activated_reason text not null,
  updated_at timestamptz not null default now()
);

comment on table plm.taxonomy_baseline_activation is
  'Names the ONE baseline that governs this database, or is empty -- in which case both Phase 6 detectors refuse rather than comparing against values derived from a different environment. Empty is the default and the safe state. See AGENTS.md 6.5: preview and production legitimately disagree about licensor FR, so a preview baseline must never govern production.';

grant select on plm.taxonomy_baseline_activation to authenticated;
grant all on plm.taxonomy_baseline_activation to service_role;

alter table plm.taxonomy_baseline_activation enable row level security;

drop policy if exists plm_taxonomy_baseline_activation_admin_select on plm.taxonomy_baseline_activation;
create policy plm_taxonomy_baseline_activation_admin_select
  on plm.taxonomy_baseline_activation
  for select
  to authenticated
  using (app.has_role('administrator'));

create or replace function plm.active_taxonomy_baseline_key()
returns text
language sql
stable
security definer
set search_path = plm, public
as $$
  select baseline_key from plm.taxonomy_baseline_activation where singleton;
$$;

comment on function plm.active_taxonomy_baseline_key() is
  'The baseline governing this database, or NULL when none is activated. NULL makes both Phase 6 detectors refuse -- never pass, never trip.';

revoke all on function plm.active_taxonomy_baseline_key() from public;
grant execute on function plm.active_taxonomy_baseline_key() to service_role;

-- Activation refuses in an unnamed database, refuses a baseline built for a
-- different one, and refuses an incomplete baseline. The detectors' refusal path
-- does NOT depend on any of this -- an unnamed database has no activation row and
-- refuses on that basis alone. These checks are the SECOND lock, guarding against
-- someone activating PREVIEW pins on production.
create or replace function plm.activate_taxonomy_baseline(
  p_baseline_key text,
  p_intended_environment text,
  p_activated_by text,
  p_activated_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = plm, public
as $$
declare
  v_key text := nullif(btrim(coalesce(p_baseline_key, '')), '');
  v_env text := nullif(btrim(coalesce(p_intended_environment, '')), '');
  v_by text := nullif(btrim(coalesce(p_activated_by, '')), '');
  v_reason text := nullif(btrim(coalesce(p_activated_reason, '')), '');
  v_here text := plm.resolve_deployment_environment();
  v_missing text[];
begin
  if v_key is null or v_env is null or v_by is null or v_reason is null then
    raise exception
      'activating a baseline requires baseline_key, intended_environment, activated_by and activated_reason -- all four, explicitly'
      using errcode = 'P0001';
  end if;

  if not plm.deployment_environment_is_configured() then
    raise exception
      'refusing to activate baseline %: this database is not named yet (plm.deployment_environment reads %). Name it first, so an activation can never be recorded against an unidentified database.',
      v_key, v_here
      using errcode = 'P0001';
  end if;

  if v_env is distinct from v_here then
    raise exception
      'refusing to activate baseline %: it is declared for % but this database is %. AGENTS.md 6.5 -- preview and production legitimately disagree about licensor FR, so a baseline derived from one must never govern the other.',
      v_key, v_env, v_here
      using errcode = 'P0001';
  end if;

  -- A baseline must be complete before it may govern anything; activating an
  -- incomplete one would arm the detectors' blind path deliberately.
  select array_agg(k order by k) into v_missing
  from unnest(array[
    'licensor_count', 'property_count', 'taxonomy_source_ref_count',
    'coldlion_source_ref_count', 'designflow_source_ref_count',
    'linked_licensor_count', 'linked_property_count',
    'licensor_uuid_hash', 'property_uuid_hash',
    'licensor_status_hash', 'property_status_hash', 'parent_edge_hash'
  ]) as k
  where not exists (
    select 1 from plm.taxonomy_baseline_pin p
    where p.baseline_key = v_key and p.metric_key = k and p.superseded_at is null
  );

  if v_missing is not null then
    raise exception
      'refusing to activate baseline %: no live pin for %',
      v_key, array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  insert into plm.taxonomy_baseline_activation as a (
    singleton, baseline_key, intended_environment, activated_by,
    activated_at, activated_reason, updated_at)
  values (true, v_key, v_env, v_by, now(), v_reason, now())
  on conflict (singleton) do update
    set baseline_key = excluded.baseline_key,
        intended_environment = excluded.intended_environment,
        activated_by = excluded.activated_by,
        activated_at = excluded.activated_at,
        activated_reason = excluded.activated_reason,
        updated_at = now();

  return jsonb_build_object(
    'baseline_key', v_key, 'environment', v_here, 'activated_by', v_by);
end;
$$;

comment on function plm.activate_taxonomy_baseline(text, text, text, text) is
  'Makes one baseline govern this database. Refuses in an unnamed database, refuses a baseline declared for a different environment, and refuses an incomplete baseline.';

revoke all on function plm.activate_taxonomy_baseline(text, text, text, text) from public;
revoke all on function plm.activate_taxonomy_baseline(text, text, text, text) from anon, authenticated;
grant execute on function plm.activate_taxonomy_baseline(text, text, text, text) to service_role;

-- POST-APPLY, PREVIEW ONLY. Run after naming the database (see 20260804120100).
-- Already run on preview on 2026-08-04.
--
--   select plm.activate_taxonomy_baseline(
--     'phase4_preview',
--     'preview rjyboqwcdzcocqgmsyel',
--     'Albert Hazan (owner)',
--     'Phase 6 parallel run is a preview exercise; these pins were derived from preview on 2026-08-04.');
--
-- DO NOT run an equivalent on production. Production has no baseline yet and must
-- not borrow preview's -- AGENTS.md 6.5. When the FR removal work ships, derive
-- production's twelve values FROM PRODUCTION, seed them under 'phase4_production'
-- in a new migration, and activate that.

-- =====================================================================================
-- 4. Accessor -- fails loudly on an incomplete pin set
-- =====================================================================================

create or replace function plm.taxonomy_baseline_pin_set(
  p_baseline_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = plm, public
as $$
declare
  v_key text := coalesce(nullif(btrim(p_baseline_key), ''), plm.active_taxonomy_baseline_key());
  v_required constant text[] := array[
    'licensor_count', 'property_count', 'taxonomy_source_ref_count',
    'coldlion_source_ref_count', 'designflow_source_ref_count',
    'linked_licensor_count', 'linked_property_count',
    'licensor_uuid_hash', 'property_uuid_hash',
    'licensor_status_hash', 'property_status_hash', 'parent_edge_hash'
  ];
  v_pins jsonb;
  v_missing text[];
begin
  if v_key is null then
    raise exception
      'no taxonomy baseline is active on this database, and none was named explicitly'
      using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(
           p.metric_key,
           case p.metric_kind
             when 'count' then to_jsonb(p.expected_int)
             else to_jsonb(p.expected_text)
           end), '{}'::jsonb)
    into v_pins
  from plm.taxonomy_baseline_pin p
  where p.baseline_key = v_key
    and p.superseded_at is null;

  select array_agg(k order by k) into v_missing
  from unnest(v_required) as k
  where not (v_pins ? k);

  -- A missing pin must never read as "nothing to compare". Silence here would
  -- turn the entire baseline gate into a no-op that reports green.
  if v_missing is not null then
    raise exception
      'baseline % is incomplete: no live pin for %. Refusing to evaluate a partial baseline.',
      v_key, array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  return v_pins || jsonb_build_object('baseline_key', v_key);
end;
$$;

comment on function plm.taxonomy_baseline_pin_set(text) is
  'Returns the live expected baseline as jsonb (metric_key -> value), defaulting to the ACTIVE baseline. Raises if none is active, or if any expected metric has no live pin, so an incomplete baseline can never be mistaken for a passing one. Both detectors catch this raise and convert it into durable evidence.';

revoke all on function plm.taxonomy_baseline_pin_set(text) from public;
grant execute on function plm.taxonomy_baseline_pin_set(text) to service_role;

create or replace function api.taxonomy_baseline_pin_list(
  p_baseline_key text default 'phase4_preview',
  p_include_superseded boolean default false
)
returns setof plm.taxonomy_baseline_pin
language sql
stable
security definer
set search_path = api, plm, app
as $$
  select *
  from plm.taxonomy_baseline_pin
  where app.has_role('administrator')
    and baseline_key = coalesce(nullif(btrim(p_baseline_key), ''), 'phase4_preview')
    and (coalesce(p_include_superseded, false) or superseded_at is null)
  order by metric_key, effective_from desc;
$$;

comment on function api.taxonomy_baseline_pin_list(text, boolean) is
  'Admin-gated read of the Phase 6 baseline pins, including retired ones with their provenance.';

revoke all on function api.taxonomy_baseline_pin_list(text, boolean) from public;
grant execute on function api.taxonomy_baseline_pin_list(text, boolean) to authenticated, service_role;

-- =====================================================================================
-- 5. Health check -- reads the pin table; refuses when no baseline governs
-- =====================================================================================
--
-- Body is 20260726180000 section 6 verbatim except that the twelve `constant`
-- declarations are replaced by a single read of plm.taxonomy_baseline_pin_set().

create or replace function plm.check_taxonomy_sync_health(
  p_max_success_age interval default interval '36 hours',
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = plm, core, ingest, public
as $$
declare
  v_opts jsonb := coalesce(p_options, '{}'::jsonb);
  v_baseline_key text;
  v_pins jsonb;
  v_pin_error text;

  -- Deliberately NOT `constant`, and deliberately NOT initialised here. A raise in
  -- the DECLARE block happens outside every exception handler, before any
  -- sync_run, alert or observation can be written -- which is exactly the
  -- both-detectors-dark-with-no-evidence failure this guards against.
  c_expected_licensor_count integer;
  c_expected_property_count integer;
  c_expected_licensor_uuid_hash text;
  c_expected_property_uuid_hash text;
  c_expected_licensor_status_hash text;
  c_expected_property_status_hash text;
  c_expected_parent_edge_hash text;
  c_expected_taxonomy_source_ref_count integer;
  c_expected_coldlion_refs integer;
  c_expected_designflow_refs integer;
  c_expected_linked_licensors integer;
  c_expected_linked_properties integer;

  v_force_fail boolean := coalesce((v_opts ->> 'force_fail')::boolean, false);
  v_skip_alert boolean := coalesce((v_opts ->> 'skip_alert')::boolean, false);
  v_max_age interval := coalesce(p_max_success_age, interval '36 hours');
  v_is_drill boolean := v_force_fail;

  v_issues jsonb := '[]'::jsonb;
  v_ok boolean := true;
  v_snap jsonb;
  v_cl_latest ingest.sync_run%rowtype;
  v_df_latest ingest.sync_run%rowtype;
  v_cl_prev ingest.sync_run%rowtype;
  v_df_prev ingest.sync_run%rowtype;
  v_obs plm.taxonomy_parallel_observation%rowtype;
  v_alert_id uuid;
  v_health_run_id uuid;
  v_cl_failures integer := 0;
  v_df_failures integer := 0;
begin
  -- ------------------------------------------------------------------
  -- REFUSAL GATE: no baseline governs this database.
  -- Not a pass (a false green) and not a critical alert (a false red -- it would
  -- auto-trip the breaker for a configuration state, and on production that means
  -- tripping the lane over the FR divergence AGENTS.md 6.5 calls expected).
  -- A failed sync_run plus a WARNING alert: durable, visible, inert.
  -- ------------------------------------------------------------------
  v_baseline_key := coalesce(nullif(btrim(v_opts ->> 'baseline_key'), ''),
                             plm.active_taxonomy_baseline_key());

  if v_baseline_key is null then
    insert into ingest.sync_run (
      source_system, source_name, status, started_at, finished_at,
      rows_seen, rows_failed, error, metadata)
    values (
      'shared_db', 'coldlion_designflow_sync_health', 'failed'::ingest.sync_status,
      now(), now(), 1, 1,
      'phase6 health REFUSED: no active taxonomy baseline on this database',
      jsonb_build_object(
        'refused', true,
        'reason', 'no_active_baseline',
        'environment', plm.resolve_deployment_environment(),
        'remedy', 'derive this environment''s expected values FROM THIS DATABASE, seed them under their own baseline_key, then call plm.activate_taxonomy_baseline(...)'))
    returning id into v_health_run_id;

    -- One standing warning, not one per run: this is a configuration state that
    -- persists until somebody acts, and a daily repeat would bury the real alerts.
    if not v_skip_alert and not exists (
      select 1 from plm.taxonomy_sync_alert
      where source_name = 'coldlion_designflow_sync_health'
        and acknowledged_at is null
        and reason like 'refused: no active taxonomy baseline%'
    ) then
      v_alert_id := plm.record_taxonomy_sync_alert(
        'warning',
        'coldlion_designflow_sync_health',
        'refused: no active taxonomy baseline on this database -- the health check cannot report green or red until one is activated',
        v_health_run_id, null, (timezone('utc', now()))::date, false,
        jsonb_build_object('refused', true, 'reason', 'no_active_baseline',
                           'environment', plm.resolve_deployment_environment()));
    end if;

    return jsonb_build_object(
      'ok', false, 'refused', true, 'reason', 'no_active_baseline',
      'environment', plm.resolve_deployment_environment(),
      'health_run_id', v_health_run_id, 'alert_id', v_alert_id);
  end if;

  -- ------------------------------------------------------------------
  -- The baseline exists but may be UNREADABLE -- e.g. a pin superseded with no
  -- replacement. Fail CLOSED (critical => the lane auto-trips) and leave evidence,
  -- rather than raising out of the function and rolling back every trace that it
  -- ran at all.
  -- ------------------------------------------------------------------
  begin
    v_pins := plm.taxonomy_baseline_pin_set(v_baseline_key);
  exception when others then
    v_pin_error := left(sqlerrm, 2000);

    insert into ingest.sync_run (
      source_system, source_name, status, started_at, finished_at,
      rows_seen, rows_failed, error, metadata)
    values (
      'shared_db', 'coldlion_designflow_sync_health', 'failed'::ingest.sync_status,
      now(), now(), 1, 1,
      left('phase6 health BLIND: ' || v_pin_error, 4000),
      jsonb_build_object('baseline_unreadable', true, 'baseline_key', v_baseline_key,
                         'error', v_pin_error))
    returning id into v_health_run_id;

    if not v_skip_alert then
      v_alert_id := plm.record_taxonomy_sync_alert(
        'critical',
        'coldlion_designflow_sync_health',
        'baseline unreadable, health check is BLIND: ' || v_pin_error,
        v_health_run_id, null, (timezone('utc', now()))::date, false,
        jsonb_build_object('baseline_unreadable', true, 'baseline_key', v_baseline_key,
                           'failed_invariant', 'taxonomy_baseline_unreadable',
                           'error', v_pin_error));
    end if;

    return jsonb_build_object(
      'ok', false, 'baseline_unreadable', true, 'baseline_key', v_baseline_key,
      'error', v_pin_error, 'health_run_id', v_health_run_id, 'alert_id', v_alert_id);
  end;

  c_expected_licensor_count := (v_pins ->> 'licensor_count')::integer;
  c_expected_property_count := (v_pins ->> 'property_count')::integer;
  c_expected_licensor_uuid_hash := v_pins ->> 'licensor_uuid_hash';
  c_expected_property_uuid_hash := v_pins ->> 'property_uuid_hash';
  c_expected_licensor_status_hash := v_pins ->> 'licensor_status_hash';
  c_expected_property_status_hash := v_pins ->> 'property_status_hash';
  c_expected_parent_edge_hash := v_pins ->> 'parent_edge_hash';
  c_expected_taxonomy_source_ref_count := (v_pins ->> 'taxonomy_source_ref_count')::integer;
  c_expected_coldlion_refs := (v_pins ->> 'coldlion_source_ref_count')::integer;
  c_expected_designflow_refs := (v_pins ->> 'designflow_source_ref_count')::integer;
  c_expected_linked_licensors := (v_pins ->> 'linked_licensor_count')::integer;
  c_expected_linked_properties := (v_pins ->> 'linked_property_count')::integer;

  v_snap := plm.compute_taxonomy_immutability_snapshot();

  select * into v_cl_latest
  from ingest.sync_run
  where source_system = 'coldlion'
    and source_name = 'coldlion_licensors_properties_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  limit 1;

  select * into v_cl_prev
  from ingest.sync_run
  where source_system = 'coldlion'
    and source_name = 'coldlion_licensors_properties_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  offset 1
  limit 1;

  select * into v_df_latest
  from ingest.sync_run
  where source_system = 'designflow_plm'
    and source_name = 'plm_master_data_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  limit 1;

  select * into v_df_prev
  from ingest.sync_run
  where source_system = 'designflow_plm'
    and source_name = 'plm_master_data_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  offset 1
  limit 1;

  -- Gate uses most recent NON-DRILL daily observation only.
  select * into v_obs
  from plm.taxonomy_parallel_observation
  where is_drill = false
  order by observed_at desc
  limit 1;

  if v_cl_latest.id is null then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'missing_run', 'lane', 'coldlion'
    ));
  elsif v_cl_latest.status is distinct from 'succeeded' then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'failed_run', 'lane', 'coldlion',
      'run_id', v_cl_latest.id, 'status', v_cl_latest.status
    ));
  elsif coalesce(v_cl_latest.finished_at, v_cl_latest.started_at) < (now() - v_max_age) then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'stale_run', 'lane', 'coldlion',
      'run_id', v_cl_latest.id,
      'finished_at', v_cl_latest.finished_at,
      'max_age', v_max_age::text
    ));
  end if;

  if v_df_latest.id is null then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'missing_run', 'lane', 'designflow'
    ));
  elsif v_df_latest.status is distinct from 'succeeded' then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'failed_run', 'lane', 'designflow',
      'run_id', v_df_latest.id, 'status', v_df_latest.status
    ));
  elsif coalesce(v_df_latest.finished_at, v_df_latest.started_at) < (now() - v_max_age) then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'stale_run', 'lane', 'designflow',
      'run_id', v_df_latest.id,
      'finished_at', v_df_latest.finished_at,
      'max_age', v_max_age::text
    ));
  end if;

  if v_cl_latest.status is not distinct from 'failed'
     and v_cl_prev.status is not distinct from 'failed'
  then
    v_ok := false;
    v_cl_failures := 2;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'two_consecutive_failures', 'lane', 'coldlion'
    ));
  end if;

  if v_df_latest.status is not distinct from 'failed'
     and v_df_prev.status is not distinct from 'failed'
  then
    v_ok := false;
    v_df_failures := 2;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'two_consecutive_failures', 'lane', 'designflow'
    ));
  end if;

  -- Live baseline comparison (same pins as the daily comparison, now from data).
  if (v_snap ->> 'licensor_count')::integer is distinct from c_expected_licensor_count
     or (v_snap ->> 'property_count')::integer is distinct from c_expected_property_count
     or (v_snap ->> 'licensor_uuid_hash') is distinct from c_expected_licensor_uuid_hash
     or (v_snap ->> 'property_uuid_hash') is distinct from c_expected_property_uuid_hash
     or (v_snap ->> 'licensor_status_hash') is distinct from c_expected_licensor_status_hash
     or (v_snap ->> 'property_status_hash') is distinct from c_expected_property_status_hash
     or (v_snap ->> 'parent_edge_hash') is distinct from c_expected_parent_edge_hash
     or (v_snap ->> 'taxonomy_source_ref_count')::integer is distinct from c_expected_taxonomy_source_ref_count
     or (v_snap ->> 'coldlion_source_ref_count')::integer is distinct from c_expected_coldlion_refs
     or (v_snap ->> 'designflow_source_ref_count')::integer is distinct from c_expected_designflow_refs
     or (v_snap ->> 'linked_licensor_count')::integer is distinct from c_expected_linked_licensors
     or (v_snap ->> 'linked_property_count')::integer is distinct from c_expected_linked_properties
  then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'phase4_baseline_drift',
      'baseline_key', v_baseline_key,
      'coldlion_source_ref_count', (v_snap ->> 'coldlion_source_ref_count')::integer,
      'linked_licensor_count', (v_snap ->> 'linked_licensor_count')::integer,
      'linked_property_count', (v_snap ->> 'linked_property_count')::integer
    ));
  end if;

  if v_obs.id is not null
     and v_obs.pass is not true
     and v_obs.observation_date >= (timezone('utc', now()))::date - 1
  then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'recent_nondrill_observation_failed',
      'observation_id', v_obs.id,
      'observation_date', v_obs.observation_date,
      'unexplained_diff_count', v_obs.unexplained_diff_count
    ));
  end if;

  if v_force_fail then
    v_ok := false;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'kind', 'forced_failure_drill',
      'note', 'Distinct drill signal; does not rewrite non-drill observation evidence'
    ));
  end if;

  insert into ingest.sync_run (
    source_system, source_name, status, started_at, finished_at,
    rows_seen, rows_failed, error, metadata
  )
  values (
    'shared_db',
    'coldlion_designflow_sync_health',
    case when v_ok then 'succeeded'::ingest.sync_status else 'failed'::ingest.sync_status end,
    now(),
    now(),
    1,
    case when v_ok then 0 else jsonb_array_length(v_issues) end,
    case when v_ok then null else left('phase6 health failed: ' || jsonb_array_length(v_issues)::text || ' issue(s)', 4000) end,
    jsonb_build_object(
      'ok', v_ok,
      'is_drill', v_is_drill,
      'issues', v_issues,
      'force_fail', v_force_fail,
      'max_success_age', v_max_age::text,
      'baseline_key', v_baseline_key,
      'latest_nondrill_observation_id', v_obs.id,
      'coldlion_consecutive_failures', v_cl_failures,
      'designflow_consecutive_failures', v_df_failures
    )
  )
  returning id into v_health_run_id;

  if not v_ok and not v_skip_alert then
    v_alert_id := plm.record_taxonomy_sync_alert(
      'critical',
      'coldlion_designflow_sync_health',
      case
        when v_force_fail then 'forced_failure_drill'
        else 'sync health check failed with ' || jsonb_array_length(v_issues)::text || ' issue(s)'
      end,
      v_health_run_id,
      case when v_obs.is_drill is not true then v_obs.id else null end,
      v_obs.observation_date,
      v_is_drill,
      jsonb_build_object(
        'ok', v_ok,
        'is_drill', v_is_drill,
        'issues', v_issues,
        'force_fail', v_force_fail,
        'baseline_key', v_baseline_key,
        'latest_nondrill_observation_id', v_obs.id
      )
    );
  end if;

  return jsonb_build_object(
    'ok', v_ok,
    'is_drill', v_is_drill,
    'issues', v_issues,
    'health_run_id', v_health_run_id,
    'alert_id', v_alert_id,
    'baseline_key', v_baseline_key,
    'baseline_pins', v_pins,
    'latest_nondrill_observation_id', v_obs.id,
    'coldlion_run_id', v_cl_latest.id,
    'designflow_run_id', v_df_latest.id,
    'coldlion_source_ref_count', (v_snap ->> 'coldlion_source_ref_count')::integer,
    'linked_licensor_count', (v_snap ->> 'linked_licensor_count')::integer,
    'linked_property_count', (v_snap ->> 'linked_property_count')::integer,
    'force_fail', v_force_fail
  );
end;
$$;

comment on function plm.check_taxonomy_sync_health(interval, jsonb) is
  'Phase 6 health. Expected baseline read from plm.taxonomy_baseline_pin (was compiled-in constants in 20260726180000), and only when a baseline is ACTIVE on this database -- otherwise it refuses with a failed sync_run and a warning alert rather than passing or tripping. Evaluates latest NON-DRILL observation for the 14-day gate. force_fail records a distinct drill alert without overwriting daily evidence.';

-- =====================================================================================
-- 6. Daily comparison -- same substitution, same refusal gate
-- =====================================================================================

create or replace function plm.record_taxonomy_parallel_observation(
  p_observation_date date default (timezone('utc', now()))::date,
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = plm, core, ingest, public
as $$
declare
  v_opts jsonb := coalesce(p_options, '{}'::jsonb);
  v_baseline_key text;
  v_pins jsonb;
  v_pin_error text;

  -- Not `constant`, not initialised here -- see the identical note in
  -- plm.check_taxonomy_sync_health above.
  c_expected_licensor_count integer;
  c_expected_property_count integer;
  c_expected_licensor_uuid_hash text;
  c_expected_property_uuid_hash text;
  c_expected_licensor_status_hash text;
  c_expected_property_status_hash text;
  c_expected_parent_edge_hash text;
  c_expected_taxonomy_source_ref_count integer;
  c_expected_coldlion_refs integer;
  c_expected_designflow_refs integer;
  c_expected_linked_licensors integer;
  c_expected_linked_properties integer;

  v_day date := coalesce(p_observation_date, (timezone('utc', now()))::date);
  v_max_age interval := coalesce(
    nullif(v_opts ->> 'max_success_age', '')::interval,
    interval '36 hours'
  );
  v_force_fail boolean := coalesce((v_opts ->> 'force_fail')::boolean, false);
  v_skip_alert boolean := coalesce((v_opts ->> 'skip_alert')::boolean, false);
  v_is_drill boolean := v_force_fail;

  v_snap jsonb;
  v_prior plm.taxonomy_parallel_observation%rowtype;
  v_cl ingest.sync_run%rowtype;
  v_df ingest.sync_run%rowtype;

  v_baseline_ok boolean := true;
  v_coldlion_ok boolean := false;
  v_designflow_ok boolean := false;
  v_links_ok boolean := false;
  v_immutability_ok boolean := true;
  v_pass boolean := false;
  v_unexplained integer := 0;
  v_details jsonb := '{}'::jsonb;
  v_diffs jsonb := '[]'::jsonb;
  v_cmp_run_id uuid;
  v_obs_id uuid;
  v_alert_id uuid;
  v_result jsonb;
begin
  -- REFUSAL GATE -- see the same block in plm.check_taxonomy_sync_health.
  -- No observation row is written, so the failed-observation auto-trip trigger
  -- from 20260728134500 cannot fire on a configuration state either.
  v_baseline_key := coalesce(nullif(btrim(v_opts ->> 'baseline_key'), ''),
                             plm.active_taxonomy_baseline_key());

  if v_baseline_key is null then
    insert into ingest.sync_run (
      source_system, source_name, status, started_at, finished_at,
      rows_seen, rows_failed, error, metadata)
    values (
      'shared_db', 'coldlion_designflow_daily_comparison', 'failed'::ingest.sync_status,
      now(), now(), 1, 1,
      'phase6 comparison REFUSED: no active taxonomy baseline on this database',
      jsonb_build_object(
        'refused', true,
        'reason', 'no_active_baseline',
        'observation_date', v_day,
        'environment', plm.resolve_deployment_environment()))
    returning id into v_cmp_run_id;

    if not v_skip_alert and not exists (
      select 1 from plm.taxonomy_sync_alert
      where source_name = 'coldlion_designflow_daily_comparison'
        and acknowledged_at is null
        and reason like 'refused: no active taxonomy baseline%'
    ) then
      v_alert_id := plm.record_taxonomy_sync_alert(
        'warning',
        'coldlion_designflow_daily_comparison',
        'refused: no active taxonomy baseline on this database -- no observation was recorded',
        v_cmp_run_id, null, v_day, false,
        jsonb_build_object('refused', true, 'reason', 'no_active_baseline',
                           'environment', plm.resolve_deployment_environment()));
    end if;

    return jsonb_build_object(
      'refused', true, 'reason', 'no_active_baseline', 'pass', false,
      'observation_date', v_day,
      'environment', plm.resolve_deployment_environment(),
      'comparison_run_id', v_cmp_run_id, 'alert_id', v_alert_id);
  end if;

  begin
    v_pins := plm.taxonomy_baseline_pin_set(v_baseline_key);
  exception when others then
    v_pin_error := left(sqlerrm, 2000);

    insert into ingest.sync_run (
      source_system, source_name, status, started_at, finished_at,
      rows_seen, rows_failed, error, metadata)
    values (
      'shared_db', 'coldlion_designflow_daily_comparison', 'failed'::ingest.sync_status,
      now(), now(), 1, 1,
      left('phase6 comparison BLIND: ' || v_pin_error, 4000),
      jsonb_build_object('baseline_unreadable', true, 'baseline_key', v_baseline_key,
                         'observation_date', v_day, 'error', v_pin_error))
    returning id into v_cmp_run_id;

    if not v_skip_alert then
      v_alert_id := plm.record_taxonomy_sync_alert(
        'critical',
        'coldlion_designflow_daily_comparison',
        'baseline unreadable, daily comparison is BLIND: ' || v_pin_error,
        v_cmp_run_id, null, v_day, false,
        jsonb_build_object('baseline_unreadable', true, 'baseline_key', v_baseline_key,
                           'failed_invariant', 'taxonomy_baseline_unreadable',
                           'error', v_pin_error));
    end if;

    return jsonb_build_object(
      'pass', false, 'baseline_unreadable', true, 'baseline_key', v_baseline_key,
      'error', v_pin_error, 'observation_date', v_day,
      'comparison_run_id', v_cmp_run_id, 'alert_id', v_alert_id);
  end;

  c_expected_licensor_count := (v_pins ->> 'licensor_count')::integer;
  c_expected_property_count := (v_pins ->> 'property_count')::integer;
  c_expected_licensor_uuid_hash := v_pins ->> 'licensor_uuid_hash';
  c_expected_property_uuid_hash := v_pins ->> 'property_uuid_hash';
  c_expected_licensor_status_hash := v_pins ->> 'licensor_status_hash';
  c_expected_property_status_hash := v_pins ->> 'property_status_hash';
  c_expected_parent_edge_hash := v_pins ->> 'parent_edge_hash';
  c_expected_taxonomy_source_ref_count := (v_pins ->> 'taxonomy_source_ref_count')::integer;
  c_expected_coldlion_refs := (v_pins ->> 'coldlion_source_ref_count')::integer;
  c_expected_designflow_refs := (v_pins ->> 'designflow_source_ref_count')::integer;
  c_expected_linked_licensors := (v_pins ->> 'linked_licensor_count')::integer;
  c_expected_linked_properties := (v_pins ->> 'linked_property_count')::integer;

  -- Live snapshot (never from caller).
  v_snap := plm.compute_taxonomy_immutability_snapshot();

  select * into v_cl
  from ingest.sync_run
  where source_system = 'coldlion'
    and source_name = 'coldlion_licensors_properties_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  limit 1;

  select * into v_df
  from ingest.sync_run
  where source_system = 'designflow_plm'
    and source_name = 'plm_master_data_api'
  order by coalesce(finished_at, started_at, created_at) desc nulls last
  limit 1;

  -- Prior for day-over-day: most recent NON-DRILL observation (never a drill).
  select * into v_prior
  from plm.taxonomy_parallel_observation
  where is_drill = false
    and observation_date <= v_day
  order by observed_at desc
  limit 1;

  -- ------------------------------------------------------------------
  -- Baseline pins (always; first day included)
  -- ------------------------------------------------------------------
  if (v_snap ->> 'licensor_count')::integer is distinct from c_expected_licensor_count
     or (v_snap ->> 'property_count')::integer is distinct from c_expected_property_count
     or (v_snap ->> 'licensor_uuid_hash') is distinct from c_expected_licensor_uuid_hash
     or (v_snap ->> 'property_uuid_hash') is distinct from c_expected_property_uuid_hash
     or (v_snap ->> 'licensor_status_hash') is distinct from c_expected_licensor_status_hash
     or (v_snap ->> 'property_status_hash') is distinct from c_expected_property_status_hash
     or (v_snap ->> 'parent_edge_hash') is distinct from c_expected_parent_edge_hash
     or (v_snap ->> 'taxonomy_source_ref_count')::integer is distinct from c_expected_taxonomy_source_ref_count
     or (v_snap ->> 'coldlion_source_ref_count')::integer is distinct from c_expected_coldlion_refs
     or (v_snap ->> 'designflow_source_ref_count')::integer is distinct from c_expected_designflow_refs
     or (v_snap ->> 'linked_licensor_count')::integer is distinct from c_expected_linked_licensors
     or (v_snap ->> 'linked_property_count')::integer is distinct from c_expected_linked_properties
  then
    v_baseline_ok := false;
    v_unexplained := v_unexplained + 1;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'kind', 'phase4_baseline_drift',
      'baseline_key', v_baseline_key,
      'expected', jsonb_build_object(
        'licensor_count', c_expected_licensor_count,
        'property_count', c_expected_property_count,
        'licensor_uuid_hash', c_expected_licensor_uuid_hash,
        'property_uuid_hash', c_expected_property_uuid_hash,
        'licensor_status_hash', c_expected_licensor_status_hash,
        'property_status_hash', c_expected_property_status_hash,
        'parent_edge_hash', c_expected_parent_edge_hash,
        'taxonomy_source_ref_count', c_expected_taxonomy_source_ref_count,
        'coldlion_source_ref_count', c_expected_coldlion_refs,
        'designflow_source_ref_count', c_expected_designflow_refs,
        'linked_licensor_count', c_expected_linked_licensors,
        'linked_property_count', c_expected_linked_properties
      ),
      'actual', jsonb_build_object(
        'licensor_count', (v_snap ->> 'licensor_count')::integer,
        'property_count', (v_snap ->> 'property_count')::integer,
        'licensor_uuid_hash', v_snap ->> 'licensor_uuid_hash',
        'property_uuid_hash', v_snap ->> 'property_uuid_hash',
        'licensor_status_hash', v_snap ->> 'licensor_status_hash',
        'property_status_hash', v_snap ->> 'property_status_hash',
        'parent_edge_hash', v_snap ->> 'parent_edge_hash',
        'taxonomy_source_ref_count', (v_snap ->> 'taxonomy_source_ref_count')::integer,
        'coldlion_source_ref_count', (v_snap ->> 'coldlion_source_ref_count')::integer,
        'designflow_source_ref_count', (v_snap ->> 'designflow_source_ref_count')::integer,
        'linked_licensor_count', (v_snap ->> 'linked_licensor_count')::integer,
        'linked_property_count', (v_snap ->> 'linked_property_count')::integer
      )
    ));
  end if;

  -- Link pins (subset of baseline; kept for explicit diffs).
  v_links_ok :=
    (v_snap ->> 'coldlion_source_ref_count')::integer = c_expected_coldlion_refs
    and (v_snap ->> 'linked_licensor_count')::integer = c_expected_linked_licensors
    and (v_snap ->> 'linked_property_count')::integer = c_expected_linked_properties
    and (v_snap ->> 'designflow_source_ref_count')::integer = c_expected_designflow_refs
    and (v_snap ->> 'taxonomy_source_ref_count')::integer = c_expected_taxonomy_source_ref_count;

  if not v_links_ok then
    v_unexplained := v_unexplained + 1;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'kind', 'link_drift',
      'expected_coldlion_refs', c_expected_coldlion_refs,
      'actual_coldlion_refs', (v_snap ->> 'coldlion_source_ref_count')::integer,
      'expected_linked_licensors', c_expected_linked_licensors,
      'actual_linked_licensors', (v_snap ->> 'linked_licensor_count')::integer,
      'expected_linked_properties', c_expected_linked_properties,
      'actual_linked_properties', (v_snap ->> 'linked_property_count')::integer
    ));
  end if;

  -- Lane freshness/status.
  if v_cl.id is not null
     and v_cl.status = 'succeeded'
     and coalesce(v_cl.finished_at, v_cl.started_at) >= (now() - v_max_age)
  then
    v_coldlion_ok := true;
  else
    v_unexplained := v_unexplained + 1;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'kind', 'coldlion_lane',
      'status', coalesce(v_cl.status::text, 'missing'),
      'run_id', v_cl.id,
      'finished_at', v_cl.finished_at,
      'max_age', v_max_age::text
    ));
  end if;

  if v_df.id is not null
     and v_df.status = 'succeeded'
     and coalesce(v_df.finished_at, v_df.started_at) >= (now() - v_max_age)
  then
    v_designflow_ok := true;
  else
    v_unexplained := v_unexplained + 1;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'kind', 'designflow_lane',
      'status', coalesce(v_df.status::text, 'missing'),
      'run_id', v_df.id,
      'finished_at', v_df.finished_at,
      'max_age', v_max_age::text
    ));
  end if;

  -- Day-over-day vs prior non-drill (additional to baseline pins).
  if v_prior.id is not null and v_prior.is_drill is not true then
    if v_prior.licensor_uuid_hash is distinct from (v_snap ->> 'licensor_uuid_hash')
       or v_prior.property_uuid_hash is distinct from (v_snap ->> 'property_uuid_hash')
       or v_prior.licensor_status_hash is distinct from (v_snap ->> 'licensor_status_hash')
       or v_prior.property_status_hash is distinct from (v_snap ->> 'property_status_hash')
       or v_prior.parent_edge_hash is distinct from (v_snap ->> 'parent_edge_hash')
       or v_prior.source_ref_hash is distinct from (v_snap ->> 'source_ref_hash')
       or v_prior.coldlion_source_ref_count is distinct from (v_snap ->> 'coldlion_source_ref_count')::integer
       or v_prior.linked_licensor_count is distinct from (v_snap ->> 'linked_licensor_count')::integer
       or v_prior.linked_property_count is distinct from (v_snap ->> 'linked_property_count')::integer
    then
      v_immutability_ok := false;
      v_unexplained := v_unexplained + 1;
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
        'kind', 'prior_nondrill_drift',
        'prior_observation_id', v_prior.id,
        'prior_observation_date', v_prior.observation_date
      ));
    end if;
  end if;

  if v_force_fail then
    v_unexplained := v_unexplained + 1;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'kind', 'forced_failure_drill',
      'note', 'Append-only drill evidence; does not overwrite non-drill daily rows; no canonical mutation'
    ));
  end if;

  v_pass := v_baseline_ok
        and v_coldlion_ok
        and v_designflow_ok
        and v_links_ok
        and v_immutability_ok
        and not v_force_fail
        and v_unexplained = 0;

  v_details := jsonb_build_object(
    'snapshot', v_snap,
    'max_success_age', v_max_age::text,
    'is_drill', v_is_drill,
    'baseline_key', v_baseline_key,
    'baseline_source', 'plm.taxonomy_baseline_pin',
    'phase4_baseline', jsonb_build_object(
      'licensor_count', c_expected_licensor_count,
      'property_count', c_expected_property_count,
      'licensor_uuid_hash', c_expected_licensor_uuid_hash,
      'property_uuid_hash', c_expected_property_uuid_hash,
      'licensor_status_hash', c_expected_licensor_status_hash,
      'property_status_hash', c_expected_property_status_hash,
      'parent_edge_hash', c_expected_parent_edge_hash,
      'taxonomy_source_ref_count', c_expected_taxonomy_source_ref_count,
      'coldlion_source_ref_count', c_expected_coldlion_refs,
      'designflow_source_ref_count', c_expected_designflow_refs,
      'linked_licensors', c_expected_linked_licensors,
      'linked_properties', c_expected_linked_properties
    ),
    'diffs', v_diffs,
    'force_fail', v_force_fail,
    'phase', '6A',
    'recorded_by', 'plm.record_taxonomy_parallel_observation',
    'append_only', true
  );

  insert into ingest.sync_run (
    source_system, source_name, status, started_at, finished_at, rows_seen,
    rows_failed, error, metadata
  )
  values (
    'shared_db',
    'coldlion_designflow_daily_comparison',
    case when v_pass then 'succeeded'::ingest.sync_status else 'failed'::ingest.sync_status end,
    now(),
    now(),
    1,
    case when v_pass then 0 else greatest(v_unexplained, 1) end,
    case when v_pass then null else left('phase6 comparison failed: ' || v_unexplained::text || ' unexplained', 4000) end,
    jsonb_build_object(
      'observation_date', v_day,
      'pass', v_pass,
      'is_drill', v_is_drill,
      'baseline_key', v_baseline_key,
      'unexplained_diff_count', v_unexplained,
      'coldlion_run_id', v_cl.id,
      'designflow_run_id', v_df.id
    )
  )
  returning id into v_cmp_run_id;

  -- APPEND-ONLY: always INSERT a new row. Never UPDATE / ON CONFLICT.
  insert into plm.taxonomy_parallel_observation (
    observation_date, observed_at, is_drill,
    coldlion_run_id, coldlion_run_status, coldlion_run_finished_at,
    designflow_run_id, designflow_run_status, designflow_run_finished_at,
    comparison_run_id,
    licensor_count, property_count, taxonomy_source_ref_count,
    coldlion_source_ref_count, designflow_source_ref_count,
    linked_licensor_count, linked_property_count, open_review_count,
    licensor_uuid_hash, property_uuid_hash, licensor_status_hash,
    property_status_hash, status_hash, parent_edge_hash, source_ref_hash,
    coldlion_mirror_key_hash,
    prior_observation_id, prior_observation_date,
    prior_licensor_uuid_hash, prior_property_uuid_hash,
    prior_licensor_status_hash, prior_property_status_hash,
    prior_status_hash, prior_parent_edge_hash, prior_source_ref_hash,
    prior_coldlion_source_ref_count, prior_linked_licensor_count,
    prior_linked_property_count,
    baseline_ok, coldlion_ok, designflow_ok, immutability_ok, links_ok, pass,
    unexplained_diff_count, details
  )
  values (
    v_day,
    now(),
    v_is_drill,
    v_cl.id,
    v_cl.status::text,
    v_cl.finished_at,
    v_df.id,
    v_df.status::text,
    v_df.finished_at,
    v_cmp_run_id,
    (v_snap ->> 'licensor_count')::integer,
    (v_snap ->> 'property_count')::integer,
    (v_snap ->> 'taxonomy_source_ref_count')::integer,
    (v_snap ->> 'coldlion_source_ref_count')::integer,
    (v_snap ->> 'designflow_source_ref_count')::integer,
    (v_snap ->> 'linked_licensor_count')::integer,
    (v_snap ->> 'linked_property_count')::integer,
    (v_snap ->> 'open_review_count')::integer,
    v_snap ->> 'licensor_uuid_hash',
    v_snap ->> 'property_uuid_hash',
    v_snap ->> 'licensor_status_hash',
    v_snap ->> 'property_status_hash',
    v_snap ->> 'status_hash',
    v_snap ->> 'parent_edge_hash',
    v_snap ->> 'source_ref_hash',
    v_snap ->> 'coldlion_mirror_key_hash',
    case when v_prior.is_drill is not true then v_prior.id else null end,
    case when v_prior.is_drill is not true then v_prior.observation_date else null end,
    case when v_prior.is_drill is not true then v_prior.licensor_uuid_hash else null end,
    case when v_prior.is_drill is not true then v_prior.property_uuid_hash else null end,
    case when v_prior.is_drill is not true then v_prior.licensor_status_hash else null end,
    case when v_prior.is_drill is not true then v_prior.property_status_hash else null end,
    case when v_prior.is_drill is not true then v_prior.status_hash else null end,
    case when v_prior.is_drill is not true then v_prior.parent_edge_hash else null end,
    case when v_prior.is_drill is not true then v_prior.source_ref_hash else null end,
    case when v_prior.is_drill is not true then v_prior.coldlion_source_ref_count else null end,
    case when v_prior.is_drill is not true then v_prior.linked_licensor_count else null end,
    case when v_prior.is_drill is not true then v_prior.linked_property_count else null end,
    v_baseline_ok,
    v_coldlion_ok,
    v_designflow_ok,
    v_immutability_ok,
    v_links_ok,
    v_pass,
    v_unexplained,
    v_details
  )
  returning id into v_obs_id;

  if not v_pass and not v_skip_alert then
    v_alert_id := plm.record_taxonomy_sync_alert(
      'critical',
      'coldlion_designflow_daily_comparison',
      case
        when v_force_fail then 'forced_failure_drill'
        else 'daily comparison failed with ' || v_unexplained::text || ' unexplained diff(s)'
      end,
      v_cmp_run_id,
      v_obs_id,
      v_day,
      v_is_drill,
      jsonb_build_object(
        'pass', v_pass,
        'is_drill', v_is_drill,
        'baseline_key', v_baseline_key,
        'unexplained_diff_count', v_unexplained,
        'diffs', v_diffs,
        'force_fail', v_force_fail,
        'observation_id', v_obs_id
      )
    );
  end if;

  v_result := jsonb_build_object(
    'observation_id', v_obs_id,
    'observation_date', v_day,
    'is_drill', v_is_drill,
    'pass', v_pass,
    'baseline_ok', v_baseline_ok,
    'baseline_key', v_baseline_key,
    'coldlion_ok', v_coldlion_ok,
    'designflow_ok', v_designflow_ok,
    'links_ok', v_links_ok,
    'immutability_ok', v_immutability_ok,
    'unexplained_diff_count', v_unexplained,
    'comparison_run_id', v_cmp_run_id,
    'alert_id', v_alert_id,
    'coldlion_run_id', v_cl.id,
    'designflow_run_id', v_df.id,
    'licensor_count', (v_snap ->> 'licensor_count')::integer,
    'property_count', (v_snap ->> 'property_count')::integer,
    'taxonomy_source_ref_count', (v_snap ->> 'taxonomy_source_ref_count')::integer,
    'coldlion_source_ref_count', (v_snap ->> 'coldlion_source_ref_count')::integer,
    'designflow_source_ref_count', (v_snap ->> 'designflow_source_ref_count')::integer,
    'linked_licensor_count', (v_snap ->> 'linked_licensor_count')::integer,
    'linked_property_count', (v_snap ->> 'linked_property_count')::integer,
    'licensor_uuid_hash', v_snap ->> 'licensor_uuid_hash',
    'property_uuid_hash', v_snap ->> 'property_uuid_hash',
    'licensor_status_hash', v_snap ->> 'licensor_status_hash',
    'property_status_hash', v_snap ->> 'property_status_hash',
    'status_hash', v_snap ->> 'status_hash',
    'parent_edge_hash', v_snap ->> 'parent_edge_hash',
    'source_ref_hash', v_snap ->> 'source_ref_hash',
    'diffs', v_diffs
  );

  return v_result;
end;
$$;

comment on function plm.record_taxonomy_parallel_observation(date, jsonb) is
  'Phase 6 daily comparison. APPEND-ONLY insert (uuid PK). Expected baseline read from plm.taxonomy_baseline_pin, and only when a baseline is ACTIVE on this database -- otherwise it refuses without writing an observation row, so no auto-trip fires on a configuration state. force_fail inserts is_drill=true without overwriting non-drill evidence. Live hashes only.';

-- =====================================================================================
-- 7. Grants
-- =====================================================================================
--
-- Enumerated from pg_proc.proacl on preview immediately before this migration, and
-- identical after it:
--   plm.check_taxonomy_sync_health            postgres=X/postgres ; service_role=X/postgres
--   plm.record_taxonomy_parallel_observation  postgres=X/postgres ; service_role=X/postgres
--
-- WHY THESE STATEMENTS ARE HERE -- and it is NOT because `create or replace
-- function` drops grants. It does not: replacing a function preserves its owner
-- and its ACL. The two real reasons are specific:
--
--   1. AGENTS.md 10.2 -- the event trigger lock_down_new_public_function_execute_trg
--      fires on every CREATE FUNCTION in schema `public` and revokes EXECUTE from
--      PUBLIC and `anon`. `create or replace` reports the CREATE FUNCTION tag, so
--      it re-strips them every time. Anything in `public` that must stay callable
--      has to be re-granted AFTER the create. (It never touches `authenticated`.)
--   2. 20260804120100 genuinely DROPs and re-creates
--      plm/public.trip_taxonomy_circuit_breaker to add a ninth parameter. A DROP
--      does discard the ACL, and that file re-grants accordingly.
--
-- Re-asserting here is cheap and makes this file state its own intended permission
-- surface rather than leaving a reader to infer it.

revoke all on function plm.check_taxonomy_sync_health(interval, jsonb) from public;
revoke all on function plm.check_taxonomy_sync_health(interval, jsonb) from anon, authenticated;
grant execute on function plm.check_taxonomy_sync_health(interval, jsonb) to service_role;

revoke all on function plm.record_taxonomy_parallel_observation(date, jsonb) from public;
revoke all on function plm.record_taxonomy_parallel_observation(date, jsonb) from anon, authenticated;
grant execute on function plm.record_taxonomy_parallel_observation(date, jsonb) to service_role;

-- The public.* wrappers from 20260726180000 lines 784-794 and 1064-1074 are thin
-- `language sql` delegators -- they hold no copy of the baseline, so replacing the
-- plm.* functions above fixes them too. They are NOT re-created here, so 10.2's
-- trigger does not fire on them; re-asserted for completeness.
revoke all on function public.check_taxonomy_sync_health(interval, jsonb) from public;
revoke all on function public.check_taxonomy_sync_health(interval, jsonb) from anon, authenticated;
grant execute on function public.check_taxonomy_sync_health(interval, jsonb) to service_role;

revoke all on function public.record_taxonomy_parallel_observation(date, jsonb) from public;
revoke all on function public.record_taxonomy_parallel_observation(date, jsonb) from anon, authenticated;
grant execute on function public.record_taxonomy_parallel_observation(date, jsonb) to service_role;
