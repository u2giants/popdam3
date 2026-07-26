-- Phase 6A: ColdLion licensor/property parallel-run machinery (preview first).
--
-- Additive only. Does NOT:
--   * schedule production jobs
--   * create/promote canonical rows
--   * link NASA or alter the 542 Phase 4 approved ColdLion links
--   * change canonical UUID/name/code/status/parent fields
--
-- Evidence integrity (post-GLM/Codex review):
--   * Every comparison attempt is APPEND-ONLY (uuid PK; never UPDATE/upsert).
--   * Forced-failure drills insert distinct is_drill=true rows and never overwrite
--     same-day successful daily evidence.
--   * Every observation (including the first) is pinned against the known Phase 4
--     preview baseline hashes/counts — never a silent post-drift first baseline.
--   * All live hashes/counts are computed inside SECURITY DEFINER SQL; callers
--     supply none.

-- =====================================================================================
-- 1. Append-only observation evidence (UUID PK; many rows per observation_date)
-- =====================================================================================

create table if not exists plm.taxonomy_parallel_observation (
  id uuid primary key default gen_random_uuid(),
  observation_date date not null,
  observed_at timestamptz not null default now(),
  is_drill boolean not null default false,
  coldlion_run_id uuid references ingest.sync_run(id) on delete set null,
  coldlion_run_status text,
  coldlion_run_finished_at timestamptz,
  designflow_run_id uuid references ingest.sync_run(id) on delete set null,
  designflow_run_status text,
  designflow_run_finished_at timestamptz,
  comparison_run_id uuid references ingest.sync_run(id) on delete set null,
  licensor_count integer not null check (licensor_count >= 0),
  property_count integer not null check (property_count >= 0),
  taxonomy_source_ref_count integer not null check (taxonomy_source_ref_count >= 0),
  coldlion_source_ref_count integer not null check (coldlion_source_ref_count >= 0),
  designflow_source_ref_count integer not null check (designflow_source_ref_count >= 0),
  linked_licensor_count integer not null check (linked_licensor_count >= 0),
  linked_property_count integer not null check (linked_property_count >= 0),
  open_review_count integer not null default 0 check (open_review_count >= 0),
  licensor_uuid_hash text not null,
  property_uuid_hash text not null,
  licensor_status_hash text not null,
  property_status_hash text not null,
  status_hash text not null,
  parent_edge_hash text not null,
  source_ref_hash text not null,
  coldlion_mirror_key_hash text not null,
  prior_observation_id uuid,
  prior_observation_date date,
  prior_licensor_uuid_hash text,
  prior_property_uuid_hash text,
  prior_licensor_status_hash text,
  prior_property_status_hash text,
  prior_status_hash text,
  prior_parent_edge_hash text,
  prior_source_ref_hash text,
  prior_coldlion_source_ref_count integer,
  prior_linked_licensor_count integer,
  prior_linked_property_count integer,
  baseline_ok boolean not null,
  coldlion_ok boolean not null,
  designflow_ok boolean not null,
  immutability_ok boolean not null,
  links_ok boolean not null,
  pass boolean not null,
  unexplained_diff_count integer not null default 0 check (unexplained_diff_count >= 0),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint plm_taxonomy_parallel_observation_prior_fk
    foreign key (prior_observation_id)
    references plm.taxonomy_parallel_observation(id)
    on delete set null
);

comment on table plm.taxonomy_parallel_observation is
  'Phase 6 APPEND-ONLY parallel-run evidence. UUID primary key; never updated after insert. Multiple rows may share observation_date (e.g. daily pass + forced-failure drill). is_drill=true rows are excluded from the 14-day gate. Hashes/counts computed live in SQL; Phase 4 baseline pins apply to every non-drill row.';

create index if not exists plm_taxonomy_parallel_observation_date_idx
  on plm.taxonomy_parallel_observation (observation_date desc, observed_at desc);

create index if not exists plm_taxonomy_parallel_observation_pass_idx
  on plm.taxonomy_parallel_observation (pass, observation_date desc)
  where is_drill = false;

create index if not exists plm_taxonomy_parallel_observation_nondrill_idx
  on plm.taxonomy_parallel_observation (observed_at desc)
  where is_drill = false;

