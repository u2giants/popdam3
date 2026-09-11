-- Issue #2496 real-DML contracts for migration 20260907121732.
-- All fixtures are synthetic and every write is rolled back.

begin;

do $setup_and_backend_tests$
declare
  v_actor integer;
  v_inactive integer;
  v_target integer;
  v_browser integer;
  v_item integer;
  v_step_start integer;
  v_step_next integer;
  v_assignment bigint;
  v_action bigint;
  v_before bigint;
  v_failed boolean;
begin
  insert into dflow.users(name,email,status) values
    ('Issue 2496 Backend Actor','issue-2496-actor@example.test','Active'),
    ('Issue 2496 Inactive Actor','issue-2496-inactive@example.test','Inactive'),
    ('Issue 2496 Assignment Target','issue-2496-target@example.test','Active'),
    ('Issue 2496 Browser Actor','issue-2496-browser@example.test','Active');
  select id into v_actor from dflow.users where email = 'issue-2496-actor@example.test';
  select id into v_inactive from dflow.users where email = 'issue-2496-inactive@example.test';
  select id into v_target from dflow.users where email = 'issue-2496-target@example.test';
  select id into v_browser from dflow.users where email = 'issue-2496-browser@example.test';

  insert into plm."RFQStep"("RFQStep_title") values
    ('issue-2496-start'), ('issue-2496-next');
  select "RFQStep_id" into v_step_start from plm."RFQStep" where "RFQStep_title" = 'issue-2496-start';
  select "RFQStep_id" into v_step_next from plm."RFQStep" where "RFQStep_title" = 'issue-2496-next';
  insert into plm."RFQItem"("rfqItem_step") values (v_step_start)
    returning "rfqItem_id" into v_item;

  -- The current Supabase backend login is postgres.<project>, which enters the
  -- database as session_user postgres. Both settings are transaction-local.
  perform set_config('request.designflow.actor_id', v_actor::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2496-actor@example.test', true);

  v_assignment := dflow.set_item_user_assignment(
    v_item, 'sourcing', v_target, true, '{"test":"issue-2496"}'::jsonb
  );
  if v_assignment is null
     or (select assigned_by_user_id from dflow.item_user_assignment where id = v_assignment) <> v_actor then
    raise exception 'valid backend actor did not create a truthfully attributed assignment';
  end if;

  v_action := dflow.record_item_workflow_action(
    v_item, v_step_next, 'backend_transition',
    'a2496000-0000-4000-8000-000000000001',
    null, null, false, 'workflow', 'Issue 2496', 'Synthetic backend transition',
    jsonb_build_object('expected_prior_step_id', v_step_start)
  );
  if not exists (
    select 1 from dflow.item_workflow_action
     where id = v_action
       and actor_user_id = v_actor
       and actor_auth_user_id is null
       and actor_identity_source = 'designflow_jwt'
       and actor_identity_email = 'issue-2496-actor@example.test'
  ) then
    raise exception 'backend workflow action did not retain truthful DesignFlow-JWT provenance';
  end if;

  -- Mismatched ID/email, inactive, and missing actors must fail before DML.
  select count(*) into v_before from dflow.item_user_assignment;
  perform set_config('request.designflow.actor_id', v_actor::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2496-target@example.test', true);
  v_failed := false;
  begin
    perform dflow.set_item_user_assignment(v_item, 'quality', v_target, true);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed or (select count(*) from dflow.item_user_assignment) <> v_before then
    raise exception 'mismatched backend actor was not refused before assignment DML';
  end if;

  perform set_config('request.designflow.actor_id', v_inactive::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2496-inactive@example.test', true);
  v_failed := false;
  begin
    perform dflow.set_item_user_assignment(v_item, 'quality', v_target, true);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed or (select count(*) from dflow.item_user_assignment) <> v_before then
    raise exception 'inactive backend actor was not refused before assignment DML';
  end if;

  perform set_config('request.designflow.actor_id', '2147483647', true);
  perform set_config('request.designflow.actor_email', 'issue-2496-missing@example.test', true);
  v_failed := false;
  begin
    perform dflow.set_item_user_assignment(v_item, 'quality', v_target, true);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed or (select count(*) from dflow.item_user_assignment) <> v_before then
    raise exception 'missing backend actor was not refused before assignment DML';
  end if;

  -- Clearing the backend context leaves the original Supabase JWT route intact.
  perform set_config('request.designflow.actor_id', '', true);
  perform set_config('request.designflow.actor_email', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated',
    'sub','a2496000-0000-4000-8000-000000000002',
    'email','issue-2496-browser@example.test'
  )::text, true);
  v_assignment := dflow.set_item_user_assignment(v_item, 'sales', v_target, true);
  if (select assigned_by_user_id from dflow.item_user_assignment where id = v_assignment) <> v_browser then
    raise exception 'existing Supabase-authenticated assignment route no longer works';
  end if;
end
$setup_and_backend_tests$;

-- Simulate a real PostgREST browser session. The ephemeral test login cannot
-- SET SESSION AUTHORIZATION, so its session_user remains postgres; the JWT role
-- is the second independent signal that prevents this harness from producing a
-- false pass. Production PostgREST has both a non-backend session_user and this
-- JWT role, while a direct backend connection has neither PostgREST signal.
select set_config('test.issue2496.item_id', (
  select "rfqItem_id"::text
    from plm."RFQItem"
   where "rfqItem_step" = (
     select "RFQStep_id" from plm."RFQStep" where "RFQStep_title" = 'issue-2496-next'
   )
), true);
select set_config('test.issue2496.target_id', (
  select id::text from dflow.users where email = 'issue-2496-target@example.test'
), true);
select set_config('test.issue2496.assignment_count', (
  select count(*)::text from dflow.item_user_assignment
), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a2496000-0000-4000-8000-000000000003","email":"issue-2496-browser@example.test"}', true);
select set_config('request.designflow.actor_id', '1', true);
select set_config('request.designflow.actor_email', 'forged@example.test', true);

do $browser_refusal$
declare
  v_failed boolean := false;
begin
  begin
    perform dflow.set_item_user_assignment(
      current_setting('test.issue2496.item_id')::integer,
      'quality',
      current_setting('test.issue2496.target_id')::integer,
      true
    );
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'authenticated browser session forged backend actor context';
  end if;
end
$browser_refusal$;

reset role;
do $browser_dml_refusal$
begin
  if (select count(*) from dflow.item_user_assignment)
     <> current_setting('test.issue2496.assignment_count')::bigint then
    raise exception 'authenticated browser reached assignment DML';
  end if;
end
$browser_dml_refusal$;
select set_config('request.jwt.claims', '', true);
select set_config('request.designflow.actor_id', '', true);
select set_config('request.designflow.actor_email', '', true);

-- Public/anon has no function path at all.
set local role anon;
do $anon_refusal$
declare
  v_failed boolean := false;
begin
  begin
    perform dflow.current_designflow_user_id();
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'anon reached the actor resolver';
  end if;
end
$anon_refusal$;
reset role;

do $catalog_contracts$
declare
  v_overloads integer;
begin
  select count(*)::integer into v_overloads
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'dflow' and p.proname = 'record_item_workflow_action';
  if v_overloads <> 1 then
    raise exception 'record_item_workflow_action became ambiguous: % overloads', v_overloads;
  end if;

  if has_function_privilege('anon', 'dflow.current_designflow_user_id()', 'EXECUTE')
     or exists (
       select 1
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where n.nspname = 'dflow'
          and p.proname = 'current_designflow_user_id'
          and p.pronargs = 0
          and a.grantee = 0
          and a.privilege_type = 'EXECUTE'
     ) then
    raise exception 'public or anon can execute the actor resolver';
  end if;

  if exists (select 1 from pg_catalog.pg_roles where rolname = 'designflow')
     and not has_function_privilege(
       'designflow',
       'dflow.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'the actual production DesignFlow backend role lacks workflow execute';
  end if;
end
$catalog_contracts$;

rollback;
