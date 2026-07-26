-- Rollback-safe Phase 6A contract tests for
-- 20260726180000_coldlion_licensor_property_phase6_parallel_run.sql
--
-- Run against preview AFTER the Phase 6 migration is applied. Fixtures roll back.
-- Proves:
--   * observation UUID PK + append-only (two same-day inserts coexist; no upsert)
--   * force_fail drill is is_drill=true and does not remove non-drill rows
--   * Phase 4 baseline pins are encoded and enforced
--   * browser roles lack EXECUTE on write wrappers
--   * alerts reference observation_id
--   * no canonical mutation from drills

begin;

do $$
declare
  v_lic_before bigint;
  v_prop_before bigint;
  v_sr_before bigint;
  v_status_before text;
  v_parent_before text;
  v_cmp1 jsonb;
  v_cmp2 jsonb;
  v_cmp_drill jsonb;
  v_health jsonb;
  v_obs_count integer;
  v_nondrill_count integer;
  v_drill_count integer;
  v_id1 uuid;
  v_id2 uuid;
  v_id_drill uuid;
  v_alert_count integer;
  v_has_exec_service boolean;
  v_has_exec_auth boolean;
  v_has_exec_anon boolean;
  v_def text;
  v_day date := (timezone('utc', now()))::date;
begin
  select count(*) into v_lic_before from core.licensor;
  select count(*) into v_prop_before from core.property;
  select count(*) into v_sr_before from core.taxonomy_source_ref;

  select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), ''))
    into v_status_before
  from (
    select id, status::text from core.licensor
    union all
    select id, status::text from core.property
  ) s;

  select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), ''))
    into v_parent_before
  from core.property;

  -- Objects exist.
  if to_regclass('plm.taxonomy_parallel_observation') is null then
    raise exception 'missing plm.taxonomy_parallel_observation';
  end if;
  if to_regclass('plm.taxonomy_sync_alert') is null then
    raise exception 'missing plm.taxonomy_sync_alert';
  end if;

  -- UUID PK (not date PK).
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'plm'
      and t.relname = 'taxonomy_parallel_observation'
      and c.contype = 'p'
      and pg_get_constraintdef(c.oid) ilike '%(id)%'
  ) then
    raise exception 'observation table must have UUID primary key on id';
  end if;

  -- Function source: append-only, no ON CONFLICT, Phase 4 pins, is_drill.
  select pg_get_functiondef('plm.record_taxonomy_parallel_observation(date,jsonb)'::regprocedure)
    into v_def;
  -- Ignore SQL comments: the function's safety comment deliberately names the
  -- forbidden clauses and must not be mistaken for executable DML.
  v_def := regexp_replace(v_def, '--[^\n\r]*', '', 'g');
  if v_def ~* 'on conflict' or v_def ~* 'do update' then
    raise exception 'observation function must not UPDATE/upsert';
  end if;
  if v_def not like '%590ea83ea6df1487fcfc1e18b3ef6a0d%'
     or v_def not like '%d9b07759bf80ff227e2fa9bd635d2138%'
     or v_def not like '%f436d4acd79761fedbfc9b5796ac7bce%'
     or v_def not like '%7459f6826cc59468779e7ead33ec0edc%'
     or v_def not like '%1047%'
  then
    raise exception 'phase4 baseline pins missing from observation function';
  end if;
  if v_def not like '%is_drill%' then
    raise exception 'is_drill missing from observation function';
  end if;

  -- Grants.
  select has_function_privilege('service_role',
    'public.record_taxonomy_parallel_observation(date,jsonb)', 'execute')
    into v_has_exec_service;
  select has_function_privilege('authenticated',
    'public.record_taxonomy_parallel_observation(date,jsonb)', 'execute')
    into v_has_exec_auth;
  select has_function_privilege('anon',
    'public.record_taxonomy_parallel_observation(date,jsonb)', 'execute')
    into v_has_exec_anon;
  if not v_has_exec_service then
    raise exception 'service_role must execute public.record_taxonomy_parallel_observation';
  end if;
  if v_has_exec_auth or v_has_exec_anon then
    raise exception 'browser roles must not execute public.record_taxonomy_parallel_observation';
  end if;

  select has_function_privilege('service_role',
    'public.check_taxonomy_sync_health(interval,jsonb)', 'execute')
    into v_has_exec_service;
  select has_function_privilege('authenticated',
    'public.check_taxonomy_sync_health(interval,jsonb)', 'execute')
    into v_has_exec_auth;
  if not v_has_exec_service or v_has_exec_auth then
    raise exception 'check_taxonomy_sync_health grant matrix wrong';
  end if;

  -- Two same-day non-drill comparison attempts must coexist (append-only).
  -- Use huge max_success_age so lane freshness is not the only failure mode;
  -- pass may still be false if baseline/lanes are not green on a disposable DB.
  v_cmp1 := public.record_taxonomy_parallel_observation(
    v_day,
    jsonb_build_object('max_success_age', '100 years', 'skip_alert', true)
  );
  v_id1 := (v_cmp1 ->> 'observation_id')::uuid;
  if v_id1 is null then
    raise exception 'first comparison must return observation_id';
  end if;
  if coalesce((v_cmp1 ->> 'is_drill')::boolean, true) then
    raise exception 'first comparison must be non-drill';
  end if;

  v_cmp2 := public.record_taxonomy_parallel_observation(
    v_day,
    jsonb_build_object('max_success_age', '100 years', 'skip_alert', true)
  );
  v_id2 := (v_cmp2 ->> 'observation_id')::uuid;
  if v_id2 is null or v_id2 = v_id1 then
    raise exception 'second same-day comparison must insert a distinct observation_id (append-only)';
  end if;

  select count(*) into v_obs_count
  from plm.taxonomy_parallel_observation
  where observation_date = v_day and id in (v_id1, v_id2);
  if v_obs_count is distinct from 2 then
    raise exception 'two same-day observation rows must coexist';
  end if;

  -- Forced-failure drill: append-only is_drill row; does not remove prior rows.
  v_cmp_drill := public.record_taxonomy_parallel_observation(
    v_day,
    jsonb_build_object(
      'force_fail', true,
      'max_success_age', '100 years'
    )
  );
  if coalesce((v_cmp_drill ->> 'pass')::boolean, true) then
    raise exception 'force_fail comparison must return pass=false';
  end if;
  if coalesce((v_cmp_drill ->> 'is_drill')::boolean, false) is not true then
    raise exception 'force_fail comparison must set is_drill=true';
  end if;
  v_id_drill := (v_cmp_drill ->> 'observation_id')::uuid;
  if v_id_drill is null or v_id_drill in (v_id1, v_id2) then
    raise exception 'force_fail must insert a new observation_id distinct from non-drill rows';
  end if;

  select count(*) into v_nondrill_count
  from plm.taxonomy_parallel_observation
  where observation_date = v_day and is_drill = false and id in (v_id1, v_id2);
  select count(*) into v_drill_count
  from plm.taxonomy_parallel_observation
  where observation_date = v_day and is_drill = true and id = v_id_drill;
  if v_nondrill_count is distinct from 2 or v_drill_count is distinct from 1 then
    raise exception 'drill must not erase non-drill same-day evidence (nondrill=%, drill=%)',
      v_nondrill_count, v_drill_count;
  end if;

  select count(*) into v_alert_count
  from plm.taxonomy_sync_alert
  where source_name = 'coldlion_designflow_daily_comparison'
    and reason = 'forced_failure_drill'
    and observation_id = v_id_drill
    and is_drill = true
    and fired_at > now() - interval '1 minute';
  if v_alert_count < 1 then
    raise exception 'force_fail comparison did not write durable alert with observation_id';
  end if;

  -- Health force_fail drill (distinct from comparison).
  v_health := public.check_taxonomy_sync_health(
    interval '100 years',
    jsonb_build_object('force_fail', true)
  );
  if coalesce((v_health ->> 'ok')::boolean, true) then
    raise exception 'force_fail health must return ok=false';
  end if;
  if coalesce((v_health ->> 'is_drill')::boolean, false) is not true then
    raise exception 'force_fail health must set is_drill=true';
  end if;

  select count(*) into v_alert_count
  from plm.taxonomy_sync_alert
  where source_name = 'coldlion_designflow_sync_health'
    and reason = 'forced_failure_drill'
    and is_drill = true
    and fired_at > now() - interval '1 minute';
  if v_alert_count < 1 then
    raise exception 'force_fail health did not write durable drill alert';
  end if;

  -- Non-drill rows still present after health drill.
  select count(*) into v_nondrill_count
  from plm.taxonomy_parallel_observation
  where observation_date = v_day and is_drill = false and id in (v_id1, v_id2);
  if v_nondrill_count is distinct from 2 then
    raise exception 'health drill must not poison non-drill observation rows';
  end if;

  -- Canonical immutability through drills.
  if (select count(*) from core.licensor) is distinct from v_lic_before
     or (select count(*) from core.property) is distinct from v_prop_before
     or (select count(*) from core.taxonomy_source_ref) is distinct from v_sr_before
  then
    raise exception 'force_fail drills mutated canonical counts or source refs';
  end if;

  if (
    select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), ''))
    from (
      select id, status::text from core.licensor
      union all
      select id, status::text from core.property
    ) s
  ) is distinct from v_status_before
  then
    raise exception 'force_fail drills mutated status_hash';
  end if;

  if (
    select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), ''))
    from core.property
  ) is distinct from v_parent_before
  then
    raise exception 'force_fail drills mutated parent_edge_hash';
  end if;

  raise notice 'phase6 contracts PASS (append-only + baseline pins + drills)';
end;
$$;

rollback;
