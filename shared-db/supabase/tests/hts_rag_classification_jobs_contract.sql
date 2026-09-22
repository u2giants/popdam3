-- Fail the apply on a wrong catalog contract, in addition to behavioral CI.
-- LOGIN is provisioned separately for the actual backend connections; this
-- migration neither grants LOGIN nor forbids an already provisioned login.
do $verify$
declare
  v_environment text;
  v_role text;
  v_prefix text;
  v_expression text;
  v_columns text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'hts_rag' and c.relname = 'hts_rag_classification_jobs'
        and c.relkind = 'r' and c.relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'hts_rag.hts_rag_determinations'::regclass
        and relkind = 'r') then
    raise exception 'VERIFY FAILED: exact jobs/determination relation contract';
  end if;
  if not exists (select 1 from pg_constraint
      where conrelid = 'hts_rag.hts_rag_classification_jobs'::regclass and contype = 'f'
        and confrelid = 'hts_rag.hts_rag_determinations'::regclass and confdeltype = 'r'
        and pg_get_constraintdef(oid) = 'FOREIGN KEY (determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE RESTRICT')
     or not exists (select 1 from pg_constraint
      where conrelid = 'hts_rag.hts_rag_classification_jobs'::regclass and contype = 'u'
        and pg_get_constraintdef(oid) = 'UNIQUE (determination_id, turn_index)')
     or not exists (select 1 from pg_constraint
      where conrelid = 'hts_rag.hts_rag_provider_responses'::regclass and contype = 'u'
        and pg_get_constraintdef(oid) = 'UNIQUE (session_id, turn_role, turn_index)') then
    raise exception 'VERIFY FAILED: exact FK or job/provider idempotency contract';
  end if;
  if (select count(*) from pg_policies where schemaname = 'hts_rag'
      and tablename = 'hts_rag_classification_jobs') <> 6 then
    raise exception 'VERIFY FAILED: jobs must have exactly six policies';
  end if;
  if not exists (select 1 from pg_attribute a
      where a.attrelid = 'hts_rag.hts_rag_classification_jobs'::regclass
        and a.attname = 'source_environment' and a.atttypid = 'text'::regtype and a.attnotnull
        and not exists (select 1 from pg_attrdef d where d.adrelid = a.attrelid and d.adnum = a.attnum))
     or not exists (select 1 from pg_constraint
      where conrelid = 'hts_rag.hts_rag_classification_jobs'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) = 'CHECK ((source_environment = ANY (ARRAY[''production''::text, ''alsand''::text])))') then
    raise exception 'VERIFY FAILED: exact explicit-provenance column/domain contract';
  end if;
  foreach v_environment in array array['production', 'alsand'] loop
    v_role := case v_environment when 'production' then 'designflow_hts_prod_worker'
      else 'designflow_hts_alsand_worker' end;
    v_prefix := case v_environment when 'production' then 'hts_rag_prod_worker'
      else 'hts_rag_alsand_worker' end;
    v_expression := format('(source_environment = %L::text)', v_environment);
    if not exists (select 1 from pg_roles where rolname = v_role
        and not rolsuper and not rolbypassrls and not rolinherit
        and not rolcreaterole and not rolcreatedb and not rolreplication) then
      raise exception 'VERIFY FAILED: worker privilege attributes for %', v_role;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'hts_rag'
        and tablename = 'hts_rag_classification_jobs' and policyname = v_prefix || '_access'
        and cmd = 'SELECT' and roles = array[v_role]::name[]
        and qual = v_expression and with_check is null)
       or not exists (select 1 from pg_policies where schemaname = 'hts_rag'
        and tablename = 'hts_rag_classification_jobs' and policyname = v_prefix || '_insert'
        and cmd = 'INSERT' and roles = array[v_role]::name[]
        and qual is null and with_check = v_expression)
       or not exists (select 1 from pg_policies where schemaname = 'hts_rag'
        and tablename = 'hts_rag_classification_jobs' and policyname = v_prefix || '_update'
        and cmd = 'UPDATE' and roles = array[v_role]::name[]
        and qual = v_expression and with_check = v_expression) then
      raise exception 'VERIFY FAILED: exact environment policies for %', v_role;
    end if;
    select string_agg(attname, ',' order by attname) into v_columns from pg_attribute
      where attrelid = 'hts_rag.hts_rag_classification_jobs'::regclass and attnum > 0 and not attisdropped
        and has_column_privilege(v_role, attrelid, attnum, 'UPDATE');
    if v_columns is distinct from 'actual_cost_usd,applied_at,applied_by,attempt_count,claimed_at,claimed_by,error_code,error_message,estimated_cost_usd,lease_expires_at,notified_at,result,status,updated_at'
       or has_table_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or not has_table_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'SELECT')
       or not has_table_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'INSERT') then
      raise exception 'VERIFY FAILED: exact worker grants for %', v_role;
    end if;
  end loop;
