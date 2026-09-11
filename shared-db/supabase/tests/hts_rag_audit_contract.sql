-- Contract tests for the #2067 HTS RAG comparison and raw-response audit contract
-- (migration 20260902062827). Run after the migrations in an ephemeral database.
--
-- Every value below is SYNTHETIC and labelled as such: 'ZZ Fixture' names, invented
-- hashes, and a raw_response object that contains no product description of any kind.
-- This repository is public; nothing here may resemble a real customer, order, or
-- product text.
--
-- This file asserts BEHAVIOUR, not object names. Every assertion below was written so
-- that it can go red: the security assertions are exercised AS the roles they constrain,
-- because the table owner bypasses grants entirely and an owner-run statement proves
-- nothing about what service_role or authenticated can actually do.
begin;

-- The exposure detector is defined once so the assertion and the probe that proves the
-- detector works are literally the same query. pg_class, not information_schema:
-- role_table_grants omits every grant whose grantee is PUBLIC.
create function pg_temp.hts_rag_provider_exposure() returns boolean language sql stable as $fn$
  select exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where n.nspname = 'public' and c.relname = 'hts_rag_provider_responses'
       and (a.grantee = 0
            or a.grantee = (select oid from pg_roles where rolname = 'anon')
            or a.grantee = (select oid from pg_roles where rolname = 'authenticated'))
  );
$fn$;

do $$
declare v_count integer; v_cols text; v_def text;
begin
  if to_regclass('public.hts_rag_provider_responses') is null then
    raise exception 'public.hts_rag_provider_responses does not exist';
  end if;

  -- RLS enabled, not merely policied.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='hts_rag_provider_responses' and c.relrowsecurity) then
    raise exception 'row level security is not enabled on hts_rag_provider_responses';
  end if;

  -- Service-only: no browser role and no PUBLIC holds anything at all.
  if pg_temp.hts_rag_provider_exposure() then
    raise exception 'anon, authenticated or PUBLIC holds a grant on hts_rag_provider_responses';
  end if;

  -- Bounded writes. No table-wide UPDATE, no DELETE, no TRUNCATE for anybody.
  -- GRANTEE-SCOPED: information_schema reports the OWNER's implicit privileges as
  -- grants too, so an unscoped form is red on every correctly built table.
  if exists (select 1 from information_schema.role_table_grants
              where table_schema='public' and table_name='hts_rag_provider_responses'
                and grantee in ('service_role','authenticated','anon','PUBLIC')
                and privilege_type in ('UPDATE','DELETE','TRUNCATE')) then
    raise exception 'hts_rag_provider_responses received a table-wide mutation grant';
  end if;

  select string_agg(column_name, ',' order by column_name) into v_cols
    from information_schema.column_privileges
   where table_schema='public' and table_name='hts_rag_provider_responses'
     and grantee='service_role' and privilege_type='UPDATE';
  if coalesce(v_cols,'') <> 'enrichment_state,parse_error_code,parse_state,parsed_payload,released_at' then
    raise exception 'updatable provider-response columns are not the five interpretation columns, got %', coalesce(v_cols,'<none>');
  end if;

  -- A policy set with no grant behind it is dead, and a grant with no policy is
  -- unreachable under RLS. Both directions, for the one role that may write.
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='hts_rag_provider_responses'
                    and 'service_role' = any(roles)) then
    raise exception 'hts_rag_provider_responses has no backend policy, so RLS blocks the only role with grants';
  end if;

  -- The determination immutability ceiling the new comparison columns rely on.
  select count(*) into v_count from information_schema.column_privileges
   where table_schema='public' and table_name='hts_rag_determinations'
     and grantee='service_role' and privilege_type='UPDATE';
  if v_count <> 1 then raise exception 'expected exactly one updatable determination column, got %', v_count; end if;
  if exists (select 1 from information_schema.column_privileges
              where table_schema='public' and table_name='hts_rag_determinations'
                and grantee='service_role' and privilege_type='UPDATE'
                and column_name in ('comparison_category','comparison_details','session_id','completion_key')) then
    raise exception 'a new comparison column became updatable, so the comparison taxonomy is not immutable';
  end if;

  -- Administrator review must survive, gated by a real role test.
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='hts_rag_determinations'
                    and cmd in ('SELECT','ALL') and 'authenticated' = any(roles)
                    and position('has_role' in coalesce(qual,'')) > 0) then
    raise exception 'the administrator-gated read policy on hts_rag_determinations is missing or loosened';
  end if;

  -- Index shape, not index name.
  select indexdef into v_def from pg_indexes
   where schemaname='public' and indexname='hts_rag_provider_responses_determination_idx';
  if v_def is null or position('WHERE' in v_def) = 0 then
    raise exception 'the determination linkage index is missing or lost its partial predicate: %', coalesce(v_def,'<missing>');
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='hts_rag_determinations_comparison_category_idx') then
    raise exception 'hts_rag_determinations_comparison_category_idx is missing';
  end if;
