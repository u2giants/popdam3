-- Issue #2874 real-DML contracts for the dflow_prod workflow parity migration.
-- All fixtures are synthetic and every write is rolled back.

-- Supabase's postgres login deliberately lacks SUPERUSER. Preserve actual
-- session_user tests by authenticating as its existing fixture superuser first,
-- then restoring postgres for the original actor contracts. The connection
-- reuses the current database/host; no privilege is changed and no case skipped.
select current_setting('is_superuser') = 'on' as fixture_session_authority \gset
\if :fixture_session_authority
\else
  select exists (select 1 from pg_roles where rolname = 'supabase_admin' and rolsuper and rolcanlogin)
    as fixture_superuser_available \gset
  \if :fixture_superuser_available
    \connect - supabase_admin
    set session authorization postgres;
  \else
    \echo 'Actual session-identity contracts require a fixture superuser; no contract case was skipped.'
    \quit 1
  \endif
\endif

begin;

do $backend_contracts$
declare
  v_sales integer;
  v_sourcing integer;
  v_inactive integer;
  v_other integer;
  v_item integer;
  v_other_item integer;
  v_step_start integer;
  v_step_sourcing integer;
  v_step_priced integer;
  v_assignment bigint;
  v_handoff bigint;
  v_handoff2 bigint;
  v_return bigint;
  v_retry bigint;
  v_count bigint;
  v_failed boolean;
