-- Behavioural contracts for migration 20260911210709 (#2712): schema hts_rag and its
-- four least-privilege roles. The Database Contract Tests workflow runs this inside a
-- transaction that rolls back. Every row below is synthetic.

do $catalog$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_schema_privilege(v_role, 'hts_rag', 'USAGE')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_precedents', 'SELECT')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_rulings', 'SELECT') then
      raise exception '% can reach hts_rag', v_role;
    end if;
  end loop;

  if has_schema_privilege('service_role', 'hts_rag', 'USAGE') then
    raise exception 'service_role (Data API) can reach hts_rag';
  end if;

  if has_table_privilege('designflow_hts_prod_worker', 'hts_rag.hts_rag_review_events', 'DELETE')
     or has_table_privilege('designflow_hts_alsand_worker', 'hts_rag.hts_rag_provider_responses', 'DELETE') then
    raise exception 'a worker can delete audit or evidence rows';
  end if;

  if has_column_privilege('designflow_hts_prod_worker', 'hts_rag.hts_rag_provider_responses', 'raw_response', 'UPDATE')
     or has_column_privilege('designflow_hts_prod_worker', 'hts_rag.hts_rag_precedents', 'raw_result_hash', 'UPDATE')
     or has_column_privilege('designflow_hts_alsand_worker', 'hts_rag.hts_rag_debate_runs', 'case_packet_hash', 'UPDATE') then
    raise exception 'a worker can rewrite an immutable artifact';
  end if;

  if has_table_privilege('designflow_hts_prod_runtime', 'hts_rag.hts_rag_determinations', 'SELECT')
     or has_table_privilege('designflow_hts_alsand_runtime', 'hts_rag.hts_rag_provider_responses', 'SELECT') then
    raise exception 'a runtime role can read non-evidence tables';
  end if;
end
$catalog$;

-- The CI session user is not a true superuser, so it may only SET ROLE into roles it is
-- a member of. It created these roles and therefore holds ADMIN on them; the grant is
-- test-only and rolls back with the transaction. The grantee is named explicitly:
-- a CURRENT_USER role spec crashed the hosted Supabase backend (run 34603204421).
grant designflow_hts_prod_worker, designflow_hts_alsand_worker, designflow_hts_prod_runtime, designflow_hts_alsand_runtime to postgres;

-- The promotion-gate trigger function has EXECUTE revoked from PUBLIC and is granted to
-- no role. PostgreSQL checks EXECUTE on a trigger function only when the trigger is
-- created, never when it fires, so workers must NOT hold it. The worker block below
-- proves the trigger still fires for a worker.
do $gate_function_privilege$
declare
  v_role text;
