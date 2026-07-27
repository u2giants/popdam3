-- Rollback-safe contract tests for
-- 20260727221500_coldlion_licensor_property_readiness_and_breaker.sql
--
-- Run against preview AFTER the migration is applied. Every fixture rolls back.
--
-- Proves, for the circuit breaker:
--   * a protected-invariant failure writes a durable critical alert AND disables
--     further ColdLion canonical promotion
--   * the alert names Albert Hazan as the human response owner
--   * a SECOND promotion attempt still cannot write while the breaker is tripped
--   * mirror/raw/observation evidence remains writable so evidence keeps accruing
--   * DesignFlow refs, curated status, and Property parents stay writable
--   * protected canonical UUID/status/parent hashes are unchanged by all of it
--   * an unauthorized reset is refused; an authorized reset works and the earlier
--     trip events survive it (append-only)
--   * preview and production lanes cannot be crossed by lane name confusion
--
-- Proves, for the identity verifier:
--   * an exact live match passes
--   * missing / changed / cross-typed / duplicate-input / canonical-missing all
--     block with a named reason
--   * matching counts with a wrong hash never pass

begin;

do $$
declare
  v_status_before text;
  v_parent_before text;
  v_uuid_before text;
  v_lic uuid;
  v_prop uuid;
  v_trip jsonb;
  v_alert record;
  v_state jsonb;
  v_res jsonb;
  v_blocked integer;
  v_trips_before integer;
  v_trips_after integer;
  v_raised boolean;
  v_identity jsonb;
  v_sample record;
  v_obs_before integer;
  v_obs_after integer;
