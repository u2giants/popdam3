-- Issue #552: keep taxonomy health from accepting an unreviewed licensor-status state.
-- derived-from: 20260804120000
-- Migration-only. This file activates no baseline and invokes none of these functions.
--
-- The two PL/pgSQL bodies are the current definitions from
-- 20260804120000_taxonomy_baseline_pins_table.sql with one additive refusal after
-- compute_taxonomy_immutability_snapshot(). The baseline remains table-driven.
-- The public SQL wrappers remain unchanged; their existing ACLs are reasserted below.

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

  -- Issue #552: refuse an unreviewed licensor-status state before this
  -- detector can write an observation, alert, health run, or breaker signal.
  -- These are the only two states covered by the owner-reviewed transition:
  -- the pre-ruling hash and the post-ruling hash from 20260802171000.
  if (v_snap ->> 'licensor_status_hash') is null
     or (v_snap ->> 'licensor_status_hash') not in (
    'd9b07759bf80ff227e2fa9bd635d2138',
    '00bf7069fff79b9deab1d14dbd9112b2'
  ) then
    raise exception using
      message = 'taxonomy health refused: live licensor_status_hash is outside the reviewed transition',
      detail = format(
        'actual=%s allowed=d9b07759bf80ff227e2fa9bd635d2138,00bf7069fff79b9deab1d14dbd9112b2',
        coalesce(v_snap ->> 'licensor_status_hash', '<null>')
      ),
      hint = 'Review the licensor-status change and ship a new governed transition before running health or observation functions.';
  end if;

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

  -- Issue #552: refuse an unreviewed licensor-status state before this
  -- detector can write an observation, alert, health run, or breaker signal.
  -- These are the only two states covered by the owner-reviewed transition:
  -- the pre-ruling hash and the post-ruling hash from 20260802171000.
  if (v_snap ->> 'licensor_status_hash') is null
     or (v_snap ->> 'licensor_status_hash') not in (
    'd9b07759bf80ff227e2fa9bd635d2138',
    '00bf7069fff79b9deab1d14dbd9112b2'
  ) then
    raise exception using
      message = 'taxonomy health refused: live licensor_status_hash is outside the reviewed transition',
      detail = format(
        'actual=%s allowed=d9b07759bf80ff227e2fa9bd635d2138,00bf7069fff79b9deab1d14dbd9112b2',
        coalesce(v_snap ->> 'licensor_status_hash', '<null>')
      ),
      hint = 'Review the licensor-status change and ship a new governed transition before running health or observation functions.';
  end if;

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

-- Preserve the established owner/service-role-only execution surface.
revoke all on function plm.check_taxonomy_sync_health(interval, jsonb) from public;
revoke all on function plm.check_taxonomy_sync_health(interval, jsonb) from anon, authenticated;
grant execute on function plm.check_taxonomy_sync_health(interval, jsonb) to service_role;

revoke all on function plm.record_taxonomy_parallel_observation(date, jsonb) from public;
revoke all on function plm.record_taxonomy_parallel_observation(date, jsonb) from anon, authenticated;
grant execute on function plm.record_taxonomy_parallel_observation(date, jsonb) to service_role;

revoke all on function public.check_taxonomy_sync_health(interval, jsonb) from public;
revoke all on function public.check_taxonomy_sync_health(interval, jsonb) from anon, authenticated;
grant execute on function public.check_taxonomy_sync_health(interval, jsonb) to service_role;

revoke all on function public.record_taxonomy_parallel_observation(date, jsonb) from public;
revoke all on function public.record_taxonomy_parallel_observation(date, jsonb) from anon, authenticated;
grant execute on function public.record_taxonomy_parallel_observation(date, jsonb) to service_role;