create index if not exists plm_taxonomy_parallel_observation_observed_idx
  on plm.taxonomy_parallel_observation (observed_at desc);

-- =====================================================================================
-- 2. Durable alerts (reference immutable observation row id)
-- =====================================================================================

create table if not exists plm.taxonomy_sync_alert (
  id uuid primary key default gen_random_uuid(),
  fired_at timestamptz not null default now(),
  severity text not null
    check (severity in ('info', 'warning', 'critical')),
  source_name text not null,
  reason text not null,
  related_run_id uuid references ingest.sync_run(id) on delete set null,
  observation_id uuid references plm.taxonomy_parallel_observation(id) on delete set null,
  observation_date date,
  is_drill boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by text,
  created_at timestamptz not null default now()
);

comment on table plm.taxonomy_sync_alert is
  'Phase 6 durable alert ledger. observation_id points at the append-only evidence row that triggered the alert (including drills). No secrets/raw API payloads.';

create index if not exists plm_taxonomy_sync_alert_open_idx
  on plm.taxonomy_sync_alert (fired_at desc)
  where acknowledged_at is null;

create index if not exists plm_taxonomy_sync_alert_source_idx
  on plm.taxonomy_sync_alert (source_name, fired_at desc);

create index if not exists plm_taxonomy_sync_alert_observation_idx
  on plm.taxonomy_sync_alert (observation_id);

-- RLS: service_role writes; authenticated administrators may select via api.* functions.
alter table plm.taxonomy_parallel_observation enable row level security;
alter table plm.taxonomy_sync_alert enable row level security;

drop policy if exists plm_taxonomy_parallel_observation_admin_select
  on plm.taxonomy_parallel_observation;
create policy plm_taxonomy_parallel_observation_admin_select
  on plm.taxonomy_parallel_observation
  for select
  to authenticated
  using (app.has_role('administrator'));

drop policy if exists plm_taxonomy_sync_alert_admin_select
  on plm.taxonomy_sync_alert;
create policy plm_taxonomy_sync_alert_admin_select
  on plm.taxonomy_sync_alert
  for select
  to authenticated
  using (app.has_role('administrator'));

grant select on plm.taxonomy_parallel_observation, plm.taxonomy_sync_alert
  to authenticated;
grant all on plm.taxonomy_parallel_observation, plm.taxonomy_sync_alert
  to service_role;

-- =====================================================================================
-- 3. Live immutability snapshot (hashes always from tables — not caller input)
-- =====================================================================================

create or replace function plm.compute_taxonomy_immutability_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = plm, core, ingest, public
as $$
  select jsonb_build_object(
    'captured_at', clock_timestamp(),
    'licensor_count', (select count(*)::integer from core.licensor),
    'property_count', (select count(*)::integer from core.property),
    'licensor_uuid_hash', (
      select md5(coalesce(string_agg(id::text, '|' order by id::text), ''))
      from core.licensor
    ),
    'property_uuid_hash', (
      select md5(coalesce(string_agg(id::text, '|' order by id::text), ''))
      from core.property
    ),
    -- Separate status hashes (directly comparable to Phase 4 evidence).
    'licensor_status_hash', (
      select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), ''))
      from core.licensor
    ),
    'property_status_hash', (
      select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), ''))
      from core.property
    ),
    -- Combined status hash (Phase 2B encoding) kept for continuity.
    'status_hash', (
      select md5(coalesce(string_agg(v, '|' order by v), ''))
      from (
        select 'licensor|' || id::text || '|' || status::text as v from core.licensor
        union all
        select 'property|' || id::text || '|' || status::text as v from core.property
      ) s
    ),
    'parent_edge_hash', (
      select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), ''))
      from core.property
    ),
    'source_ref_hash', (
      select md5(coalesce(string_agg(
        concat_ws('|', source_system, source_table, source_id, coalesce(source_code, ''),
                  entity_schema, entity_table, entity_id::text),
        '|' order by source_system, source_table, source_id, entity_table, entity_id::text
      ), ''))
      from core.taxonomy_source_ref
    ),
    'taxonomy_source_ref_count', (
      select count(*)::integer from core.taxonomy_source_ref
    ),
    'coldlion_source_ref_count', (
      select count(*)::integer
      from core.taxonomy_source_ref
      where source_system = 'coldlion'
        and source_table = 'merchGroupDetails'
    ),
    'designflow_source_ref_count', (
      select count(*)::integer
      from core.taxonomy_source_ref
      where source_system = 'designflow_plm'
    ),
    'linked_licensor_count', (
      select count(*)::integer from plm.erp_licensor where licensor_id is not null
    ),
    'linked_property_count', (
      select count(*)::integer from plm.erp_property where property_id is not null
    ),
    'mirror_licensor_count', (select count(*)::integer from plm.erp_licensor),
    'mirror_property_count', (select count(*)::integer from plm.erp_property),
    'coldlion_mirror_key_hash', (
      select md5(coalesce(string_agg(k, '|' order by k), ''))
      from (
        select concat_ws('|', 'L', company_code, division_code, mg_type_code, mg_code,
                         coalesce(licensor_id::text, ''), coalesce(resolution_status, '')) as k
        from plm.erp_licensor
        union all
        select concat_ws('|', 'P', company_code, division_code, mg_type_code, mg_code,
                         coalesce(property_id::text, ''), coalesce(resolution_status, '')) as k
        from plm.erp_property
      ) m
    ),
    'open_review_count', (
      select count(*)::integer
      from plm.taxonomy_resolution_review
      where status in ('open', 'quarantined', 'conflict')
    )
  );