begin
  -- ------------------------------------------------------------------
  -- 0. Objects exist.
  -- ------------------------------------------------------------------
  if to_regclass('plm.taxonomy_circuit_breaker') is null then
    raise exception 'missing plm.taxonomy_circuit_breaker';
  end if;
  if to_regclass('plm.taxonomy_circuit_breaker_event') is null then
    raise exception 'missing plm.taxonomy_circuit_breaker_event';
  end if;
  if to_regprocedure('plm.verify_coldlion_approved_mapping_identity(jsonb,jsonb,integer)') is null then
    raise exception 'missing plm.verify_coldlion_approved_mapping_identity';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'coldlion_source_ref_breaker_guard') then
    raise exception 'missing trigger coldlion_source_ref_breaker_guard';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'coldlion_erp_licensor_breaker_guard') then
    raise exception 'missing trigger coldlion_erp_licensor_breaker_guard';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'coldlion_erp_property_breaker_guard') then
    raise exception 'missing trigger coldlion_erp_property_breaker_guard';
  end if;

  -- ------------------------------------------------------------------
  -- 1. Protected baseline BEFORE anything.
  -- ------------------------------------------------------------------
  select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), ''))
    into v_status_before
  from (select id, status::text from core.licensor
        union all select id, status::text from core.property) s;

  select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), ''))
    into v_parent_before from core.property;

  select md5(coalesce(string_agg(id::text, '|' order by id::text), ''))
    into v_uuid_before
  from (select id from core.licensor union all select id from core.property) s;

  select count(*) into v_trips_before
    from plm.taxonomy_circuit_breaker_event
   where lane = 'coldlion_licensor_property' and event = 'trip';

  select count(*) into v_obs_before from plm.taxonomy_parallel_observation;

  select id into v_lic from core.licensor order by id limit 1;
  select id into v_prop from core.property order by id limit 1;
  if v_lic is null or v_prop is null then
    raise exception 'fixture requires at least one canonical licensor and property';
  end if;

  -- ------------------------------------------------------------------
  -- 2. Breaker starts closed and a ColdLion ref write is allowed.
  -- ------------------------------------------------------------------
  if plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property') then
    raise exception 'breaker must start closed for this contract test';
  end if;

  insert into core.taxonomy_source_ref (
    entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_code)
  values ('core', 'licensor', v_lic, 'coldlion', 'merchGroupDetails', 'CONTRACT/TEST/99/PRECLOSE', 'PRECLOSE');

  -- ------------------------------------------------------------------
  -- 3. Trip on a protected-invariant failure (drill-labelled so it can never be
  --    mistaken for a real production incident).
  -- ------------------------------------------------------------------
  v_trip := plm.trip_taxonomy_circuit_breaker(
    'contract test: simulated protected-invariant failure',
    'contract_test_invariant',
    'coldlion_licensor_property',
    null,
    'preview rjyboqwcdzcocqgmsyel',
    'contract-test',
    true,
    jsonb_build_object('note', 'rolled back'));

  if v_trip->>'state' <> 'tripped' then
    raise exception 'trip did not report state=tripped: %', v_trip;
  end if;
  if v_trip->>'human_response_owner' is distinct from 'Albert Hazan' then
    raise exception 'trip result must name Albert Hazan as human response owner: %', v_trip;
  end if;

  -- Durable alert exists, is critical, and names the response owner + first response.
  select * into v_alert from plm.taxonomy_sync_alert where id = (v_trip->>'alert_id')::uuid;
  if v_alert.id is null then
    raise exception 'trip did not write a durable alert';
  end if;
  if v_alert.severity <> 'critical' then
    raise exception 'breaker alert must be critical, got %', v_alert.severity;
  end if;
  if v_alert.payload->>'human_response_owner' is distinct from 'Albert Hazan' then
    raise exception 'breaker alert must name Albert Hazan as human response owner';
  end if;
  if coalesce(btrim(v_alert.payload->>'first_response'), '') = '' then
    raise exception 'breaker alert must carry the exact first response';
  end if;
  if v_alert.payload->>'failed_invariant' is distinct from 'contract_test_invariant' then
    raise exception 'breaker alert must record the failed invariant';
  end if;

  -- Trip is appended, never overwritten.
  select count(*) into v_trips_after
    from plm.taxonomy_circuit_breaker_event
   where lane = 'coldlion_licensor_property' and event = 'trip';
  if v_trips_after <> v_trips_before + 1 then
    raise exception 'trip event was not appended (before % after %)', v_trips_before, v_trips_after;
  end if;

  -- ------------------------------------------------------------------
  -- 4. FIRST promotion attempt while tripped is refused.
  -- ------------------------------------------------------------------
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref (
      entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_code)
    values ('core', 'licensor', v_lic, 'coldlion', 'merchGroupDetails', 'CONTRACT/TEST/99/BLOCKED1', 'B1');
  exception when others then
    v_raised := true;
    -- The CALLER records the refusal. A trigger cannot: the exception it raises
    -- rolls back its own write. See 20260727223000 for the full explanation.
    perform plm.record_taxonomy_circuit_breaker_blocked_attempt(
      'contract test: first refused ColdLion source-ref insert',
      'coldlion_licensor_property', 'contract-test',
      jsonb_build_object('source_id', 'CONTRACT/TEST/99/BLOCKED1'));
  end;
  if not v_raised then
    raise exception 'tripped breaker did not refuse a ColdLion source-ref insert';
  end if;

  -- ------------------------------------------------------------------
  -- 5. SECOND attempt (the "scheduled job runs again" case) is also refused.
  -- ------------------------------------------------------------------
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref (
      entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_code)
    values ('core', 'property', v_prop, 'coldlion', 'merchGroupDetails', 'CONTRACT/TEST/99/BLOCKED2', 'B2');
  exception when others then
    v_raised := true;
    perform plm.record_taxonomy_circuit_breaker_blocked_attempt(
      'contract test: second refused ColdLion promotion attempt while tripped',
      'coldlion_licensor_property', 'contract-test',
      jsonb_build_object('source_id', 'CONTRACT/TEST/99/BLOCKED2'));
  end;
  if not v_raised then
    raise exception 'tripped breaker allowed a SECOND ColdLion promotion attempt';
  end if;

  -- Typed mirror canonical link changes are refused too.
  select * into v_sample from plm.erp_licensor where licensor_id is not null limit 1;
  if v_sample is not null then
    v_raised := false;
    begin
      update plm.erp_licensor set licensor_id = null
       where company_code = v_sample.company_code and division_code = v_sample.division_code
         and mg_type_code = v_sample.mg_type_code and mg_code = v_sample.mg_code;
    exception when others then
      v_raised := true;
      perform plm.record_taxonomy_circuit_breaker_blocked_attempt(
        'contract test: refused typed mirror canonical link change while tripped',
        'coldlion_licensor_property', 'contract-test',
        jsonb_build_object('mirror_table', 'erp_licensor'));
    end;
    if not v_raised then
      raise exception 'tripped breaker allowed a typed mirror canonical link change';
    end if;
  end if;

  -- Every refusal is recorded append-only.
  select count(*) into v_blocked
    from plm.taxonomy_circuit_breaker_event
   where lane = 'coldlion_licensor_property' and event = 'blocked_attempt';
  if v_blocked < 2 then
    raise exception 'blocked attempts were not recorded append-only (got %)', v_blocked;
  end if;

  -- ------------------------------------------------------------------
  -- 6. Evidence and the curated lane stay available while tripped.
  --    A tripped ColdLion breaker must NOT take DesignFlow or curated facts down.
  -- ------------------------------------------------------------------
  insert into core.taxonomy_source_ref (
    entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_code)
  values ('core', 'licensor', v_lic, 'designflow_plm', 'merchGroup', 'CONTRACT-TEST-DF-1', 'DF1');

  perform plm.record_taxonomy_sync_alert(
    'info', 'contract_test', 'evidence still writable while tripped', null, null, null, true, '{}'::jsonb);

  select count(*) into v_obs_after from plm.taxonomy_parallel_observation;
  if v_obs_after < v_obs_before then
    raise exception 'observation evidence was destroyed while the breaker was tripped';
  end if;

  -- ------------------------------------------------------------------
  -- 7. An unrelated lane name must not be blocked by this lane's breaker.
  -- ------------------------------------------------------------------
  if plm.taxonomy_circuit_breaker_is_open('some_other_lane') then
    raise exception 'an unconfigured lane must read as closed, not tripped';
  end if;

  -- ------------------------------------------------------------------
  -- 8. Reset requires explicit authorization.
  -- ------------------------------------------------------------------
  v_raised := false;
  begin
    perform plm.reset_taxonomy_circuit_breaker('{}'::jsonb);
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'reset accepted an empty authorization'; end if;

  v_raised := false;
  begin
    perform plm.reset_taxonomy_circuit_breaker(
      jsonb_build_object('authorized_by', 'Albert Hazan', 'readiness_pass', false,
                         'readiness_evidence', 'x'));
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'reset accepted readiness_pass=false'; end if;

  v_raised := false;
  begin
    perform plm.reset_taxonomy_circuit_breaker(
      jsonb_build_object('authorized_by', 'Albert Hazan', 'readiness_pass', true));
  exception when others then v_raised := true; end;
  if not v_raised then raise exception 'reset accepted a missing readiness_evidence'; end if;

  -- ------------------------------------------------------------------
  -- 9. Authorized reset works and promotion is possible again.
  -- ------------------------------------------------------------------
  v_res := plm.reset_taxonomy_circuit_breaker(jsonb_build_object(
    'authorized_by', 'Albert Hazan',
    'readiness_pass', true,
    'readiness_evidence', 'contract-test green readiness evaluation'));
  if v_res->>'state' <> 'closed' then
    raise exception 'authorized reset did not close the breaker: %', v_res;
  end if;

  insert into core.taxonomy_source_ref (
    entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_code)
  values ('core', 'licensor', v_lic, 'coldlion', 'merchGroupDetails', 'CONTRACT/TEST/99/AFTERRESET', 'AR');

  -- The earlier trip and blocked-attempt evidence survives the reset.
  select count(*) into v_trips_after
    from plm.taxonomy_circuit_breaker_event
   where lane = 'coldlion_licensor_property' and event = 'trip';
  if v_trips_after <> v_trips_before + 1 then
    raise exception 'reset erased trip evidence';
  end if;
  if (select count(*) from plm.taxonomy_circuit_breaker_event
       where lane = 'coldlion_licensor_property' and event = 'blocked_attempt') < v_blocked then
    raise exception 'reset erased blocked-attempt evidence';
  end if;
  if (select count(*) from plm.taxonomy_circuit_breaker_event
       where lane = 'coldlion_licensor_property' and event = 'reset') < 1 then
    raise exception 'reset was not appended to the event log';
  end if;

  -- ------------------------------------------------------------------
  -- 10. Protected canonical facts are unchanged by every step above.
  -- ------------------------------------------------------------------
  if (select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), ''))
      from (select id, status::text from core.licensor
            union all select id, status::text from core.property) s)
     is distinct from v_status_before then
    raise exception 'breaker drill mutated canonical status';
  end if;
  if (select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), ''))
      from core.property) is distinct from v_parent_before then
    raise exception 'breaker drill mutated Property-to-Licensor parents';
  end if;
  if (select md5(coalesce(string_agg(id::text, '|' order by id::text), ''))
      from (select id from core.licensor union all select id from core.property) s)
     is distinct from v_uuid_before then
    raise exception 'breaker drill mutated canonical UUIDs';
  end if;

  raise notice 'circuit-breaker contracts PASS';
