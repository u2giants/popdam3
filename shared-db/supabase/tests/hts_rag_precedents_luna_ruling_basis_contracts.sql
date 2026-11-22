-- Behavioural contract tests for migration 20261225090102 (#278, #6938):
-- luna_ruling_verified promotion_basis, provenance + non-operative check, and
-- per-determination idempotency on BOTH hts_rag and public schemas.
-- Runs inside a rolled-back transaction in Database Contract Tests.

do $contract_hts_rag$
declare
  v_example_id uuid := gen_random_uuid();
  v_det_id uuid := gen_random_uuid();
  v_det_id_2 uuid := gen_random_uuid();
  v_debate_id uuid := gen_random_uuid();
  v_hash text := repeat('a', 64);
  v_hash_b text := repeat('b', 64);
  v_hash_c text := repeat('c', 64);
  v_failed boolean;
begin
  insert into hts_rag.hts_rag_product_examples (
    id, product_family, fixture_version, fixture_hash, input_hash, source_environment
  ) values (
    v_example_id, 'ZZ luna synthetic mug', 'luna-contract-v1', repeat('1', 64), repeat('2', 64), 'alsand'
  );

  insert into hts_rag.hts_rag_determinations (
    id, product_example_id, method, classification_state, result_hash, comparison_key, source_environment
  ) values
    (v_det_id, v_example_id, 'legacy_ai_cross', 'provisional_complete', repeat('3', 64), gen_random_uuid(), 'alsand'),
    (v_det_id_2, v_example_id, 'legacy_ai_cross', 'provisional_complete', repeat('4', 64), gen_random_uuid(), 'alsand');

  insert into hts_rag.hts_rag_debate_runs (
    id, source_determination_id, session_id, policy_version, case_packet_hash, status, source_environment
  ) values (
    v_debate_id, v_det_id_2, gen_random_uuid(), 'v1', repeat('5', 64), 'pending', 'alsand'
  );

  -- 1. Valid luna_ruling_verified row inserts cleanly into hts_rag.hts_rag_precedents.
  insert into hts_rag.hts_rag_precedents (
    product_family, fixture_version, prompt_version, classifier_model, verifier_model,
    extraction_version, fixture_hash, input_hash, raw_result_hash,
    proposed_hts, classification_state, operative_eligible, review_state,
    promotion_basis, promotion_policy_version, promotion_source_determination_id,
    promotion_debate_run_id, promotion_gate_result, source_environment
  ) values (
    'ZZ luna synthetic mug', 'luna-runtime-v1', 'legacy-hts-classifier-v1',
    'openai/gpt-6-luna-20260922', 'cbp_stored_ruling+official_hts',
    'luna-ruling-acceptance-v1', v_hash, v_hash, v_hash,
    '6912.00.44.00', 'provisional_complete', false, 'accepted',
    'luna_ruling_verified', 'luna-ruling-acceptance-v1', v_det_id,
    null, '{"passed": true, "policy_version": "luna-ruling-acceptance-v1"}'::jsonb, 'alsand'
  );

  -- 2. Duplicate luna_ruling_verified for the same source determination is rejected.
  v_failed := false;
  begin
    insert into hts_rag.hts_rag_precedents (
      product_family, fixture_version, prompt_version, classifier_model, verifier_model,
      extraction_version, fixture_hash, input_hash, raw_result_hash,
      proposed_hts, classification_state, operative_eligible, review_state,
      promotion_basis, promotion_policy_version, promotion_source_determination_id,
      promotion_debate_run_id, promotion_gate_result, source_environment
    ) values (
      'ZZ luna synthetic mug', 'luna-runtime-v1', 'legacy-hts-classifier-v1',
      'openai/gpt-6-luna-20260922', 'cbp_stored_ruling+official_hts',
      'luna-ruling-acceptance-v1', v_hash_b, v_hash_b, v_hash_b,
      '6912.00.44.00', 'provisional_complete', false, 'accepted',
      'luna_ruling_verified', 'luna-ruling-acceptance-v1', v_det_id,
      null, '{"passed": true, "policy_version": "luna-ruling-acceptance-v1"}'::jsonb, 'alsand'
    );
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'hts_rag: expected unique_violation for duplicate luna_ruling_verified determination';
  end if;

  -- 3. luna_ruling_verified without passed=true gate_result is rejected.
  v_failed := false;
  begin
    insert into hts_rag.hts_rag_precedents (
      product_family, fixture_version, prompt_version, classifier_model, verifier_model,
      extraction_version, fixture_hash, input_hash, raw_result_hash,
      proposed_hts, classification_state, operative_eligible, review_state,
      promotion_basis, promotion_policy_version, promotion_source_determination_id,
      promotion_debate_run_id, promotion_gate_result, source_environment
    ) values (
      'ZZ luna synthetic mug', 'luna-runtime-v1', 'legacy-hts-classifier-v1',
      'openai/gpt-6-luna-20260922', 'cbp_stored_ruling+official_hts',
      'luna-ruling-acceptance-v1', v_hash_b, v_hash_b, v_hash_b,
      '6912.00.44.00', 'provisional_complete', false, 'accepted',
      'luna_ruling_verified', 'luna-ruling-acceptance-v1', v_det_id_2,
      null, '{"passed": false}'::jsonb, 'alsand'
    );
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'hts_rag: expected check_violation when promotion_gate_result passed is not true';
  end if;

  -- 4. luna_ruling_verified with operative_eligible=true is rejected.
  v_failed := false;
  begin
    insert into hts_rag.hts_rag_precedents (
      product_family, fixture_version, prompt_version, classifier_model, verifier_model,
      extraction_version, fixture_hash, input_hash, raw_result_hash,
      proposed_hts, classification_state, operative_eligible, review_state,
      promotion_basis, promotion_policy_version, promotion_source_determination_id,
      promotion_debate_run_id, promotion_gate_result, source_environment
    ) values (
      'ZZ luna synthetic mug', 'luna-runtime-v1', 'legacy-hts-classifier-v1',
      'openai/gpt-6-luna-20260922', 'cbp_stored_ruling+official_hts',
      'luna-ruling-acceptance-v1', v_hash_b, v_hash_b, v_hash_b,
      '6912.00.44.00', 'provisional_complete', true, 'accepted',
      'luna_ruling_verified', 'luna-ruling-acceptance-v1', v_det_id_2,
      null, '{"passed": true}'::jsonb, 'alsand'
    );
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'hts_rag: expected check_violation when operative_eligible is true on luna_ruling_verified';
  end if;

  -- 5. luna_ruling_verified with a real non-null promotion_debate_run_id is rejected.
  v_failed := false;
  begin
    insert into hts_rag.hts_rag_precedents (
      product_family, fixture_version, prompt_version, classifier_model, verifier_model,
      extraction_version, fixture_hash, input_hash, raw_result_hash,
      proposed_hts, classification_state, operative_eligible, review_state,
      promotion_basis, promotion_policy_version, promotion_source_determination_id,
      promotion_debate_run_id, promotion_gate_result, source_environment
    ) values (
      'ZZ luna synthetic mug', 'luna-runtime-v1', 'legacy-hts-classifier-v1',
      'openai/gpt-6-luna-20260922', 'cbp_stored_ruling+official_hts',
      'luna-ruling-acceptance-v1', v_hash_c, v_hash_c, v_hash_c,
      '6912.00.44.00', 'provisional_complete', false, 'accepted',
      'luna_ruling_verified', 'luna-ruling-acceptance-v1', v_det_id_2,
      v_debate_id, '{"passed": true}'::jsonb, 'alsand'
    );
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'hts_rag: expected check_violation when promotion_debate_run_id is set on luna_ruling_verified';
  end if;
end
$contract_hts_rag$;

do $contract_public$
declare
  v_example_id uuid := gen_random_uuid();
  v_det_id uuid := gen_random_uuid();
  v_det_id_2 uuid := gen_random_uuid();
  v_debate_id uuid := gen_random_uuid();
  v_hash text := repeat('d', 64);
  v_hash_e text := repeat('e', 64);
  v_failed boolean;
begin
  insert into public.hts_rag_product_examples (
    id, product_family, fixture_version, fixture_hash, input_hash
  ) values (
    v_example_id, 'ZZ luna public mug', 'luna-contract-v1', repeat('6', 64), repeat('7', 64)
  );

  insert into public.hts_rag_determinations (
    id, product_example_id, method, classification_state, result_hash, comparison_key
  ) values
    (v_det_id, v_example_id, 'legacy_ai_cross', 'provisional_complete', repeat('8', 64), gen_random_uuid()),
    (v_det_id_2, v_example_id, 'legacy_ai_cross', 'provisional_complete', repeat('9', 64), gen_random_uuid());

  insert into public.hts_rag_debate_runs (
    id, source_determination_id, session_id, policy_version, case_packet_hash, status
  ) values (
    v_debate_id, v_det_id_2, gen_random_uuid(), 'v1', repeat('0', 64), 'pending'
  );

  insert into public.hts_rag_precedents (
    product_family, fixture_version, prompt_version, classifier_model, verifier_model,
    extraction_version, fixture_hash, input_hash, raw_result_hash,
    proposed_hts, classification_state, operative_eligible, review_state,
    promotion_basis, promotion_policy_version, promotion_source_determination_id,
    promotion_debate_run_id, promotion_gate_result
  ) values (
    'ZZ luna public mug', 'luna-runtime-v1', 'legacy-hts-classifier-v1',
    'openai/gpt-6-luna-20260922', 'cbp_stored_ruling+official_hts',
    'luna-ruling-acceptance-v1', v_hash, v_hash, v_hash,
    '6912.00.44.00', 'provisional_complete', false, 'accepted',
    'luna_ruling_verified', 'luna-ruling-acceptance-v1', v_det_id,
    null, '{"passed": true, "policy_version": "luna-ruling-acceptance-v1"}'::jsonb
  );

  v_failed := false;
  begin
    insert into public.hts_rag_precedents (
      product_family, fixture_version, prompt_version, classifier_model, verifier_model,
      extraction_version, fixture_hash, input_hash, raw_result_hash,
      proposed_hts, classification_state, operative_eligible, review_state,
      promotion_basis, promotion_policy_version, promotion_source_determination_id,
      promotion_debate_run_id, promotion_gate_result
    ) values (
      'ZZ luna public mug', 'luna-runtime-v1', 'legacy-hts-classifier-v1',
      'openai/gpt-6-luna-20260922', 'cbp_stored_ruling+official_hts',
      'luna-ruling-acceptance-v1', v_hash_e, v_hash_e, v_hash_e,
      '6912.00.44.00', 'provisional_complete', true, 'accepted',
      'luna_ruling_verified', 'luna-ruling-acceptance-v1', v_det_id_2,
      null, '{"passed": true}'::jsonb
    );
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'public: expected check_violation when operative_eligible is true on luna_ruling_verified';
  end if;

  v_failed := false;
  begin
    insert into public.hts_rag_precedents (
      product_family, fixture_version, prompt_version, classifier_model, verifier_model,
      extraction_version, fixture_hash, input_hash, raw_result_hash,
      proposed_hts, classification_state, operative_eligible, review_state,
      promotion_basis, promotion_policy_version, promotion_source_determination_id,
      promotion_debate_run_id, promotion_gate_result
    ) values (
      'ZZ luna public mug', 'luna-runtime-v1', 'legacy-hts-classifier-v1',
      'openai/gpt-6-luna-20260922', 'cbp_stored_ruling+official_hts',
      'luna-ruling-acceptance-v1', v_hash_e, v_hash_e, v_hash_e,
      '6912.00.44.00', 'provisional_complete', false, 'accepted',
      'luna_ruling_verified', 'luna-ruling-acceptance-v1', v_det_id_2,
      v_debate_id, '{"passed": true}'::jsonb
    );
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'public: expected check_violation when promotion_debate_run_id is set on luna_ruling_verified';
  end if;
end
$contract_public$;