$$;

comment on function plm.compute_taxonomy_immutability_snapshot() is
  'Read-only live snapshot including separate licensor/property status hashes (Phase 4 comparable) plus combined status_hash. Callers never supply hashes.';

revoke all on function plm.compute_taxonomy_immutability_snapshot() from public;
grant execute on function plm.compute_taxonomy_immutability_snapshot() to service_role;

-- =====================================================================================
-- 4. Alert writer
-- =====================================================================================

create or replace function plm.record_taxonomy_sync_alert(
  p_severity text,
  p_source_name text,
  p_reason text,
  p_related_run_id uuid default null,
  p_observation_id uuid default null,
  p_observation_date date default null,
  p_is_drill boolean default false,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = plm, ingest, public
as $$
declare
  v_id uuid;
  v_severity text := lower(coalesce(nullif(btrim(p_severity), ''), 'critical'));
  v_source text := coalesce(nullif(btrim(p_source_name), ''), 'taxonomy_parallel_run');
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'unspecified'), 4000);
begin
  if v_severity not in ('info', 'warning', 'critical') then
    raise exception 'invalid alert severity %', v_severity;
  end if;

  insert into plm.taxonomy_sync_alert (
    severity, source_name, reason, related_run_id,
    observation_id, observation_date, is_drill, payload
  )
  values (
    v_severity,
    v_source,
    v_reason,
    p_related_run_id,
    p_observation_id,
    p_observation_date,
    coalesce(p_is_drill, false),
    coalesce(p_payload, '{}'::jsonb) - 'api_key' - 'password' - 'token' - 'secret'
  )
  returning id into v_id;

  perform pg_notify(
    'coldlion_sync_alert',
    v_source || ': ' || left(v_reason, 200)
  );

  return v_id;
end;
$$;

comment on function plm.record_taxonomy_sync_alert(text, text, text, uuid, uuid, date, boolean, jsonb) is
  'Durable Phase 6 alert insert + pg_notify. observation_id references append-only evidence. service_role only.';

revoke all on function plm.record_taxonomy_sync_alert(text, text, text, uuid, uuid, date, boolean, jsonb)
  from public;
grant execute on function plm.record_taxonomy_sync_alert(text, text, text, uuid, uuid, date, boolean, jsonb)
  to service_role;

