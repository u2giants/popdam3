-- Run after the migration in an ephemeral database. Every assertion is transactional.
--
-- This file deliberately asserts BEHAVIOUR, not just object names. A name-only test
-- stays green when a policy predicate is loosened to `using (true)`, when a grant is
-- dropped so a policy becomes inert, or when a table is unusable in practice -- all of
-- which were real defects found by external review of earlier drafts of this contract.
begin;

-- The PUBLIC/anon exposure detector, defined once so the assertion below and the probe
-- that proves it can fail are literally the same query. It reads the ACL out of
-- pg_class: information_schema.role_table_grants OMITS every grant whose grantee is
-- PUBLIC, so the earlier information_schema form of this check could not see a
-- `grant select ... to public` at all -- exactly the exposure it exists to catch.
create function pg_temp.hts_rag_public_exposure() returns boolean language sql stable as $fn$
  select exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'hts_rag\_%'
       and (a.grantee = 0 or a.grantee = (select oid from pg_roles where rolname = 'anon'))
  );
$fn$;

do $$
declare v_count integer; v_def text;
begin
  select count(*) into v_count from information_schema.tables
  where table_schema='public' and table_name in ('hts_rag_precedents','hts_rag_precedent_rulings','hts_rag_product_examples','hts_rag_determinations','hts_rag_extraction_jobs','hts_rag_review_events','hts_rag_product_family_allowlist');
  if v_count <> 7 then raise exception 'expected seven HTS RAG contract tables, got %', v_count; end if;

  select count(*) into v_count from pg_indexes where schemaname='public' and indexname in
    ('hts_rag_precedents_family_review_idx','hts_rag_precedents_extraction_idempotency_idx','hts_rag_precedent_rulings_ruling_idx','hts_rag_precedent_rulings_relationship_idx','hts_rag_product_examples_family_idx','hts_rag_determinations_family_created_idx','hts_rag_determinations_comparison_review_idx','hts_rag_extraction_jobs_pending_claim_idx','hts_rag_extraction_jobs_idempotency_idx','hts_rag_review_events_subject_created_idx');
  if v_count <> 10 then raise exception 'expected ten claimed HTS RAG indexes, got %', v_count; end if;

  -- Index DEFINITIONS, not names. A renamed-but-rebuilt index that dropped its partial
  -- predicate or its uniqueness would otherwise pass the name check above.
  select indexdef into v_def from pg_indexes where schemaname='public' and indexname='hts_rag_extraction_jobs_pending_claim_idx';
  if v_def is null or position('pending' in v_def) = 0 or position('WHERE' in v_def) = 0 then
    raise exception 'pending-claim index lost its partial predicate: %', coalesce(v_def,'<missing>');
  end if;
  select indexdef into v_def from pg_indexes where schemaname='public' and indexname='hts_rag_extraction_jobs_idempotency_idx';
  if v_def is null or position('CREATE UNIQUE INDEX' in v_def) <> 1 then
    raise exception 'extraction job idempotency index is no longer unique: %', coalesce(v_def,'<missing>');
  end if;
  select indexdef into v_def from pg_indexes where schemaname='public' and indexname='hts_rag_precedents_extraction_idempotency_idx';
  if v_def is null or position('CREATE UNIQUE INDEX' in v_def) <> 1 then
    raise exception 'precedent extraction identity index is no longer unique: %', coalesce(v_def,'<missing>');
  end if;

  -- Row level security must be ENABLED, not merely policied. Policies on a table with
  -- RLS off are inert, so a dropped ENABLE line would expose every row the SELECT
  -- grants below reach while all the other assertions here stayed green.
  select count(*) into v_count from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relrowsecurity
     and c.relname in ('hts_rag_precedents','hts_rag_precedent_rulings','hts_rag_product_examples','hts_rag_determinations','hts_rag_extraction_jobs','hts_rag_review_events','hts_rag_product_family_allowlist');
  if v_count <> 7 then raise exception 'row level security is not enabled on all seven HTS RAG tables, got %', v_count; end if;

  -- No path at all for the unauthenticated browser role or PUBLIC, on any privilege.
  if pg_temp.hts_rag_public_exposure() then
    raise exception 'anon or PUBLIC holds a grant on an HTS RAG table';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name like 'hts_rag_%' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')) then
    raise exception 'browser role received a direct HTS RAG write grant';
  end if;

  -- Every authenticated-readable table must have an administrator SELECT policy whose
  -- predicate actually calls app.has_role. A predicate loosened to `using (true)` is
  -- exactly the failure this catches, and a name-only check cannot see it.
  if exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema='public' and g.table_name like 'hts_rag_%'
       and g.grantee='authenticated'
       and not exists (
         select 1 from pg_policies p
          where p.schemaname='public' and p.tablename=g.table_name
            and p.cmd in ('SELECT','ALL') and 'authenticated' = any(p.roles)
            and position('has_role' in coalesce(p.qual,'')) > 0)
  ) then
    raise exception 'an authenticated-readable HTS RAG table has no administrator-gated read policy';
  end if;

  -- The converse direction. A policy with no matching grant is dead: it claims a
  -- capability the database does not actually give. Both directions must hold.
  if exists (
    select 1 from pg_policies p
     where p.schemaname='public' and p.tablename like 'hts_rag_%'
       and 'authenticated' = any(p.roles) and p.cmd in ('SELECT','ALL')
       and not exists (
         select 1 from information_schema.role_table_grants g
          where g.table_schema='public' and g.table_name=p.tablename
            and g.grantee='authenticated' and g.privilege_type='SELECT')
  ) then
    raise exception 'an authenticated read policy exists with no matching SELECT grant';
  end if;

  -- Immutability of comparison and review history is enforced by GRANTS, so assert the
  -- grants precisely: no table-wide UPDATE, no DELETE, no TRUNCATE, and exactly one
  -- column-scoped UPDATE for the review workflow on determinations.
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name in ('hts_rag_determinations','hts_rag_review_events') and grantee='service_role' and privilege_type in ('UPDATE','DELETE','TRUNCATE')) then
    raise exception 'immutable comparison/review history received a table-wide mutation grant';
  end if;
  select count(*) into v_count from information_schema.column_privileges
   where table_schema='public' and table_name='hts_rag_determinations' and grantee='service_role' and privilege_type='UPDATE';
  if v_count <> 1 then raise exception 'expected exactly one updatable determination column, got %', v_count; end if;
  if not exists (
    select 1 from information_schema.column_privileges
     where table_schema='public' and table_name='hts_rag_determinations' and grantee='service_role'
       and privilege_type='UPDATE' and column_name='comparison_review_state') then
    raise exception 'comparison_review_state is not updatable, so the review queue can never be worked';
  end if;

  -- The backend policy set on determinations must not be wider than those grants.
  if exists (select 1 from pg_policies where schemaname='public' and tablename='hts_rag_determinations' and cmd='ALL') then
    raise exception 'determinations still carry a FOR ALL policy wider than their immutability grants';
  end if;