begin
  insert into dflow_prod.users(name, email, status) values
    ('Issue 2874 Sales', 'issue-2874-sales@example.test', 'Active'),
    ('Issue 2874 Sourcing', 'issue-2874-sourcing@example.test', 'Active'),
    ('Issue 2874 Inactive', 'issue-2874-inactive@example.test', 'Inactive'),
    ('Issue 2874 Other', 'issue-2874-other@example.test', 'Active');
  select id into v_sales from dflow_prod.users where email = 'issue-2874-sales@example.test';
  select id into v_sourcing from dflow_prod.users where email = 'issue-2874-sourcing@example.test';
  select id into v_inactive from dflow_prod.users where email = 'issue-2874-inactive@example.test';
  select id into v_other from dflow_prod.users where email = 'issue-2874-other@example.test';

  insert into dflow_prod."RFQStep"("RFQStep_title") values
    ('issue-2874-start'), ('issue-2874-sourcing'), ('issue-2874-priced');
  select "RFQStep_id" into v_step_start from dflow_prod."RFQStep" where "RFQStep_title" = 'issue-2874-start';
  select "RFQStep_id" into v_step_sourcing from dflow_prod."RFQStep" where "RFQStep_title" = 'issue-2874-sourcing';
  select "RFQStep_id" into v_step_priced from dflow_prod."RFQStep" where "RFQStep_title" = 'issue-2874-priced';
  insert into dflow_prod."RFQItem"("rfqItem_step") values (v_step_start) returning "rfqItem_id" into v_item;
  insert into dflow_prod."RFQItem"("rfqItem_step") values (v_step_start) returning "rfqItem_id" into v_other_item;

  -- Trusted backend actor (session_user postgres, no PostgREST role).
  perform set_config('request.designflow.actor_id', v_sales::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2874-sales@example.test', true);

  v_assignment := dflow_prod.set_item_user_assignment(v_item, 'sourcing', v_sourcing, true, '{"test":"issue-2874"}'::jsonb);
  if v_assignment is null
     or (select assigned_by_user_id from dflow_prod.item_user_assignment where id = v_assignment) <> v_sales then
    raise exception 'backend actor did not create a truthfully attributed dflow_prod assignment';
  end if;
  if dflow_prod.set_item_user_assignment(v_item, 'sourcing', v_sourcing, true) <> v_assignment then
    raise exception 'repeated activation did not return the existing active assignment';
  end if;

  -- Handoff sales -> sourcing notifies the active sourcing assignee.
  v_handoff := dflow_prod.record_item_workflow_action(
    v_item, v_step_sourcing, 'sales_sent_to_sourcing', 'a2874000-0000-4000-8000-000000000001',
    'sales', 'sourcing', false, 'workflow', 'Issue 2874', 'Synthetic handoff',
    jsonb_build_object('expected_prior_step_id', v_step_start)
  );
  if not exists (
    select 1 from dflow_prod.item_workflow_action
     where id = v_handoff and actor_user_id = v_sales and actor_auth_user_id is null
       and actor_identity_source = 'designflow_jwt'
       and actor_identity_email = 'issue-2874-sales@example.test'
       and prior_step_id = v_step_start and new_step_id = v_step_sourcing
       and not routing_context ? 'expected_prior_step_id'
  ) then
    raise exception 'handoff did not retain truthful provenance or leaked a transport key';
  end if;
  if (select "rfqItem_step" from dflow_prod."RFQItem" where "rfqItem_id" = v_item) <> v_step_sourcing then
    raise exception 'handoff did not move dflow_prod.RFQItem';
  end if;
  if not exists (
    select 1 from dflow_prod.user_notification
     where workflow_action_id = v_handoff and user_id_fk = v_sourcing
       and idempotency_key = 'a2874000-0000-4000-8000-000000000001:' || v_sourcing
  ) then
    raise exception 'handoff did not notify the dflow_prod sourcing assignee';
  end if;
  if not exists (select 1 from dflow_prod.item_workflow_handoff where handoff_action_id = v_handoff and is_open) then
    raise exception 'handoff is not visible as open';
  end if;

  -- Retry with the same correlation key is idempotent even after the item moved.
  v_retry := dflow_prod.record_item_workflow_action(
    v_item, v_step_sourcing, 'sales_sent_to_sourcing', 'a2874000-0000-4000-8000-000000000001',
    'sales', 'sourcing', false, 'workflow', 'Issue 2874', 'Synthetic handoff',
    jsonb_build_object('expected_prior_step_id', v_step_start)
  );
  if v_retry <> v_handoff
     or (select count(*) from dflow_prod.user_notification where workflow_action_id = v_handoff) <> 1 then
    raise exception 'correlation retry was not idempotent';
  end if;

  -- Reusing a correlation key for a different action is refused.
  v_failed := false;
  begin
    perform dflow_prod.record_item_workflow_action(
      v_item, v_step_priced, 'other_action', 'a2874000-0000-4000-8000-000000000001');
  exception when unique_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'correlation reuse was not refused'; end if;

  -- Stale expected prior step is refused with 40001 before any write.
  select count(*) into v_count from dflow_prod.item_workflow_action;
  v_failed := false;
  begin
    perform dflow_prod.record_item_workflow_action(
      v_item, v_step_priced, 'stale_move', 'a2874000-0000-4000-8000-000000000002',
      null, null, false, 'workflow', 't', 'm', jsonb_build_object('expected_prior_step_id', v_step_start));
  exception when serialization_failure then v_failed := true;
  end;
  if not v_failed or (select count(*) from dflow_prod.item_workflow_action) <> v_count then
    raise exception 'stale transition was not refused before DML';
  end if;

  -- Recipient-required handoff with no assignee rolls back entirely.
  v_failed := false;
  begin
    perform dflow_prod.record_item_workflow_action(
      v_other_item, v_step_sourcing, 'sales_sent_to_sourcing', 'a2874000-0000-4000-8000-000000000003',
      'sales', 'sourcing');
  exception when no_data_found then v_failed := true;
  end;
  if not v_failed
     or (select "rfqItem_step" from dflow_prod."RFQItem" where "rfqItem_id" = v_other_item) <> v_step_start
     or exists (select 1 from dflow_prod.item_workflow_action where correlation_key = 'a2874000-0000-4000-8000-000000000003') then
    raise exception 'recipient-required handoff with no recipient was not rolled back';
  end if;

  -- Return from sourcing, as the sourcing actor, closes exactly that handoff and
  -- notifies the original requester.
  perform set_config('request.designflow.actor_id', v_sourcing::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2874-sourcing@example.test', true);
  v_return := dflow_prod.record_item_workflow_action(
    v_item, v_step_priced, 'price_sent_to_sales', 'a2874000-0000-4000-8000-000000000004',
    'sourcing', 'sales', true);
  if (select source_action_id from dflow_prod.item_workflow_action where id = v_return) <> v_handoff
     or not exists (select 1 from dflow_prod.user_notification where workflow_action_id = v_return and user_id_fk = v_sales)
     or not exists (select 1 from dflow_prod.item_workflow_handoff where handoff_action_id = v_handoff and not is_open and return_action_id = v_return) then
    raise exception 'return did not bind and close the originating handoff';
  end if;

  -- A second return with no open handoff is refused.
  v_failed := false;
  begin
    perform dflow_prod.record_item_workflow_action(
      v_item, v_step_priced, 'price_sent_to_sales', 'a2874000-0000-4000-8000-000000000005',
      'sourcing', 'sales', true);
  exception when no_data_found then v_failed := true;
  end;
  if not v_failed then raise exception 'second return answered an already-closed handoff'; end if;

  -- Second cycle with a labeled fallback binds to the LATEST open handoff.
  perform set_config('request.designflow.actor_id', v_sales::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2874-sales@example.test', true);
  v_handoff2 := dflow_prod.record_item_workflow_action(
    v_item, v_step_sourcing, 'sales_sent_to_sourcing', 'a2874000-0000-4000-8000-000000000006',
    'sales', 'sourcing');
  perform set_config('request.designflow.actor_id', v_sourcing::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2874-sourcing@example.test', true);
  v_return := dflow_prod.record_item_workflow_action(
    v_item, v_step_priced, 'price_sent_to_sales', 'a2874000-0000-4000-8000-000000000007',
    'sourcing', 'sales', true, 'workflow', 't', 'm',
    jsonb_build_object('fallback_recipient_user_id', v_other, 'fallback_reason', 'requester inactive'));
  if not exists (
    select 1 from dflow_prod.item_workflow_action
     where id = v_return and source_action_id = v_handoff2
       and fallback_recipient_user_id = v_other and requires_admin_review
  ) or not exists (select 1 from dflow_prod.user_notification where workflow_action_id = v_return and user_id_fk = v_other) then
    raise exception 'fallback return did not bind the latest handoff with labeled fallback';
  end if;

  -- Append-only history.
  v_failed := false;
  begin
    update dflow_prod.item_workflow_action set action_key = 'rewritten' where id = v_handoff;
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'workflow action history accepted an UPDATE'; end if;
  v_failed := false;
  begin
    delete from dflow_prod.item_workflow_action where id = v_handoff;
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'workflow action history accepted a DELETE'; end if;

  -- Assignment: close once, then never rewrite.
  perform set_config('request.designflow.actor_id', v_sales::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2874-sales@example.test', true);
  -- Two statements: a subquery in the same expression would read the
  -- statement snapshot taken before the function's UPDATE.
  v_retry := dflow_prod.set_item_user_assignment(v_item, 'sourcing', v_sourcing, false);
  if v_retry is distinct from v_assignment
     or (select effective_to from dflow_prod.item_user_assignment where id = v_assignment) is null then
    raise exception 'assignment was not closed';
  end if;
  v_failed := false;
  begin
    update dflow_prod.item_user_assignment set effective_to = clock_timestamp() where id = v_assignment;
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'closed assignment was rewritten'; end if;
  v_failed := false;
  begin
    delete from dflow_prod.item_user_assignment where id = v_assignment;
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'assignment history accepted a DELETE'; end if;

  -- Mismatched and inactive backend actors are refused before DML.
  select count(*) into v_count from dflow_prod.item_user_assignment;
  perform set_config('request.designflow.actor_id', v_sales::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2874-other@example.test', true);
  v_failed := false;
  begin
    perform dflow_prod.set_item_user_assignment(v_item, 'quality', v_other, true);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'mismatched backend actor was not refused'; end if;
  perform set_config('request.designflow.actor_id', v_inactive::text, true);
  perform set_config('request.designflow.actor_email', 'issue-2874-inactive@example.test', true);
  v_failed := false;
  begin
    perform dflow_prod.set_item_user_assignment(v_item, 'quality', v_other, true);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed or (select count(*) from dflow_prod.item_user_assignment) <> v_count then
    raise exception 'inactive backend actor was not refused before DML';
  end if;

  -- Supabase-JWT route still resolves against dflow_prod.users.
  perform set_config('request.designflow.actor_id', '', true);
  perform set_config('request.designflow.actor_email', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'sub', 'a2874000-0000-4000-8000-0000000000ff',
    'email', 'issue-2874-other@example.test')::text, true);
  if dflow_prod.current_designflow_user_id() <> v_other then
    raise exception 'Supabase-JWT actor did not resolve against dflow_prod.users';
  end if;
  perform set_config('request.jwt.claims', '', true);
end
$backend_contracts$;

-- Actual session identities, not SET ROLE: the trusted boundary uses session_user.
-- Fixtures and temporary function grants roll back with this contract transaction.
do $runtime_fixtures$
begin
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_backend_runtime') then
    create role designflow_prod_backend_runtime nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_tracking_runtime') then
    create role designflow_prod_tracking_runtime nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_item_master_runtime') then
    create role designflow_prod_item_master_runtime nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_data_sync_runtime') then
    create role designflow_prod_data_sync_runtime nologin;
  end if;
end
$runtime_fixtures$;

grant usage on schema dflow_prod to designflow_prod_backend_runtime,
  designflow_prod_tracking_runtime, designflow_prod_item_master_runtime,
  designflow_prod_data_sync_runtime;
grant execute on function dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb)
  to designflow_prod_backend_runtime, designflow_prod_tracking_runtime,
     designflow_prod_item_master_runtime, designflow_prod_data_sync_runtime;

do $runtime_context$
declare
  v_item integer;
begin
  insert into dflow_prod."RFQItem"("rfqItem_step")
    select "RFQStep_id" from dflow_prod."RFQStep" where "RFQStep_title" = 'issue-2874-start'
    returning "rfqItem_id" into v_item;
  perform set_config('test.issue2874.runtime_item', v_item::text, true);
  perform set_config('test.issue2874.recipient', (select id::text from dflow_prod.users where email = 'issue-2874-sourcing@example.test'), true);
  perform set_config('request.designflow.actor_id', (select id::text from dflow_prod.users where email = 'issue-2874-sales@example.test'), true);
  perform set_config('request.designflow.actor_email', 'issue-2874-sales@example.test', true);
  perform set_config('request.jwt.claims', '', true);
end
$runtime_context$;

set session authorization designflow_prod_backend_runtime;
do $actual_backend_session$
declare
  v_assignment bigint;
  v_refused boolean := false;
begin
  if session_user <> 'designflow_prod_backend_runtime' then
    raise exception 'contract did not establish the actual backend session identity';
  end if;
  v_assignment := dflow_prod.set_item_user_assignment(
    current_setting('test.issue2874.runtime_item')::integer, 'quality',
    current_setting('test.issue2874.recipient')::integer, true);
  if v_assignment is null then raise exception 'backend runtime could not create an assignment'; end if;
  perform set_config('test.issue2874.runtime_assignment', v_assignment::text, true);
  -- A PostgREST/client token cannot acquire the trusted database-actor route.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform dflow_prod.set_item_user_assignment(current_setting('test.issue2874.runtime_item')::integer,
      'quality', current_setting('test.issue2874.recipient')::integer, true);
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'JWT context acquired trusted backend attribution'; end if;
  perform set_config('request.jwt.claims', '', true);
end
$actual_backend_session$;
reset session authorization;

do $runtime_attribution$
begin
  if (select assigned_by_user_id from dflow_prod.item_user_assignment
       where id = current_setting('test.issue2874.runtime_assignment')::bigint)
       is distinct from current_setting('request.designflow.actor_id')::integer then
    raise exception 'backend runtime assignment lost its validated actor attribution';
  end if;
end
$runtime_attribution$;

set session authorization designflow_prod_tracking_runtime;
do $other_service_refusal$
declare v_refused boolean := false;
begin
  begin
    perform dflow_prod.set_item_user_assignment(current_setting('test.issue2874.runtime_item')::integer,
      'quality', current_setting('test.issue2874.recipient')::integer, true);
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'non-backend service spoofed trusted backend attribution'; end if;
end
$other_service_refusal$;
reset session authorization;

set session authorization designflow_prod_item_master_runtime;
do $other_service_refusal$
declare v_refused boolean := false;
begin
  begin
    perform dflow_prod.set_item_user_assignment(current_setting('test.issue2874.runtime_item')::integer,
      'quality', current_setting('test.issue2874.recipient')::integer, true);
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'non-backend service spoofed trusted backend attribution'; end if;
end
$other_service_refusal$;
reset session authorization;

set session authorization designflow_prod_data_sync_runtime;
do $other_service_refusal$
declare v_refused boolean := false;
begin
  begin
    perform dflow_prod.set_item_user_assignment(current_setting('test.issue2874.runtime_item')::integer,
      'quality', current_setting('test.issue2874.recipient')::integer, true);
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'non-backend service spoofed trusted backend attribution'; end if;
end
$other_service_refusal$;
reset session authorization;

-- dflow_prod stays closed: no browser role reaches any new object.
set local role authenticated;
do $authenticated_refusal$
declare
  v_failed boolean := false;
begin
  begin
    perform 1 from dflow_prod.item_workflow_action limit 1;
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'authenticated reached dflow_prod.item_workflow_action'; end if;
end
$authenticated_refusal$;
reset role;

set local role anon;
do $anon_refusal$
declare
  v_failed boolean := false;
begin
  begin
    perform dflow_prod.current_designflow_user_id();
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'anon reached the dflow_prod actor resolver'; end if;
end
$anon_refusal$;
reset role;

do $catalog_contracts$
declare
  v_role text;
  v_fn text;
begin
  if (select count(*) from pg_catalog.pg_proc p
       where p.pronamespace = 'dflow_prod'::regnamespace
         and p.proname = 'record_item_workflow_action') <> 1 then
    raise exception 'dflow_prod.record_item_workflow_action is ambiguous';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'dflow_prod.item_user_assignment', 'SELECT')
       or has_table_privilege(v_role, 'dflow_prod.item_workflow_action', 'SELECT')
       or has_table_privilege(v_role, 'dflow_prod.item_workflow_handoff', 'SELECT') then
      raise exception '% can read a dflow_prod workflow object', v_role;
    end if;
    foreach v_fn in array array[
      'dflow_prod.current_designflow_user_id()',
      'dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb)',
      'dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb)'
    ] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '% can execute %', v_role, v_fn;
      end if;
    end loop;
  end loop;

  -- No dflow_prod workflow object references legacy dflow, plm or app.
  if exists (
    select 1 from pg_catalog.pg_constraint c
     where c.contype = 'f'
       and c.conrelid in ('dflow_prod.item_user_assignment'::regclass,
                          'dflow_prod.item_workflow_action'::regclass,
                          'dflow_prod.user_notification'::regclass)
       and c.confrelid::regclass::text !~ '^dflow_prod\.'
  ) then
    raise exception 'a dflow_prod workflow foreign key leaves dflow_prod';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
     where p.pronamespace = 'dflow_prod'::regnamespace
       and p.proname in ('current_designflow_user_id', 'set_item_user_assignment', 'record_item_workflow_action',
                         'reject_item_assignment_history_rewrite', 'reject_item_workflow_action_rewrite')
       and p.prosrc ~ '\m(dflow|plm|app)\.'
  ) then
    raise exception 'a dflow_prod workflow function references legacy dflow, plm or app';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint c
     where c.contype = 'f'
       and c.conrelid in ('dflow_prod.item_user_assignment'::regclass,
                          'dflow_prod.item_workflow_action'::regclass,
                          'dflow_prod.user_notification'::regclass)
       and not c.convalidated
  ) then
    raise exception 'a dflow_prod workflow foreign key is NOT VALID';
  end if;
  if (select count(*) from pg_catalog.pg_trigger t
       where not t.tgisinternal
         and t.tgname in ('item_user_assignment_immutable', 'item_workflow_action_immutable')
         and t.tgrelid in ('dflow_prod.item_user_assignment'::regclass, 'dflow_prod.item_workflow_action'::regclass)
         and t.tgenabled = 'O') <> 2 then
    raise exception 'dflow_prod append-only triggers are missing or disabled';
  end if;
end
$catalog_contracts$;

rollback;