create or replace function public.record_taxonomy_sync_alert(
  p_severity text,
  p_source_name text,
  p_reason text,
  p_related_run_id uuid default null,
  p_observation_id uuid default null,
  p_observation_date date default null,
  p_is_drill boolean default false,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = public, plm
as $$
  select plm.record_taxonomy_sync_alert(
    p_severity, p_source_name, p_reason, p_related_run_id,
    p_observation_id, p_observation_date, p_is_drill, p_payload
  );
$$;

revoke all on function public.record_taxonomy_sync_alert(text, text, text, uuid, uuid, date, boolean, jsonb)
  from public;
revoke all on function public.record_taxonomy_sync_alert(text, text, text, uuid, uuid, date, boolean, jsonb)
  from anon, authenticated;
grant execute on function public.record_taxonomy_sync_alert(text, text, text, uuid, uuid, date, boolean, jsonb)
  to service_role;

-- =====================================================================================
-- 5. Daily comparison — live state + Phase 4 baseline pins; APPEND-ONLY insert
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
  -- Phase 4 preview baseline (committed apply 875109b5-… / evidence 20260725).
  -- Required on EVERY observation including the first — never establish a silent
  -- post-drift baseline from a missing prior row.
  c_expected_licensor_count constant integer := 26;
  c_expected_property_count constant integer := 256;
  c_expected_licensor_uuid_hash constant text := '590ea83ea6df1487fcfc1e18b3ef6a0d';
  c_expected_property_uuid_hash constant text := 'e0e6c36eb02bb2d320c0deaff7aa8f8c';
  c_expected_licensor_status_hash constant text := 'd9b07759bf80ff227e2fa9bd635d2138';
  c_expected_property_status_hash constant text := 'f436d4acd79761fedbfc9b5796ac7bce';
  c_expected_parent_edge_hash constant text := '7459f6826cc59468779e7ead33ec0edc';
  c_expected_taxonomy_source_ref_count constant integer := 1047;
  c_expected_coldlion_refs constant integer := 542;
  c_expected_designflow_refs constant integer := 505;
  c_expected_linked_licensors constant integer := 38;
  c_expected_linked_properties constant integer := 504;

  v_day date := coalesce(p_observation_date, (timezone('utc', now()))::date);
  v_opts jsonb := coalesce(p_options, '{}'::jsonb);
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
  -- Phase 4 baseline pins (always; first day included)
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
      'unexplained_diff_count', v_unexplained,
      'coldlion_run_id', v_cl.id,
      'designflow_run_id', v_df.id
    )
  )
  returning id into v_cmp_run_id;

  -- APPEND-ONLY: always INSERT a new row. Never UPDATE / ON CONFLICT.
  insert into plm.taxonomy_parallel_observation (
    observation_date,
    observed_at,
    is_drill,
    coldlion_run_id,
    coldlion_run_status,
    coldlion_run_finished_at,
    designflow_run_id,
    designflow_run_status,
    designflow_run_finished_at,
    comparison_run_id,
    licensor_count,
    property_count,
    taxonomy_source_ref_count,
    coldlion_source_ref_count,
    designflow_source_ref_count,
    linked_licensor_count,
    linked_property_count,
    open_review_count,
    licensor_uuid_hash,
    property_uuid_hash,
    licensor_status_hash,
    property_status_hash,
    status_hash,
    parent_edge_hash,
    source_ref_hash,
    coldlion_mirror_key_hash,
    prior_observation_id,
    prior_observation_date,
    prior_licensor_uuid_hash,
    prior_property_uuid_hash,
    prior_licensor_status_hash,
    prior_property_status_hash,
    prior_status_hash,
    prior_parent_edge_hash,
    prior_source_ref_hash,
    prior_coldlion_source_ref_count,
    prior_linked_licensor_count,
    prior_linked_property_count,
    baseline_ok,
    coldlion_ok,
    designflow_ok,
    immutability_ok,
    links_ok,
    pass,
    unexplained_diff_count,
    details
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
  'Phase 6 daily comparison. APPEND-ONLY insert (uuid PK). Pins Phase 4 baseline on every row including first. force_fail inserts is_drill=true without overwriting non-drill evidence. Live hashes only.';

revoke all on function plm.record_taxonomy_parallel_observation(date, jsonb) from public;
grant execute on function plm.record_taxonomy_parallel_observation(date, jsonb) to service_role;

create or replace function public.record_taxonomy_parallel_observation(
  p_observation_date date default (timezone('utc', now()))::date,
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language sql
security definer
set search_path = public, plm
as $$
  select plm.record_taxonomy_parallel_observation(p_observation_date, p_options);
$$;

revoke all on function public.record_taxonomy_parallel_observation(date, jsonb) from public;
revoke all on function public.record_taxonomy_parallel_observation(date, jsonb)
  from anon, authenticated;
grant execute on function public.record_taxonomy_parallel_observation(date, jsonb)
  to service_role;

-- =====================================================================================
-- 6. Health check — uses latest NON-DRILL observation for gate; drills are distinct
-- =====================================================================================

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
  c_expected_licensor_count constant integer := 26;
  c_expected_property_count constant integer := 256;
  c_expected_licensor_uuid_hash constant text := '590ea83ea6df1487fcfc1e18b3ef6a0d';
  c_expected_property_uuid_hash constant text := 'e0e6c36eb02bb2d320c0deaff7aa8f8c';
  c_expected_licensor_status_hash constant text := 'd9b07759bf80ff227e2fa9bd635d2138';
  c_expected_property_status_hash constant text := 'f436d4acd79761fedbfc9b5796ac7bce';
  c_expected_parent_edge_hash constant text := '7459f6826cc59468779e7ead33ec0edc';
  c_expected_taxonomy_source_ref_count constant integer := 1047;
  c_expected_coldlion_refs constant integer := 542;
  c_expected_designflow_refs constant integer := 505;
  c_expected_linked_licensors constant integer := 38;
  c_expected_linked_properties constant integer := 504;

  v_opts jsonb := coalesce(p_options, '{}'::jsonb);
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

  -- Live Phase 4 baseline (same pins as comparison).
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
  'Phase 6 health. Evaluates latest NON-DRILL observation for the 14-day gate. force_fail records a distinct drill alert without overwriting daily evidence.';

revoke all on function plm.check_taxonomy_sync_health(interval, jsonb) from public;
grant execute on function plm.check_taxonomy_sync_health(interval, jsonb) to service_role;

create or replace function public.check_taxonomy_sync_health(
  p_max_success_age interval default interval '36 hours',
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language sql
security definer
set search_path = public, plm
as $$
  select plm.check_taxonomy_sync_health(p_max_success_age, p_options);
$$;

revoke all on function public.check_taxonomy_sync_health(interval, jsonb) from public;
revoke all on function public.check_taxonomy_sync_health(interval, jsonb)
  from anon, authenticated;
grant execute on function public.check_taxonomy_sync_health(interval, jsonb)
  to service_role;

-- =====================================================================================
-- 7. Admin-only read surfaces
-- =====================================================================================

create or replace function api.coldlion_parallel_observation_list(p_limit integer default 50)
returns setof plm.taxonomy_parallel_observation
language sql
stable
security definer
set search_path = api, plm, app
as $$
  select *
  from plm.taxonomy_parallel_observation
  where app.has_role('administrator')
  order by observed_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

create or replace function api.taxonomy_sync_alert_list(p_limit integer default 50)
returns setof plm.taxonomy_sync_alert
language sql
stable
security definer
set search_path = api, plm, app
as $$
  select *
  from plm.taxonomy_sync_alert
  where app.has_role('administrator')
  order by fired_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

comment on function api.coldlion_parallel_observation_list(integer) is
  'Admin-gated list of Phase 6 append-only observation evidence rows (including drills).';
comment on function api.taxonomy_sync_alert_list(integer) is
  'Admin-gated list of Phase 6 taxonomy sync alerts (observation_id FK to immutable evidence).';

revoke all on function api.coldlion_parallel_observation_list(integer) from public;
revoke all on function api.taxonomy_sync_alert_list(integer) from public;
grant execute on function api.coldlion_parallel_observation_list(integer)
  to authenticated, service_role;
grant execute on function api.taxonomy_sync_alert_list(integer)
  to authenticated, service_role;

create or replace function api.coldlion_licensor_property_run_list(p_limit integer default 50)
returns setof ingest.sync_run
language sql
stable
security definer
set search_path = api, ingest, app
as $$
  select *
  from ingest.sync_run
  where app.has_role('administrator')
    and source_name in (
      'coldlion_licensors_properties_api',
      'coldlion_licensors_properties_link_approved',
      'coldlion_designflow_daily_comparison',
      'coldlion_designflow_sync_health',
      'plm_master_data_api'
    )
  order by started_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

comment on function api.coldlion_licensor_property_run_list(integer) is
  'Admin-gated list of ColdLion licensor/property + DesignFlow master-data + Phase 6 comparison/health sync runs.';

revoke all on function api.coldlion_licensor_property_run_list(integer) from public;
grant execute on function api.coldlion_licensor_property_run_list(integer)
  to authenticated, service_role;
