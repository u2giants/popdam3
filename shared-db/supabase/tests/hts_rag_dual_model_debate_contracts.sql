-- Focused contracts for migration 20260908202651 (#2535).
-- The repository's Database Contract Tests workflow runs this against its
-- from-empty ephemeral replay. Every row below is synthetic and rolls back.

do $catalog$
declare
  v_count integer;
begin
  if to_regclass('public.hts_rag_debate_runs') is null then
    raise exception 'public.hts_rag_debate_runs did not replay from empty';
  end if;

  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'hts_rag_debate_runs';
  if v_count <> 27 then
    raise exception 'expected 27 debate-run columns, got %', v_count;
  end if;

  if not has_table_privilege('service_role', 'public.hts_rag_debate_runs', 'SELECT')
     or not has_table_privilege('service_role', 'public.hts_rag_debate_runs', 'INSERT') then
    raise exception 'service_role cannot read and append debate-run audit rows';
  end if;

  if has_table_privilege('service_role', 'public.hts_rag_debate_runs', 'UPDATE')
     or has_table_privilege('service_role', 'public.hts_rag_debate_runs', 'DELETE')
     or has_table_privilege('service_role', 'public.hts_rag_debate_runs', 'TRUNCATE') then
    raise exception 'service_role received a table-wide destructive or mutation privilege';
  end if;

  if has_table_privilege('anon', 'public.hts_rag_debate_runs', 'SELECT')
     or has_table_privilege('authenticated', 'public.hts_rag_debate_runs', 'SELECT') then
    raise exception 'a browser role can read the service-only debate audit';
  end if;

  if not has_column_privilege('service_role', 'public.hts_rag_debate_runs', 'status', 'UPDATE')
     or has_column_privilege('service_role', 'public.hts_rag_debate_runs', 'source_determination_id', 'UPDATE')
     or has_column_privilege('service_role', 'public.hts_rag_debate_runs', 'case_packet_hash', 'UPDATE') then
    raise exception 'worker UPDATE privileges do not preserve immutable run identity';
  end if;

  select count(*) into v_count
    from pg_constraint fk
    join pg_class source_table on source_table.oid = fk.conrelid
    join pg_namespace source_schema on source_schema.oid = source_table.relnamespace
    join pg_class target_table on target_table.oid = fk.confrelid
    join pg_namespace target_schema on target_schema.oid = target_table.relnamespace
   where fk.contype = 'f'
     and fk.conname in (
       'hts_rag_debate_runs_source_determination_id_fkey',
       'hts_rag_debate_runs_precedent_id_fkey',
       'hts_rag_precedents_promotion_source_determination_id_fkey',
       'hts_rag_precedents_promotion_debate_run_id_fkey'
     )
     and source_schema.nspname = 'public'
     and target_schema.nspname = 'public';
  if v_count <> 4 then
    raise exception 'expected four same-connection public HTS foreign keys, got %', v_count;
  end if;
end
$catalog$;

insert into public.hts_rag_product_examples (
  id, product_family, fixture_version, fixture_hash, input_hash, facts
) values (
  '25350000-0000-4000-8000-000000000001',
  'ZZ synthetic debate contract',
  'contract-v1',
  repeat('1', 64),
  repeat('2', 64),
  '{}'::jsonb
);

insert into public.hts_rag_precedents (
  id, product_family, fixture_version, prompt_version, classifier_model,
  verifier_model, extraction_version, fixture_hash, input_hash, raw_result_hash,
  normalized_facts, positive_attributes, negative_attributes, exclusions_checked,
  missing_critical_facts, conflicts, plausible_headings, proposed_hts,
  classification_state, confidence_components
) values (
  '25350000-0000-4000-8000-000000000002',
  'ZZ synthetic debate contract',
  'contract-v1',
  'prompt-v1',
  'synthetic-classifier',
  'synthetic-verifier',
  'extract-v1',
  repeat('3', 64),
  repeat('4', 64),
  repeat('5', 64),
  '{}'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '1234.56.78.90',
  'provisional_complete',
  '{}'::jsonb
);

do $legacy_default$
begin
  if (select promotion_basis
        from public.hts_rag_precedents
       where id = '25350000-0000-4000-8000-000000000002') <> 'legacy_unspecified' then
    raise exception 'a precedent without durable row-specific evidence did not remain legacy_unspecified';
  end if;
end
$legacy_default$;

insert into public.hts_rag_determinations (
  id, product_example_id, precedent_id, method, proposed_hts,
  classification_state, result_hash, comparison_key
) values (
  '25350000-0000-4000-8000-000000000003',
  '25350000-0000-4000-8000-000000000001',
  '25350000-0000-4000-8000-000000000002',
  'rag_shadow',
  '1234.56.78.90',
  'provisional_complete',
  repeat('6', 64),
  '25350000-0000-4000-8000-000000000004'
);

set local role service_role;

insert into public.hts_rag_debate_runs (
  id, source_determination_id, session_id, policy_version, case_packet_hash
) values (
  '25350000-0000-4000-8000-000000000005',
  '25350000-0000-4000-8000-000000000003',
  '25350000-0000-4000-8000-000000000006',
  'promotion-v1',
  repeat('7', 64)
);

do $identity_immutable$
begin
  begin
    update public.hts_rag_debate_runs
       set case_packet_hash = repeat('8', 64)
     where id = '25350000-0000-4000-8000-000000000005';
    raise exception 'worker unexpectedly changed immutable case-packet identity';
  exception
    when insufficient_privilege then null;
  end;
end
$identity_immutable$;

do $fail_closed_promotion$
begin
  begin
    update public.hts_rag_debate_runs
       set status = 'promoted', completed_at = now()
     where id = '25350000-0000-4000-8000-000000000005';
    raise exception 'promoted status accepted without consensus, precedent and passed gate';
  exception
    when check_violation then null;
  end;
end
$fail_closed_promotion$;

update public.hts_rag_debate_runs
   set status = 'promoted',
       consensus_code = '1234567890',
       precedent_id = '25350000-0000-4000-8000-000000000002',
       gate_result = '{"passed": true, "policy": "promotion-v1"}'::jsonb,
       completed_at = now()
 where id = '25350000-0000-4000-8000-000000000005';

reset role;

update public.hts_rag_precedents
   set promotion_gate_result = '{"passed": true}'::jsonb
 where id = '25350000-0000-4000-8000-000000000002';

do $immutable_gate$
begin
  begin
    update public.hts_rag_precedents
       set promotion_gate_result = '{"passed": false}'::jsonb
     where id = '25350000-0000-4000-8000-000000000002';
    raise exception 'promotion_gate_result changed after its first non-null value';
  exception
    when check_violation then null;
  end;
end
$immutable_gate$;

do $dual_provenance_required$
begin
  begin
    update public.hts_rag_precedents
       set promotion_basis = 'dual_model_verified'
     where id = '25350000-0000-4000-8000-000000000002';
    raise exception 'dual_model_verified accepted incomplete typed provenance';
  exception
    when check_violation then null;
  end;
end
$dual_provenance_required$;

update public.hts_rag_precedents
   set promotion_basis = 'dual_model_verified',
       promotion_policy_version = 'promotion-v1',
       promotion_source_determination_id = '25350000-0000-4000-8000-000000000003',
       promotion_debate_run_id = '25350000-0000-4000-8000-000000000005'
 where id = '25350000-0000-4000-8000-000000000002';

do $final_state$
begin
  if not exists (
    select 1
      from public.hts_rag_debate_runs
     where id = '25350000-0000-4000-8000-000000000005'
       and status = 'promoted'
       and consensus_code = '1234567890'
       and gate_result @> '{"passed": true}'::jsonb
       and completed_at is not null
  ) then
    raise exception 'valid promoted debate state did not persist';
  end if;

  if not exists (
    select 1
      from public.hts_rag_precedents
     where id = '25350000-0000-4000-8000-000000000002'
       and promotion_basis = 'dual_model_verified'
       and promotion_debate_run_id = '25350000-0000-4000-8000-000000000005'
  ) then
    raise exception 'complete typed promotion provenance did not persist';
  end if;
end
$final_state$;