end $$;

-- A check never seen to go red is not evidence. Inject a real `grant select to public`
-- inside a subtransaction, require the detector to fire on it, and roll the grant back.
do $$
declare v_detected boolean;
begin
  begin
    execute 'grant select on public.hts_rag_precedents to public';
    v_detected := pg_temp.hts_rag_public_exposure();
    raise exception using errcode = '22000', message = 'hts_rag_public_probe_rollback';
  exception when others then
    if sqlerrm <> 'hts_rag_public_probe_rollback' then raise; end if;
  end;
  if not coalesce(v_detected, false) then
    raise exception 'the PUBLIC exposure detector did not fire on an injected grant, so it proves nothing';
  end if;
  if pg_temp.hts_rag_public_exposure() then
    raise exception 'the injected PUBLIC grant did not roll back';
  end if;
end $$;

-- Behavioural rows. Every one of the seven tables is exercised, so a table that is
-- unusable in practice cannot pass on catalog presence alone.
insert into public.hts_rag_product_examples(id,product_family,fixture_version,fixture_hash,input_hash)
values ('11111111-1111-4111-8111-111111111111','ceramic figurine','fixture-v1',repeat('a',64),repeat('b',64));

insert into public.hts_rag_precedents(id,product_family,fixture_version,prompt_version,classifier_model,verifier_model,extraction_version,fixture_hash,input_hash,raw_result_hash,proposed_hts,classification_state,missing_critical_facts,conflicts,decision_card_candidate,operative_eligible)
values ('22222222-2222-4222-8222-222222222222','ceramic figurine','fixture-v1','prompt-v1','classifier-v1','verifier-v1','extract-v1',repeat('a',64),repeat('b',64),repeat('c',64),'6913.10.50','needs_more_facts','["ceramic subtype"]','["toy function unresolved"]',true,false);