end $$;

-- A detector never seen to fire is not evidence. Inject a real grant inside a
-- subtransaction, require the detector to catch it, then roll it back.
do $$
declare v_detected boolean;
begin
  begin
    execute 'grant select on public.hts_rag_provider_responses to public';
    v_detected := pg_temp.hts_rag_provider_exposure();
    raise exception using errcode = '22000', message = 'hts_rag_provider_probe_rollback';
  exception when others then
    if sqlerrm <> 'hts_rag_provider_probe_rollback' then raise; end if;
  end;
  if not coalesce(v_detected, false) then
    raise exception 'the provider-response exposure detector did not fire on an injected PUBLIC grant, so it proves nothing';
  end if;
  if pg_temp.hts_rag_provider_exposure() then
    raise exception 'the injected PUBLIC grant did not roll back';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Behavioural fixtures. All synthetic.
-- ---------------------------------------------------------------------------

insert into public.hts_rag_product_examples(id,product_family,fixture_version,fixture_hash,input_hash)
values ('a1111111-1111-4111-8111-111111111111','ZZ Fixture family','zz-fixture-v1',repeat('1',64),repeat('2',64));

insert into public.hts_rag_precedents(id,product_family,fixture_version,prompt_version,classifier_model,verifier_model,extraction_version,fixture_hash,input_hash,raw_result_hash,classification_state)
values ('a2222222-2222-4222-8222-222222222222','ZZ Fixture family','zz-fixture-v1','zz-prompt-v1','zz-classifier-v1','zz-verifier-v1','zz-extract-v1',repeat('1',64),repeat('2',64),repeat('3',64),'provisional_complete');

insert into public.hts_rag_determinations(id,product_example_id,precedent_id,method,proposed_hts,classification_state,result_hash,comparison_key,comparison_category,comparison_details,session_id,completion_key)
values ('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222','rag_shadow','6913.10.50','provisional_complete',repeat('4',64),'a4444444-4444-4444-8444-444444444444','agree_at_heading','{"differing_digits": 4}'::jsonb,'a5555555-5555-4555-8555-555555555555','zz-completion-key-1');

insert into public.hts_rag_extraction_jobs(id,product_example_id,prompt_version,model_version,extraction_version,input_hash,raw_extraction,parse_state,max_attempts)
values ('a6666666-6666-4666-8666-666666666666','a1111111-1111-4111-8111-111111111111','zz-prompt-v1','zz-model-v1','zz-extract-v1',repeat('2',64),'{"material": "zz-fixture-material"}'::jsonb,'parsed',3);

do $$
declare v_default text;
begin
  -- Rows written before this contract must land in the neutral category, not silently
  -- become a comparison verdict nobody made.
  insert into public.hts_rag_determinations(id,product_example_id,precedent_id,method,classification_state,result_hash,comparison_key)
  values ('a7777777-7777-4777-8777-777777777777','a1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222','rag_shadow','needs_more_facts',repeat('5',64),'a4444444-4444-4444-8444-444444444444');
  select comparison_category into v_default from public.hts_rag_determinations where id='a7777777-7777-4777-8777-777777777777';
  if v_default <> 'not_compared' then raise exception 'a determination without an explicit comparison defaulted to %', v_default; end if;
end $$;

-- ---------------------------------------------------------------------------
-- The provider-response contract, exercised AS service_role. An owner insert would
-- pass with every grant revoked.
-- ---------------------------------------------------------------------------