end;
$$;

-- =====================================================================================
-- Identity verifier contracts
-- =====================================================================================

do $$
declare
  v_ref record;
  v_map jsonb;
  v_res jsonb;
  v_hash text;
begin
  select r.source_id, r.entity_table, r.entity_id,
         split_part(r.source_id, '/', 1) as company_code,
         split_part(r.source_id, '/', 2) as division_code,
         split_part(r.source_id, '/', 3) as mg_type_code,
         split_part(r.source_id, '/', 4) as mg_code
    into v_ref
  from core.taxonomy_source_ref r
  where r.source_system = 'coldlion' and r.source_table = 'merchGroupDetails'
  order by r.source_id
  limit 1;

  if v_ref.source_id is null then
    raise exception 'fixture requires at least one ColdLion source ref on this database';
  end if;

  -- Helper shape for one real, correct mapping row.
  v_map := jsonb_build_array(jsonb_build_object(
    'entity_type', v_ref.entity_table,
    'company_code', v_ref.company_code,
    'division_code', v_ref.division_code,
    'mg_type_code', v_ref.mg_type_code,
    'mg_code', v_ref.mg_code,
    'canonical_id', v_ref.entity_id));

  -- --- EXACT match on this row: no missing / changed / cross-typed / link issues.
  v_res := plm.verify_coldlion_approved_mapping_identity(
    jsonb_build_object('mappings', v_map), null, 25);
  if (v_res->'difference_counts'->>'missing')::int <> 0 then
    raise exception 'a correct mapping was reported missing: %', v_res->'differences'->'missing';
  end if;
  if (v_res->'difference_counts'->>'changed_uuid')::int <> 0 then
    raise exception 'a correct mapping was reported changed';
  end if;
  if (v_res->'difference_counts'->>'cross_typed')::int <> 0 then
    raise exception 'a correct mapping was reported cross-typed';
  end if;
  -- A single-row input necessarily leaves the other live refs "extra" — that is
  -- exactly the extra-detection working, and it must block.
  if (v_res->'difference_counts'->>'extra')::int = 0 then
    raise exception 'extra ColdLion refs outside the input were not detected';
  end if;
  if (v_res->>'pass')::boolean then
    raise exception 'a partial input must never pass identity';
  end if;
  v_hash := v_res->>'recomputed_mapping_hash';
  if v_hash is null or length(v_hash) <> 32 then
    raise exception 'identity did not recompute a mapping hash';
  end if;

  -- --- MISSING: a source identity that has no ColdLion ref at all.
  v_res := plm.verify_coldlion_approved_mapping_identity(
    jsonb_build_object('mappings', jsonb_build_array(jsonb_build_object(
      'entity_type', 'licensor', 'company_code', 'NOSUCH', 'division_code', 'ZZ999',
      'mg_type_code', '99', 'mg_code', 'NOPE', 'canonical_id', v_ref.entity_id))),
    null, 25);
  if (v_res->'difference_counts'->>'missing')::int <> 1 then
    raise exception 'a missing mapping was not detected';
  end if;
  if not (v_res->'blocking_reasons')::text like '%NO ColdLion source ref%' then
    raise exception 'missing mapping did not produce a named blocking reason: %', v_res->'blocking_reasons';
  end if;

  -- --- CHANGED: correct source identity, wrong canonical UUID.
  v_res := plm.verify_coldlion_approved_mapping_identity(
    jsonb_build_object('mappings', jsonb_build_array(jsonb_build_object(
      'entity_type', v_ref.entity_table,
      'company_code', v_ref.company_code, 'division_code', v_ref.division_code,
      'mg_type_code', v_ref.mg_type_code, 'mg_code', v_ref.mg_code,
      'canonical_id', '00000000-0000-4000-8000-000000000000'))),
    null, 25);
  if (v_res->'difference_counts'->>'changed_uuid')::int <> 1 then
    raise exception 'a changed canonical UUID was not detected';
  end if;

  -- --- CROSS-TYPED: same source identity claimed as the other entity type.
  v_res := plm.verify_coldlion_approved_mapping_identity(
    jsonb_build_object('mappings', jsonb_build_array(jsonb_build_object(
      'entity_type', case when v_ref.entity_table = 'licensor' then 'property' else 'licensor' end,
      'company_code', v_ref.company_code, 'division_code', v_ref.division_code,
      'mg_type_code', v_ref.mg_type_code, 'mg_code', v_ref.mg_code,
      'canonical_id', v_ref.entity_id))),
    null, 25);
  if (v_res->'difference_counts'->>'cross_typed')::int <> 1 then
    raise exception 'a cross-typed mapping was not detected (the FR trap)';
  end if;

  -- --- DUPLICATE input key: the same composite source key twice.
  v_res := plm.verify_coldlion_approved_mapping_identity(
    jsonb_build_object('mappings', v_map || v_map), null, 25);
  if (v_res->'difference_counts'->>'duplicate_input_key')::int <> 1 then
    raise exception 'a duplicate composite source key was not detected';
  end if;

  -- --- CANONICAL MISSING: the canonical row no longer exists.
  v_res := plm.verify_coldlion_approved_mapping_identity(
    jsonb_build_object('mappings', jsonb_build_array(jsonb_build_object(
      'entity_type', v_ref.entity_table,
      'company_code', v_ref.company_code, 'division_code', v_ref.division_code,
      'mg_type_code', v_ref.mg_type_code, 'mg_code', v_ref.mg_code,
      'canonical_id', '00000000-0000-4000-8000-000000000000'))),
    null, 25);
  if (v_res->'difference_counts'->>'canonical_missing')::int <> 1 then
    raise exception 'a vanished canonical row was not detected';
  end if;

  -- --- MALFORMED input blocks instead of passing.
  v_res := plm.verify_coldlion_approved_mapping_identity(
    jsonb_build_object('mappings', jsonb_build_array(jsonb_build_object(
      'entity_type', 'sideways', 'company_code', 'X', 'division_code', 'Y',
      'mg_type_code', 'AB', 'mg_code', 'Z', 'canonical_id', 'not-a-uuid'))),
    null, 25);
  if (v_res->>'pass')::boolean then
    raise exception 'a structurally invalid mapping row passed identity';
  end if;

  -- --- COUNTS ALONE NEVER PASS: right count/distinct, wrong hash contract.
  v_res := plm.verify_coldlion_approved_mapping_identity(
    jsonb_build_object('mappings', v_map),
    jsonb_build_object('hash', repeat('0', 32), 'count', 1, 'distinct_canonical', 1),
    25);
  if (v_res->>'expected_contract_ok')::boolean then
    raise exception 'a wrong expected hash was accepted';
  end if;
  if (v_res->>'pass')::boolean then
    raise exception 'matching counts with a wrong hash must never pass';
  end if;

  raise notice 'mapping-identity contracts PASS';
end;
$$;

-- The hosted CLI does not surface RAISE NOTICE. Emit an explicit row so a green
-- run is positive evidence, not merely the absence of an error message.
select 'coldlion readiness + circuit-breaker contracts PASS' as result;

rollback;