insert into public.hts_rag_determinations(id,product_example_id,precedent_id,method,proposed_hts,classification_state,result_hash,comparison_key)
values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','rag_shadow','6913.10.50','provisional_complete',repeat('1',64),'44444444-4444-4444-8444-444444444444');

-- The review queue must actually be workable; the index on comparison_review_state is
-- meaningless if nothing can transition the column. Run it AS service_role: the owner
-- bypasses every grant, so an owner update proves nothing about the column-scoped
-- UPDATE grant and the backend review policy actually working together.
do $$
begin
  set local role service_role;
  update public.hts_rag_determinations set comparison_review_state='accepted' where id='33333333-3333-4333-8333-333333333333';
  if not found then raise exception 'service_role could not transition comparison_review_state'; end if;
  reset role;
exception when others then
  reset role;
  raise;
end $$;

insert into public.hts_rag_extraction_jobs(product_example_id,prompt_version,model_version,extraction_version,input_hash)
values ('11111111-1111-4111-8111-111111111111','prompt-v1','model-v1','extract-v1',repeat('b',64));

insert into public.hts_rag_review_events(subject_type,subject_id,action,prior_state,new_state)
values ('determination','33333333-3333-4333-8333-333333333333','accept','unreviewed','accepted');

insert into public.hts_rag_product_family_allowlist(product_family) values ('ceramic figurine');

do $$
declare v_state text;
begin
  select comparison_review_state into v_state from public.hts_rag_determinations where id='33333333-3333-4333-8333-333333333333';
  if v_state <> 'accepted' then raise exception 'comparison review state did not transition, got %', v_state; end if;
  if (select enabled from public.hts_rag_product_family_allowlist where product_family='ceramic figurine') then
    raise exception 'allowlist did not default disabled';
  end if;
  if not exists (select 1 from public.hts_rag_review_events where subject_id='33333333-3333-4333-8333-333333333333') then
    raise exception 'the review event history did not accept an append';
  end if;
end $$;

-- The precedent/ruling link, exercised on a fixture this test creates itself. An earlier
-- form adapted to whatever rulings happened to exist and silently skipped the table when
-- none did, so the claim that all seven tables are exercised could be false and green.
insert into public.hts_rag_rulings(id,ruling_number,full_text,full_text_hash)
values ('55555555-5555-4555-8555-555555555555','ZZ-FIXTURE-0001','ZZ fixture ruling text',repeat('d',64));

insert into public.hts_rag_precedent_rulings(precedent_id,ruling_id,verifier_relevance,final_relationship)
values ('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555','relevant','supporting');

do $$
begin
  if not exists (select 1 from public.hts_rag_precedent_rulings
                  where precedent_id='22222222-2222-4222-8222-222222222222'
                    and ruling_id='55555555-5555-4555-8555-555555555555') then
    raise exception 'the precedent-ruling link did not accept a row';
  end if;
end $$;