do $$
declare v_released timestamptz;
begin
  set local role service_role;

  insert into public.hts_rag_provider_responses
    (id,session_id,turn_index,turn_role,determination_id,extraction_job_id,provider,model_version,prompt_version,request_hash,raw_response,raw_response_hash)
  values ('a8888888-8888-4888-8888-888888888888','a5555555-5555-4555-8555-555555555555',0,'classifier',
          'a3333333-3333-4333-8333-333333333333','a6666666-6666-4666-8666-666666666666',
          'zz-provider','zz-model-v1','zz-prompt-v1',repeat('6',64),
          '{"zz_fixture": "structured turn payload, no customer text"}'::jsonb,repeat('7',64));

  insert into public.hts_rag_provider_responses
    (session_id,turn_index,turn_role,determination_id,provider,model_version,prompt_version,request_hash,raw_response,raw_response_hash)
  values ('a5555555-5555-4555-8555-555555555555',1,'verifier','a3333333-3333-4333-8333-333333333333',
          'zz-provider','zz-model-v1','zz-prompt-v1',repeat('8',64),
          '{"zz_fixture": "second turn"}'::jsonb,repeat('9',64));

  -- The parse/enrichment interpretation and the release stamp are the writable surface.
  update public.hts_rag_provider_responses
     set parse_state='parsed', parsed_payload='{"zz_fixture": true}'::jsonb, released_at=clock_timestamp()
   where id='a8888888-8888-4888-8888-888888888888';
  if not found then raise exception 'service_role could not record the parse result of a provider turn'; end if;

  select released_at into v_released from public.hts_rag_provider_responses where id='a8888888-8888-4888-8888-888888888888';
  if v_released is null then raise exception 'the release stamp did not persist'; end if;

  -- The raw artifact itself is immutable. This must fail for a PRIVILEGE reason.
  begin
    update public.hts_rag_provider_responses set raw_response='{"rewritten": true}'::jsonb
     where id='a8888888-8888-4888-8888-888888888888';
    reset role;
    raise exception 'service_role rewrote a stored raw provider response';
  exception when insufficient_privilege then
    null;
  end;

  -- History cannot be erased.
  begin
    delete from public.hts_rag_provider_responses where id='a8888888-8888-4888-8888-888888888888';
    reset role;
    raise exception 'service_role deleted a stored provider response';
  exception when insufficient_privilege then
    null;
  end;

  reset role;
exception when others then
  reset role;
  raise;
end $$;

-- ---------------------------------------------------------------------------
-- Negative cases. Each is caught on its NAMED constraint, so an unrelated violation
-- with the same SQLSTATE cannot be mistaken for the constraint under test.
-- ---------------------------------------------------------------------------