end
$verify$;

-- Issue #2995: synthetic classification-job contracts.
-- Database Contract Tests wraps this file in BEGIN/ROLLBACK. No live data is used.
-- Operational jobs are environment-isolated; reusable HTS evidence remains shared.
grant designflow_hts_prod_worker, designflow_hts_alsand_worker,
      designflow_hts_prod_runtime, designflow_hts_alsand_runtime to postgres;

do $classification_jobs$
declare
  v_environment text;
  v_other_environment text;
  v_role text;
  v_column text;
  v_privilege text;
  v_status text;
  v_patch jsonb;
  v_fixture jsonb;
  v_job hts_rag.hts_rag_classification_jobs%rowtype;
  v_example uuid;
  v_determination uuid;
  v_session uuid;
  v_job_id uuid;
  v_claim_token text;
  v_count integer;
begin
  if not (select relrowsecurity from pg_class
           where oid = 'hts_rag.hts_rag_classification_jobs'::regclass) then
    raise exception 'classification jobs does not enforce RLS';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'hts_rag' and table_name = 'hts_rag_classification_jobs'
                and column_name = 'source_environment' and column_default is not null) then
    raise exception 'job provenance has an implicit default';
  end if;
  if (select count(*) from pg_policies where schemaname = 'hts_rag'
       and tablename = 'hts_rag_classification_jobs') <> 6 then
    raise exception 'jobs must have exactly six operation-specific worker policies';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'hts_rag'
      and indexname = 'hts_rag_classification_jobs_status_idx'
      and indexdef like '%(status, created_at)')
     or not exists (select 1 from pg_indexes where schemaname = 'hts_rag'
      and indexname = 'hts_rag_classification_jobs_owner_idx'
      and indexdef like '%(owner_key, status)')
     or not exists (select 1 from pg_indexes where schemaname = 'hts_rag'
      and indexname = 'hts_rag_classification_jobs_rfq_idx'
      and indexdef like '%(rfq_id, rfq_item_id)') then
    raise exception 'job polling, owner or RFQ index differs from its contract';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'hts_rag' and table_name = 'hts_rag_classification_jobs'
         and column_name in ('rfq_id', 'rfq_item_id')
         and data_type = 'integer' and is_nullable = 'YES') <> 2 then
    raise exception 'RFQ pointers must be nullable integers';
  end if;

  -- Seed both environments before testing isolation, using real worker rights.
  foreach v_environment in array array['production', 'alsand'] loop
    v_role := case v_environment when 'production' then 'designflow_hts_prod_worker'
                 else 'designflow_hts_alsand_worker' end;
    execute format('set local role %I', v_role);
    v_example := gen_random_uuid();
    v_determination := gen_random_uuid();
    v_session := gen_random_uuid();
    insert into hts_rag.hts_rag_product_examples
      (id, product_family, fixture_version, fixture_hash, input_hash, source_environment)
    values (v_example, 'ZZ classification jobs ' || v_environment, 'contract-2995-' || v_environment,
            repeat('1', 64), repeat('2', 64), v_environment);
    insert into hts_rag.hts_rag_determinations
      (id, product_example_id, method, classification_state, result_hash,
       comparison_key, source_environment)
    values (v_determination, v_example, 'legacy_ai_cross', 'needs_more_facts',
            repeat('3', 64), gen_random_uuid(), v_environment);
    insert into hts_rag.hts_rag_classification_jobs
      (determination_id, session_id, turn_index, kind, owner_key, input, source_environment)
    values (v_determination, v_session, 0, 'initial',
            'ZZ contract-2995 ' || v_environment, '{"synthetic":true}', v_environment)
    returning * into v_job;
    if v_job.id is null or v_job.status <> 'queued' or v_job.source <> 'hts_lookup'
       or v_job.attempt_count <> 0 or v_job.max_attempts <> 3
       or v_job.created_at is null or v_job.updated_at is null then
      raise exception 'job creation defaults differ for %', v_role;
    end if;
    -- The answer turn and RFQ source are also valid; no application-database FK exists.
    insert into hts_rag.hts_rag_classification_jobs
      (determination_id, session_id, turn_index, kind, owner_key, input,
       source, rfq_id, rfq_item_id, source_environment)
    values (v_determination, v_session, 1, 'answer',
            'ZZ contract-2995 ' || v_environment, '{"synthetic":true}',
            'rfq', -2995, -2995, v_environment);
    execute 'reset role';
  end loop;

  foreach v_environment in array array['production', 'alsand'] loop
    v_other_environment := case v_environment when 'production' then 'alsand' else 'production' end;
    v_role := case v_environment when 'production' then 'designflow_hts_prod_worker'
                 else 'designflow_hts_alsand_worker' end;
    execute format('set local role %I', v_role);
    select * into strict v_job from hts_rag.hts_rag_classification_jobs
     where owner_key = 'ZZ contract-2995 ' || v_environment and turn_index = 0;
    v_job_id := v_job.id;
    v_determination := v_job.determination_id;
    v_session := v_job.session_id;
    v_fixture := to_jsonb(v_job);
    if (select count(*) from hts_rag.hts_rag_classification_jobs
         where owner_key = 'ZZ contract-2995 ' || v_other_environment) <> 0 then
      raise exception '% can SELECT cross-environment operational jobs', v_role;
    end if;
    update hts_rag.hts_rag_classification_jobs set updated_at = clock_timestamp()
     where owner_key = 'ZZ contract-2995 ' || v_other_environment and turn_index = 1;
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception '% changed another environment job', v_role; end if;
    update hts_rag.hts_rag_classification_jobs
       set status = 'running', claimed_at = clock_timestamp(), claimed_by = v_role,
           lease_expires_at = clock_timestamp() + interval '5 minutes',
           attempt_count = attempt_count + 1
     where owner_key = 'ZZ contract-2995 ' || v_other_environment and status = 'queued';
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception '% claimed another environment job', v_role; end if;
    update hts_rag.hts_rag_classification_jobs
       set status = 'cancelled', result = '{"cross_environment_attempt":true}'
     where owner_key = 'ZZ contract-2995 ' || v_other_environment;
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception '% finalized another environment job', v_role; end if;

    -- Compare-and-set claim: one row returned, then zero for the same queued predicate.
    with claimed as (
      update hts_rag.hts_rag_classification_jobs
         set status = 'running', claimed_at = clock_timestamp(), claimed_by = v_role,
             lease_expires_at = clock_timestamp() + interval '5 minutes',
             attempt_count = attempt_count + 1, updated_at = clock_timestamp()
       where id = v_job_id and status = 'queued' and attempt_count < max_attempts
       returning id
    ) select count(*) into v_count from claimed;
    if v_count <> 1 then raise exception '% did not claim exactly one queued job', v_role; end if;
    with claimed as (
      update hts_rag.hts_rag_classification_jobs
         set status = 'running', claimed_by = 'second-claim'
       where id = v_job_id and status = 'queued' and attempt_count < max_attempts
       returning id
    ) select count(*) into v_count from claimed;
    if v_count <> 0 then raise exception '% claimed the same job twice', v_role; end if;
    if not exists (select 1 from hts_rag.hts_rag_classification_jobs
                    where id = v_job_id and claimed_by = v_role and attempt_count = 1
                      and claimed_at is not null and lease_expires_at > claimed_at) then
      raise exception '% lost lease details', v_role;
    end if;

    -- Cloud Tasks addresses a job ID; both normal and expired-lease claims use
    -- the primary key, rather than scanning all leased jobs.
    update hts_rag.hts_rag_classification_jobs
       set claimed_by = v_role || '-retry', attempt_count = attempt_count + 1
     where id = v_job_id and status = 'running' and lease_expires_at < now()
       and attempt_count < max_attempts;
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception '% reclaimed an active lease', v_role; end if;
    update hts_rag.hts_rag_classification_jobs
       set lease_expires_at = now() - interval '1 second'
     where id = v_job_id and claimed_by = v_role;
    v_claim_token := v_role || '-retry';
    update hts_rag.hts_rag_classification_jobs
       set claimed_by = v_claim_token, claimed_at = now(),
           lease_expires_at = now() + interval '5 minutes', attempt_count = attempt_count + 1
     where id = v_job_id and status = 'running' and lease_expires_at < now()
       and attempt_count < max_attempts;
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '% could not reclaim expired lease', v_role; end if;
    update hts_rag.hts_rag_classification_jobs set status = 'ready'
     where id = v_job_id and claimed_by = v_role;
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception '% stale claimant completed a job', v_role; end if;

    -- Exercise every mutable field, plus every documented status.
    foreach v_status in array array['needs_answer', 'ready', 'failed', 'cancelled', 'applied'] loop
      update hts_rag.hts_rag_classification_jobs
         set status = v_status, result = '{"synthetic":true,"passed":true}',
             error_code = 'ZZ-2995', error_message = 'synthetic',
             estimated_cost_usd = 0.01, actual_cost_usd = 0.005,
             notified_at = clock_timestamp(), applied_at = clock_timestamp(),
             applied_by = '{"synthetic":true}', updated_at = clock_timestamp()
       where id = v_job_id and claimed_by = v_claim_token;
      get diagnostics v_count = row_count;
      if v_count <> 1 then raise exception '% cannot finalize job as %', v_role, v_status; end if;
    end loop;
    if not exists (select 1 from hts_rag.hts_rag_classification_jobs
                    where id = v_job_id and status = 'applied'
                      and result = '{"synthetic":true,"passed":true}'::jsonb
                      and actual_cost_usd = 0.005 and applied_by = '{"synthetic":true}'::jsonb) then
      raise exception '% finalization did not persist', v_role;
    end if;

    foreach v_privilege in array array['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', v_privilege) then
        raise exception '% holds forbidden table-wide %', v_role, v_privilege;
      end if;
    end loop;
    foreach v_column in array array[
      'id', 'determination_id', 'session_id', 'turn_index', 'kind', 'owner_key',
      'created_by', 'input', 'rfq_id', 'rfq_item_id', 'source',
      'source_environment', 'max_attempts', 'created_at'
    ] loop
      if has_column_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', v_column, 'UPDATE') then
        raise exception '% has UPDATE on immutable %', v_role, v_column;
      end if;
      begin
        execute format('update hts_rag.hts_rag_classification_jobs set %1$I = %1$I where id = $1', v_column)
          using v_job_id;
        raise exception '% updated immutable %', v_role, v_column;
      exception when insufficient_privilege then null;
      end;
    end loop;
    begin
      delete from hts_rag.hts_rag_classification_jobs where id = v_job_id;
      raise exception '% deleted a job', v_role;
    exception when insufficient_privilege then null;
    end;
    begin
      truncate hts_rag.hts_rag_classification_jobs;
      raise exception '% truncated jobs', v_role;
    exception when insufficient_privilege then null;
    end;

    -- Fresh IDs ensure each negative fails for its intended reason, not a duplicate PK.
    begin
      insert into hts_rag.hts_rag_classification_jobs
      select (jsonb_populate_record(null::hts_rag.hts_rag_classification_jobs,
              v_fixture || jsonb_build_object('id', gen_random_uuid()))).*;
      raise exception '% duplicated a determination turn', v_role;
    exception when unique_violation then null;
    end;
    begin
      insert into hts_rag.hts_rag_classification_jobs
      select (jsonb_populate_record(null::hts_rag.hts_rag_classification_jobs,
              v_fixture || jsonb_build_object('id', gen_random_uuid(),
                                             'determination_id', gen_random_uuid()))).*;
      raise exception '% inserted an orphan determination', v_role;
    exception when foreign_key_violation then null;
    end;
    foreach v_patch in array array[
      '{"turn_index":-1}'::jsonb, '{"kind":"invalid"}'::jsonb,
      '{"status":"invalid"}'::jsonb, '{"source":"invalid"}'::jsonb,
      '{"attempt_count":-1}'::jsonb, '{"max_attempts":0}'::jsonb
    ] loop
      begin
        insert into hts_rag.hts_rag_classification_jobs
        select (jsonb_populate_record(null::hts_rag.hts_rag_classification_jobs,
                v_fixture || jsonb_build_object('id', gen_random_uuid(), 'turn_index', 2) || v_patch)).*;
        raise exception '% accepted invalid job field %', v_role, v_patch;
      exception when check_violation then null;
      end;
    end loop;
    foreach v_column in array array['determination_id', 'session_id', 'turn_index',
                                    'kind', 'status', 'owner_key', 'input', 'source',
                                    'attempt_count', 'max_attempts', 'created_at', 'updated_at'] loop
      begin
        insert into hts_rag.hts_rag_classification_jobs
        select (jsonb_populate_record(null::hts_rag.hts_rag_classification_jobs,
                v_fixture || jsonb_build_object('id', gen_random_uuid(), 'turn_index', 2, v_column, null))).*;
        raise exception '% accepted NULL %', v_role, v_column;
      exception when not_null_violation then null;
      end;
    end loop;
    foreach v_patch in array array[
      jsonb_build_object('source_environment', v_other_environment),
      '{"source_environment":"invalid"}'::jsonb
    ] loop
      begin
        insert into hts_rag.hts_rag_classification_jobs
        select (jsonb_populate_record(null::hts_rag.hts_rag_classification_jobs,
                v_fixture || jsonb_build_object('id', gen_random_uuid(), 'turn_index', 2) || v_patch)).*;
        raise exception '% forged provenance %', v_role, v_patch;
      exception when insufficient_privilege then null;
      end;
    end loop;
    begin
      insert into hts_rag.hts_rag_classification_jobs
        (determination_id, session_id, turn_index, kind, owner_key, input)
      values (v_determination, v_session, 2, 'initial', 'ZZ missing provenance', '{}');
      raise exception '% inserted without explicit provenance', v_role;
    exception when not_null_violation or insufficient_privilege then null;
    end;

    -- Existing provider-response idempotency must remain intact.
    insert into hts_rag.hts_rag_provider_responses
      (session_id, turn_index, turn_role, determination_id, provider, model_version,
       prompt_version, request_hash, raw_response, raw_response_hash, source_environment)
    values (v_session, 0, 'classifier', v_determination, 'synthetic', 'm', 'p',
            repeat('4', 64), '{}', repeat('5', 64), v_environment);
    begin
      insert into hts_rag.hts_rag_provider_responses
        (session_id, turn_index, turn_role, determination_id, provider, model_version,
         prompt_version, request_hash, raw_response, raw_response_hash, source_environment)
      values (v_session, 0, 'classifier', v_determination, 'synthetic', 'm', 'p',
              repeat('4', 64), '{}', repeat('5', 64), v_environment);
      raise exception '% duplicated provider response turn', v_role;
    exception when unique_violation then null;
    end;
    execute 'reset role';
  end loop;

  foreach v_role in array array['anon', 'authenticated', 'service_role',
                                'designflow_hts_prod_runtime', 'designflow_hts_alsand_runtime'] loop
    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', v_privilege) then
        raise exception '% has forbidden job privilege %', v_role, v_privilege;
      end if;
    end loop;
    if has_any_column_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception '% has forbidden column access to jobs', v_role;
    end if;
    execute format('set local role %I', v_role);
    begin
      perform 1 from hts_rag.hts_rag_classification_jobs;
      raise exception '% read private jobs', v_role;
    exception when insufficient_privilege then null;
    end;
    begin
      insert into hts_rag.hts_rag_classification_jobs
        (determination_id, session_id, turn_index, kind, owner_key, input, source_environment)
      values (v_determination, v_session, 2, 'initial', 'ZZ forbidden role', '{}', 'production');
      raise exception '% inserted private job', v_role;
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
  end loop;
end
$classification_jobs$;

reset role;