-- Negative cases, each caught on its NAMED constraint so an unrelated violation with the
-- same SQLSTATE cannot be mistaken for the constraint under test.
do $$
declare v_constraint text;
begin
  begin
    insert into public.hts_rag_precedents(product_family,fixture_version,prompt_version,classifier_model,verifier_model,extraction_version,fixture_hash,input_hash,raw_result_hash,classification_state)
    values ('ceramic figurine','fixture-v1','prompt-v1','classifier-v1','verifier-v1','extract-v1',repeat('a',64),repeat('b',64),repeat('c',64),'needs_more_facts');
    raise exception 'duplicate extraction identity was accepted';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_precedents_extraction_idempotency_idx' then raise exception 'wrong constraint rejected the duplicate: %', v_constraint; end if;
  end;

  begin
    insert into public.hts_rag_precedents(product_family,fixture_version,prompt_version,classifier_model,verifier_model,extraction_version,fixture_hash,input_hash,raw_result_hash,classification_state,operative_eligible)
    values ('bad','f','p','c','v','e',repeat('d',64),repeat('e',64),repeat('f',64),'needs_more_facts',true);
    raise exception 'incomplete classification became operative';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_precedents_operability_chk' then raise exception 'wrong constraint rejected the operative precedent: %', v_constraint; end if;
  end;

  begin
    insert into public.hts_rag_product_family_allowlist(product_family,enabled) values ('plush toy',true);
    raise exception 'allowlist enabled without accountable review';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_product_family_allowlist_enabled_chk' then raise exception 'wrong constraint rejected the allowlist enable: %', v_constraint; end if;
  end;

  -- A shadow comparison with no precedent is unattributable, which is the whole point
  -- of the precedent contract.
  begin
    insert into public.hts_rag_determinations(product_example_id,method,classification_state,result_hash,comparison_key)
    values ('11111111-1111-4111-8111-111111111111','rag_shadow','provisional_complete',repeat('2',64),'44444444-4444-4444-8444-444444444444');
    raise exception 'a rag_shadow determination was stored with no precedent';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_determinations_shadow_precedent_chk' then raise exception 'wrong constraint rejected the precedent-less shadow: %', v_constraint; end if;
  end;

  -- The pending-claim index only returns unclaimed rows, so a claimed pending row is a
  -- job no worker would ever see again.
  begin
    insert into public.hts_rag_extraction_jobs(product_example_id,prompt_version,model_version,extraction_version,input_hash,status,claimed_at,claimed_by)
    values ('11111111-1111-4111-8111-111111111111','prompt-v2','model-v1','extract-v1',repeat('c',64),'pending',now(),'worker-1');
    raise exception 'a pending extraction job was accepted while already claimed';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_extraction_jobs_pending_unclaimed_chk' then raise exception 'wrong constraint rejected the claimed pending job: %', v_constraint; end if;
  end;

  -- Undotted ten-digit codes are ambiguous against four-digit headings, so the stored
  -- form is the dotted notation only.
  begin
    insert into public.hts_rag_precedents(product_family,fixture_version,prompt_version,classifier_model,verifier_model,extraction_version,fixture_hash,input_hash,raw_result_hash,classification_state,proposed_hts)
    values ('bad','f','p','c','v','e2',repeat('7',64),repeat('8',64),repeat('9',64),'needs_more_facts','6913105000');
    raise exception 'an unnotated HTS code was accepted';
  exception when check_violation then null;
  end;
end $$;

-- Role-scoped reads. The browser roles are where an RLS mistake becomes an incident, so
-- assert what those roles can actually do rather than what the catalog claims.
do $$
declare v_count integer;
begin
  set local role authenticated;
  -- No auth.uid() in this session, so app.has_role('administrator') is false and the
  -- administrator policies must hide every row.
  select count(*) into v_count from public.hts_rag_precedents;
  if v_count <> 0 then raise exception 'a non-administrator authenticated session read % precedent row(s)', v_count; end if;
  select count(*) into v_count from public.hts_rag_product_family_allowlist;
  if v_count <> 0 then raise exception 'a non-administrator authenticated session read % allowlist row(s)', v_count; end if;
  reset role;
exception when others then
  reset role;
  raise;
end $$;

do $$
begin
  set local role anon;
  begin
    perform 1 from public.hts_rag_precedents;
    reset role;
    raise exception 'the anonymous browser role could read HTS RAG precedents';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;

rollback;