do $$
declare v_constraint text;
begin
  -- Completion idempotency: the second completion write is refused.
  begin
    insert into public.hts_rag_determinations(product_example_id,precedent_id,method,classification_state,result_hash,comparison_key,session_id,completion_key)
    values ('a1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222','rag_shadow','provisional_complete',repeat('a',64),'a4444444-4444-4444-8444-444444444444','a5555555-5555-4555-8555-555555555555','zz-completion-key-1');
    raise exception 'a duplicate completion key was accepted, so completion is not idempotent';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_determinations_completion_key_uq' then
      raise exception 'wrong constraint rejected the duplicate completion: %', v_constraint;
    end if;
  end;

  -- A completion key with no session names an event nobody can locate.
  begin
    insert into public.hts_rag_determinations(product_example_id,precedent_id,method,classification_state,result_hash,comparison_key,completion_key)
    values ('a1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222','rag_shadow','provisional_complete',repeat('b',64),'a4444444-4444-4444-8444-444444444444','zz-completion-key-2');
    raise exception 'a completion key was accepted with no session identity';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_determinations_completion_session_chk' then
      raise exception 'wrong constraint rejected the sessionless completion: %', v_constraint;
    end if;
  end;

  -- The comparison taxonomy is bounded. Free text is exactly what must not land here.
  begin
    insert into public.hts_rag_determinations(product_example_id,precedent_id,method,classification_state,result_hash,comparison_key,comparison_category)
    values ('a1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222','rag_shadow','provisional_complete',repeat('c',64),'a4444444-4444-4444-8444-444444444444','looks about right to me');
    raise exception 'an unbounded comparison category was accepted';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_determinations_comparison_category_chk' then
      raise exception 'wrong constraint rejected the free-text category: %', v_constraint;
    end if;
  end;

  -- Bounded retry: a job that has spent its budget cannot still be waiting to run.
  begin
    insert into public.hts_rag_extraction_jobs(product_example_id,prompt_version,model_version,extraction_version,input_hash,status,attempt_count,max_attempts)
    values ('a1111111-1111-4111-8111-111111111111','zz-prompt-v2','zz-model-v1','zz-extract-v1',repeat('d',64),'pending',3,3);
    raise exception 'a pending job survived past its retry ceiling, so retries are unbounded';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_extraction_jobs_retry_budget_chk' then
      raise exception 'wrong constraint rejected the exhausted pending job: %', v_constraint;
    end if;
  end;

  -- A dead letter is terminal and must carry its reason.
  begin
    insert into public.hts_rag_extraction_jobs(product_example_id,prompt_version,model_version,extraction_version,input_hash,status,completed_at,claimed_at,claimed_by,dead_lettered_at)
    values ('a1111111-1111-4111-8111-111111111111','zz-prompt-v3','zz-model-v1','zz-extract-v1',repeat('e',64),'failed',now(),now(),'zz-worker',now());
    raise exception 'a dead letter was recorded with no reason';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_extraction_jobs_dead_letter_pair_chk' then
      raise exception 'wrong constraint rejected the reasonless dead letter: %', v_constraint;
    end if;
  end;

  -- A parse state without an artifact is a claim about nothing.
  begin
    insert into public.hts_rag_extraction_jobs(product_example_id,prompt_version,model_version,extraction_version,input_hash,parse_state)
    values ('a1111111-1111-4111-8111-111111111111','zz-prompt-v4','zz-model-v1','zz-extract-v1',repeat('f',64),'parsed');
    raise exception 'a job claimed a parsed state with no durable extraction artifact';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_extraction_jobs_parse_artifact_chk' then
      raise exception 'wrong constraint rejected the artifact-less parse: %', v_constraint;
    end if;
  end;

  -- Ordered multi-turn linkage: one row per role per turn in a session.
  begin
    insert into public.hts_rag_provider_responses
      (session_id,turn_index,turn_role,determination_id,provider,model_version,prompt_version,request_hash,raw_response,raw_response_hash)
    values ('a5555555-5555-4555-8555-555555555555',0,'classifier','a3333333-3333-4333-8333-333333333333',
            'zz-provider','zz-model-v1','zz-prompt-v1',repeat('0',64),'{"zz_fixture": "duplicate turn"}'::jsonb,repeat('1',64));
    raise exception 'a duplicate turn index was accepted, so the turn order is not recoverable';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_provider_responses_turn_uq' then
      raise exception 'wrong constraint rejected the duplicate turn: %', v_constraint;
    end if;
  end;

  -- An artifact attributable to nothing.
  begin
    insert into public.hts_rag_provider_responses
      (session_id,turn_index,turn_role,provider,model_version,prompt_version,request_hash,raw_response,raw_response_hash)
    values ('a5555555-5555-4555-8555-555555555555',9,'classifier','zz-provider','zz-model-v1','zz-prompt-v1',
            repeat('2',64),'{"zz_fixture": "orphan"}'::jsonb,repeat('3',64));
    raise exception 'a provider response was stored with neither a determination nor a job';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_provider_responses_subject_chk' then
      raise exception 'wrong constraint rejected the unattributable turn: %', v_constraint;
    end if;
  end;

  -- Persist before release: a turn cannot have been released before it was stored.
  begin
    insert into public.hts_rag_provider_responses
      (session_id,turn_index,turn_role,determination_id,provider,model_version,prompt_version,request_hash,raw_response,raw_response_hash,persisted_at,released_at)
    values ('a5555555-5555-4555-8555-555555555555',10,'classifier','a3333333-3333-4333-8333-333333333333',
            'zz-provider','zz-model-v1','zz-prompt-v1',repeat('4',64),'{"zz_fixture": "released early"}'::jsonb,repeat('5',64),
            timestamptz '2026-01-02 00:00:00+00', timestamptz '2026-01-01 00:00:00+00');
    raise exception 'a provider turn was released before it was persisted';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_provider_responses_release_order_chk' then
      raise exception 'wrong constraint rejected the early release: %', v_constraint;
    end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Role-scoped reads. An RLS or grant mistake becomes an incident in the browser roles,
-- so assert what those roles can actually do rather than what the catalog claims.
-- ---------------------------------------------------------------------------

do $$
begin
  set local role authenticated;
  begin
    perform 1 from public.hts_rag_provider_responses;
    reset role;
    raise exception 'an authenticated session could read raw provider responses';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;

do $$
begin
  set local role anon;
  begin
    perform 1 from public.hts_rag_provider_responses;
    reset role;
    raise exception 'the anonymous browser role could read raw provider responses';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;

-- A non-administrator authenticated session still sees no determination rows, so the
-- new comparison columns did not open a read path of their own.
do $$
declare v_count integer;
begin
  set local role authenticated;
  select count(*) into v_count from public.hts_rag_determinations;
  if v_count <> 0 then raise exception 'a non-administrator authenticated session read % determination row(s)', v_count; end if;
  reset role;
exception when others then
  reset role;
  raise;
end $$;

rollback;