begin
  foreach v_role in array array['designflow_hts_prod_worker', 'designflow_hts_alsand_worker',
                                'designflow_hts_prod_runtime', 'designflow_hts_alsand_runtime',
                                'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, 'hts_rag.enforce_hts_rag_precedent_promotion_gate_immutable()', 'EXECUTE') then
      raise exception '% holds EXECUTE on the promotion-gate trigger function', v_role;
    end if;
  end loop;
end
$gate_function_privilege$;

-- ---------------------------------------------------------------------------------
-- Worker writes: A is a qualified operative precedent, B is not operative, D is
-- operative but rejected. R1 is linked to A, R2 to B, R3 to D.
-- ---------------------------------------------------------------------------------
set local role designflow_hts_prod_worker;

insert into hts_rag.hts_rag_product_examples (id, product_family, fixture_version, fixture_hash, input_hash, source_environment)
values ('27120000-0000-4000-8000-000000000001', 'ZZ synthetic', 'contract-v1', repeat('1', 64), repeat('2', 64), 'production');

insert into hts_rag.hts_rag_precedents (
  id, product_family, fixture_version, prompt_version, classifier_model, verifier_model,
  extraction_version, fixture_hash, input_hash, raw_result_hash, proposed_hts,
  classification_state, operative_eligible, review_state, source_environment
) values
  ('27120000-0000-4000-8000-00000000000a', 'ZZ synthetic', 'contract-v1', 'p1', 'c1', 'v1', 'e1',
   repeat('3', 64), repeat('4', 64), repeat('a', 64), '1234.56.78.90', 'provisional_complete', true, 'accepted', 'production'),
  ('27120000-0000-4000-8000-00000000000b', 'ZZ synthetic', 'contract-v1', 'p1', 'c1', 'v1', 'e1',
   repeat('3', 64), repeat('4', 64), repeat('b', 64), '1234.56.78.90', 'provisional_complete', false, 'accepted', 'production'),
  ('27120000-0000-4000-8000-00000000000d', 'ZZ synthetic', 'contract-v1', 'p1', 'c1', 'v1', 'e1',
   repeat('3', 64), repeat('4', 64), repeat('d', 64), '1234.56.78.90', 'provisional_complete', true, 'rejected', 'production');

insert into hts_rag.hts_rag_rulings (id, ruling_number, full_text, full_text_hash, source_environment) values
  ('27120000-0000-4000-8000-000000000011', 'ZZ-R1', 'synthetic ruling one', repeat('5', 64), 'production'),
  ('27120000-0000-4000-8000-000000000012', 'ZZ-R2', 'synthetic ruling two', repeat('6', 64), 'production'),
  ('27120000-0000-4000-8000-000000000013', 'ZZ-R3', 'synthetic ruling three', repeat('7', 64), 'production');

insert into hts_rag.hts_rag_precedent_rulings (precedent_id, ruling_id, source_environment) values
  ('27120000-0000-4000-8000-00000000000a', '27120000-0000-4000-8000-000000000011', 'production'),
  ('27120000-0000-4000-8000-00000000000b', '27120000-0000-4000-8000-000000000012', 'production'),
  ('27120000-0000-4000-8000-00000000000d', '27120000-0000-4000-8000-000000000013', 'production');

insert into hts_rag.hts_rag_review_events (id, subject_type, subject_id, action, source_environment)
values ('27120000-0000-4000-8000-000000000021', 'precedent', '27120000-0000-4000-8000-00000000000a', 'accept', 'production');

do $worker_contract$
begin
  begin
    insert into hts_rag.hts_rag_rulings (ruling_number, full_text, full_text_hash)
    values ('ZZ-R9', 'no provenance', repeat('8', 64));
    raise exception 'insert without source_environment was accepted';
  exception when not_null_violation or insufficient_privilege then null;
  end;

  begin
    insert into hts_rag.hts_rag_rulings (ruling_number, full_text, full_text_hash, source_environment)
    values ('ZZ-R9', 'bad provenance', repeat('8', 64), 'staging');
    raise exception 'unknown source_environment was accepted';
  exception when check_violation or insufficient_privilege then null;
  end;

  update hts_rag.hts_rag_rulings set operationally_revoked = false, subject = 'refreshed'
   where id = '27120000-0000-4000-8000-000000000011';
  if not found then
    raise exception 'bounded ruling update did not apply';
  end if;

  begin
    update hts_rag.hts_rag_rulings set full_text = 'tampered' where id = '27120000-0000-4000-8000-000000000011';
    raise exception 'worker rewrote immutable ruling text';
  exception when insufficient_privilege then null;
  end;

  begin
    update hts_rag.hts_rag_rulings set source_environment = 'alsand' where id = '27120000-0000-4000-8000-000000000011';
    raise exception 'worker rewrote source_environment';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from hts_rag.hts_rag_review_events where id = '27120000-0000-4000-8000-000000000021';
    raise exception 'worker deleted a review event';
  exception when insufficient_privilege then null;
  end;

  begin
    truncate hts_rag.hts_rag_review_events;
    raise exception 'worker truncated review events';
  exception when insufficient_privilege then null;
  end;

  update hts_rag.hts_rag_precedents set promotion_gate_result = '{"passed": true}'::jsonb
   where id = '27120000-0000-4000-8000-00000000000a';

  if (select promotion_gate_result from hts_rag.hts_rag_precedents
       where id = '27120000-0000-4000-8000-00000000000a') is distinct from '{"passed": true}'::jsonb then
    raise exception 'worker could not set promotion_gate_result for the first time';
  end if;

  -- The trigger fires for the worker even though the worker holds no EXECUTE on it.
  begin
    update hts_rag.hts_rag_precedents set promotion_gate_result = '{"passed": false}'::jsonb
     where id = '27120000-0000-4000-8000-00000000000a';
    raise exception 'promotion_gate_result changed after its first non-null value';
  exception when check_violation then
    if sqlerrm <> 'hts_rag_precedents.promotion_gate_result is immutable once set' then
      raise exception 'unexpected check_violation instead of the promotion-gate trigger: %', sqlerrm;
    end if;
  end;
end
$worker_contract$;

reset role;

-- ---------------------------------------------------------------------------------
-- The Alsand worker has the same bounded write rights, proven by real writes. Its
-- ruling R4 is linked to no precedent, so neither runtime role may see it below.
-- ---------------------------------------------------------------------------------
set local role designflow_hts_alsand_worker;

do $alsand_worker_contract$
begin
  insert into hts_rag.hts_rag_rulings (id, ruling_number, full_text, full_text_hash, source_environment)
  values ('27120000-0000-4000-8000-000000000014', 'ZZ-R4', 'synthetic ruling four', repeat('c', 64), 'alsand');

  update hts_rag.hts_rag_rulings set subject = 'alsand refreshed'
   where id = '27120000-0000-4000-8000-000000000014';
  if not found then
    raise exception 'alsand worker bounded ruling update did not apply';
  end if;

  begin
    update hts_rag.hts_rag_rulings set full_text = 'tampered' where id = '27120000-0000-4000-8000-000000000014';
    raise exception 'alsand worker rewrote immutable ruling text';
  exception when insufficient_privilege then null;
  end;

  begin
    update hts_rag.hts_rag_rulings set source_environment = 'production' where id = '27120000-0000-4000-8000-000000000014';
    raise exception 'alsand worker rewrote source_environment';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from hts_rag.hts_rag_rulings where id = '27120000-0000-4000-8000-000000000014';
    raise exception 'alsand worker deleted a ruling';
  exception when insufficient_privilege then null;
  end;

  begin
    update hts_rag.hts_rag_precedents set promotion_gate_result = '{"passed": false}'::jsonb
     where id = '27120000-0000-4000-8000-00000000000a';
    raise exception 'alsand worker changed a set promotion_gate_result';
  exception when check_violation then null;
  end;
end
$alsand_worker_contract$;

reset role;

-- ---------------------------------------------------------------------------------
-- Issue #2866: every worker can insert one valid row into every table only when
-- source_environment names that worker's environment. The duplicate-key clone
-- attempts below are deliberate: a correct RLS policy rejects them first with
-- insufficient_privilege; if provenance is not enforced, the unexpected unique
-- violation escapes and fails the contract.
-- ---------------------------------------------------------------------------------
set local role designflow_hts_prod_worker;

insert into hts_rag.hts_rag_product_examples
  (id, product_family, fixture_version, fixture_hash, input_hash, source_environment)
values ('28660000-0000-4000-8000-000000000001', 'ZZ provenance prod', 'v2866p', repeat('1', 64), repeat('2', 64), 'production');

insert into hts_rag.hts_rag_precedents
  (id, product_family, fixture_version, prompt_version, classifier_model, verifier_model,
   extraction_version, fixture_hash, input_hash, raw_result_hash, classification_state, source_environment)
values ('28660000-0000-4000-8000-000000000002', 'ZZ provenance prod', 'v2866p', 'p', 'c', 'v',
        'e', repeat('3', 64), repeat('4', 64), repeat('5', 64), 'needs_more_facts', 'production');

insert into hts_rag.hts_rag_rulings
  (id, ruling_number, full_text, full_text_hash, source_environment)
values ('28660000-0000-4000-8000-000000000003', 'ZZ-2866-P', 'synthetic', repeat('6', 64), 'production');

insert into hts_rag.hts_rag_precedent_rulings
  (id, precedent_id, ruling_id, source_environment)
values ('28660000-0000-4000-8000-000000000004', '28660000-0000-4000-8000-000000000002',
        '28660000-0000-4000-8000-000000000003', 'production');

insert into hts_rag.hts_rag_extraction_jobs
  (id, product_example_id, prompt_version, model_version, extraction_version, input_hash, source_environment)
values ('28660000-0000-4000-8000-000000000005', '28660000-0000-4000-8000-000000000001',
        'p', 'm', 'e', repeat('7', 64), 'production');

insert into hts_rag.hts_rag_determinations
  (id, product_example_id, method, classification_state, result_hash, comparison_key, source_environment)
values ('28660000-0000-4000-8000-000000000006', '28660000-0000-4000-8000-000000000001',
        'legacy_ai_cross', 'needs_more_facts', repeat('8', 64), '28660000-0000-4000-8000-000000000016', 'production');

insert into hts_rag.hts_rag_provider_responses
  (id, session_id, turn_index, turn_role, determination_id, provider, model_version,
   prompt_version, request_hash, raw_response, raw_response_hash, source_environment)
values ('28660000-0000-4000-8000-000000000007', '28660000-0000-4000-8000-000000000017', 0,
        'classifier', '28660000-0000-4000-8000-000000000006', 'synthetic', 'm', 'p',
        repeat('9', 64), '{}'::jsonb, repeat('a', 64), 'production');

insert into hts_rag.hts_rag_review_events
  (id, subject_type, subject_id, action, source_environment)
values ('28660000-0000-4000-8000-000000000008', 'precedent',
        '28660000-0000-4000-8000-000000000002', 'created', 'production');

insert into hts_rag.hts_rag_product_family_allowlist (product_family, source_environment)
values ('ZZ provenance prod', 'production');

insert into hts_rag.hts_rag_debate_runs
  (id, source_determination_id, session_id, policy_version, case_packet_hash, source_environment)
values ('28660000-0000-4000-8000-000000000010', '28660000-0000-4000-8000-000000000006',
        '28660000-0000-4000-8000-000000000017', 'v2866p', repeat('b', 64), 'production');

do $prod_cross_environment_denials$
declare
  v_table text;
begin
  foreach v_table in array array[
    'hts_rag_rulings', 'hts_rag_product_examples', 'hts_rag_precedents',
    'hts_rag_precedent_rulings', 'hts_rag_extraction_jobs', 'hts_rag_determinations',
    'hts_rag_provider_responses', 'hts_rag_review_events',
    'hts_rag_product_family_allowlist', 'hts_rag_debate_runs'
  ] loop
    begin
      execute format(
        'insert into hts_rag.%1$I select (jsonb_populate_record(null::hts_rag.%1$I, to_jsonb(t) || jsonb_build_object(''source_environment'', ''alsand''))).* from hts_rag.%1$I t limit 1',
        v_table
      );
      raise exception 'production worker forged alsand provenance on %', v_table;
    exception when insufficient_privilege then null;
    end;
  end loop;
end
$prod_cross_environment_denials$;

reset role;
set local role designflow_hts_alsand_worker;

insert into hts_rag.hts_rag_product_examples
  (id, product_family, fixture_version, fixture_hash, input_hash, source_environment)
values ('2866a000-0000-4000-8000-000000000001', 'ZZ provenance alsand', 'v2866a', repeat('c', 64), repeat('d', 64), 'alsand');

insert into hts_rag.hts_rag_precedents
  (id, product_family, fixture_version, prompt_version, classifier_model, verifier_model,
   extraction_version, fixture_hash, input_hash, raw_result_hash, classification_state, source_environment)
values ('2866a000-0000-4000-8000-000000000002', 'ZZ provenance alsand', 'v2866a', 'p', 'c', 'v',
        'e', repeat('e', 64), repeat('f', 64), repeat('0', 64), 'needs_more_facts', 'alsand');

insert into hts_rag.hts_rag_rulings
  (id, ruling_number, full_text, full_text_hash, source_environment)
values ('2866a000-0000-4000-8000-000000000003', 'ZZ-2866-A', 'synthetic', repeat('1', 64), 'alsand');

insert into hts_rag.hts_rag_precedent_rulings
  (id, precedent_id, ruling_id, source_environment)
values ('2866a000-0000-4000-8000-000000000004', '2866a000-0000-4000-8000-000000000002',
        '2866a000-0000-4000-8000-000000000003', 'alsand');

insert into hts_rag.hts_rag_extraction_jobs
  (id, product_example_id, prompt_version, model_version, extraction_version, input_hash, source_environment)
values ('2866a000-0000-4000-8000-000000000005', '2866a000-0000-4000-8000-000000000001',
        'p', 'm', 'e', repeat('2', 64), 'alsand');

insert into hts_rag.hts_rag_determinations
  (id, product_example_id, method, classification_state, result_hash, comparison_key, source_environment)
values ('2866a000-0000-4000-8000-000000000006', '2866a000-0000-4000-8000-000000000001',
        'legacy_ai_cross', 'needs_more_facts', repeat('3', 64), '2866a000-0000-4000-8000-000000000016', 'alsand');

insert into hts_rag.hts_rag_provider_responses
  (id, session_id, turn_index, turn_role, determination_id, provider, model_version,
   prompt_version, request_hash, raw_response, raw_response_hash, source_environment)
values ('2866a000-0000-4000-8000-000000000007', '2866a000-0000-4000-8000-000000000017', 0,
        'classifier', '2866a000-0000-4000-8000-000000000006', 'synthetic', 'm', 'p',
        repeat('4', 64), '{}'::jsonb, repeat('5', 64), 'alsand');

insert into hts_rag.hts_rag_review_events
  (id, subject_type, subject_id, action, source_environment)
values ('2866a000-0000-4000-8000-000000000008', 'precedent',
        '2866a000-0000-4000-8000-000000000002', 'created', 'alsand');

insert into hts_rag.hts_rag_product_family_allowlist (product_family, source_environment)
values ('ZZ provenance alsand', 'alsand');

insert into hts_rag.hts_rag_debate_runs
  (id, source_determination_id, session_id, policy_version, case_packet_hash, source_environment)
values ('2866a000-0000-4000-8000-000000000010', '2866a000-0000-4000-8000-000000000006',
        '2866a000-0000-4000-8000-000000000017', 'v2866a', repeat('6', 64), 'alsand');

do $alsand_cross_environment_denials$
declare
  v_table text;
begin
  foreach v_table in array array[
    'hts_rag_rulings', 'hts_rag_product_examples', 'hts_rag_precedents',
    'hts_rag_precedent_rulings', 'hts_rag_extraction_jobs', 'hts_rag_determinations',
    'hts_rag_provider_responses', 'hts_rag_review_events',
    'hts_rag_product_family_allowlist', 'hts_rag_debate_runs'
  ] loop
    begin
      execute format(
        'insert into hts_rag.%1$I select (jsonb_populate_record(null::hts_rag.%1$I, to_jsonb(t) || jsonb_build_object(''source_environment'', ''production''))).* from hts_rag.%1$I t limit 1',
        v_table
      );
      raise exception 'Alsand worker forged production provenance on %', v_table;
    exception when insufficient_privilege then null;
    end;
  end loop;
end
$alsand_cross_environment_denials$;

-- Shared visibility and bounded cross-environment update remain intentional.
do $alsand_shared_update$
begin
  update hts_rag.hts_rag_rulings set subject = 'updated by alsand'
   where id = '28660000-0000-4000-8000-000000000003';
  if not found then
    raise exception 'Alsand worker cannot update a production-origin row';
  end if;
end
$alsand_shared_update$;

reset role;
set local role designflow_hts_prod_worker;

do $prod_shared_update$
begin
  update hts_rag.hts_rag_rulings set subject = 'updated by production'
   where id = '2866a000-0000-4000-8000-000000000003';
  if not found then
    raise exception 'production worker cannot update an Alsand-origin row';
  end if;
end
$prod_shared_update$;

reset role;

-- ---------------------------------------------------------------------------------
-- Runtime reads: only precedent A, its link and ruling R1; no writes; no other tables.
-- ---------------------------------------------------------------------------------
set local role designflow_hts_prod_runtime;

do $prod_runtime$
begin
  if (select array_agg(id order by id)::text from hts_rag.hts_rag_precedents)
     is distinct from '{27120000-0000-4000-8000-00000000000a}' then
    raise exception 'prod runtime sees unqualified precedents';
  end if;
  if (select array_agg(ruling_id order by ruling_id)::text from hts_rag.hts_rag_precedent_rulings)
     is distinct from '{27120000-0000-4000-8000-000000000011}' then
    raise exception 'prod runtime sees links of unqualified precedents';
  end if;
  if (select array_agg(ruling_number order by ruling_number)::text from hts_rag.hts_rag_rulings)
     is distinct from '{ZZ-R1}' then
    raise exception 'prod runtime sees rulings not relied on by a qualified precedent';
  end if;

  begin
    insert into hts_rag.hts_rag_rulings (ruling_number, full_text, full_text_hash, source_environment)
    values ('ZZ-R8', 'runtime write', repeat('9', 64), 'production');
    raise exception 'runtime role inserted a ruling';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from hts_rag.hts_rag_determinations;
    raise exception 'runtime role read determinations';
  exception when insufficient_privilege then null;
  end;
end
$prod_runtime$;

reset role;
set local role designflow_hts_alsand_runtime;

do $alsand_runtime$
begin
  if (select count(*) from hts_rag.hts_rag_precedents) <> 1
     or (select count(*) from hts_rag.hts_rag_precedent_rulings) <> 1
     or (select count(*) from hts_rag.hts_rag_rulings) <> 1 then
    raise exception 'alsand runtime visibility differs from the qualified operative set';
  end if;

  begin
    update hts_rag.hts_rag_precedents set review_state = 'rejected';
    raise exception 'alsand runtime updated a precedent';
  exception when insufficient_privilege then null;
  end;
end
$alsand_runtime$;

reset role;

-- ---------------------------------------------------------------------------------
-- Browser roles are refused outright.
-- ---------------------------------------------------------------------------------
set local role anon;

do $anon_denied$
begin
  begin
    perform 1 from hts_rag.hts_rag_precedents;
    raise exception 'anon read hts_rag';
  exception when insufficient_privilege then null;
  end;
end
$anon_denied$;

reset role;
set local role authenticated;

do $authenticated_denied$
begin
  begin
    perform 1 from hts_rag.hts_rag_rulings;
    raise exception 'authenticated read hts_rag';
  exception when insufficient_privilege then null;
  end;
end
$authenticated_denied$;

reset role;
