begin;

do $test$
declare
  v_item integer;
  v_sales integer;
  v_sourcing integer;
  v_step_old integer;
  v_step_sourcing integer;
  v_step_sales integer;
  v_first bigint;
  v_retry bigint;
  v_return bigint;
  v_close bigint;
  v_active bigint;
  v_closed_at timestamptz;
  v_unpinned text;
begin
  insert into dflow.users(name,email) values
    ('Issue 1987 Sales','issue-1987-sales@example.test'),
    ('Issue 1987 Sourcing','issue-1987-sourcing@example.test');
  select id into v_sales from dflow.users where email = 'issue-1987-sales@example.test';
  select id into v_sourcing from dflow.users where email = 'issue-1987-sourcing@example.test';

  insert into dflow."RFQStep"("RFQStep_title") values
    ('issue-1987-old'), ('@sourcing'), ('px sent to sales');
  select "RFQStep_id" into v_step_old from dflow."RFQStep" where "RFQStep_title" = 'issue-1987-old';
  select "RFQStep_id" into v_step_sourcing from dflow."RFQStep" where "RFQStep_title" = '@sourcing';
  select "RFQStep_id" into v_step_sales from dflow."RFQStep" where "RFQStep_title" = 'px sent to sales';

  insert into dflow."RFQItem"("rfqItem_step") values (v_step_old) returning "rfqItem_id" into v_item;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub','11111111-1111-4111-8111-111111111111',
    'email','issue-1987-sales@example.test')::text, true);

  perform dflow.set_item_user_assignment(v_item,'sales',v_sales,true);
  perform dflow.set_item_user_assignment(v_item,'sourcing',v_sourcing,true);

  v_first := dflow.record_item_workflow_action(
    v_item,v_step_sourcing,'send_to_sourcing','11111111-1111-4111-8111-111111111112',
    'sales','sourcing',false
  );
  v_retry := dflow.record_item_workflow_action(
    v_item,v_step_sourcing,'send_to_sourcing','11111111-1111-4111-8111-111111111112',
    'sales','sourcing',false
  );
  if v_retry <> v_first then raise exception 'idempotent retry returned a new action'; end if;
  if (select count(*) from dflow.user_notification where workflow_action_id = v_first) <> 1 then
    raise exception 'sourcing action did not notify exactly the assigned sourcing user';
  end if;
  if (select user_id_fk from dflow.user_notification where workflow_action_id = v_first) <> v_sourcing then
    raise exception 'sourcing action notified the wrong user';
  end if;

  perform dflow.set_item_user_assignment(v_item,'sales',v_sales,false);

  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub','22222222-2222-4222-8222-222222222222',
    'email','issue-1987-sourcing@example.test')::text, true);
  v_return := dflow.record_item_workflow_action(
    v_item,v_step_sales,'return_to_sales','22222222-2222-4222-8222-222222222223',
    'sourcing','sales',true
  );
  if (select user_id_fk from dflow.user_notification where workflow_action_id = v_return) <> v_sales then
    raise exception 'return action did not preserve the original sales sender';
  end if;

  -- Trigger wiring proof. Each block below drives REAL DML against the table the
  -- trigger is attached to (not a direct call to the trigger function) and
  -- asserts the outcome, so a dropped or misattached trigger fails the suite.

  -- item_workflow_action_immutable: UPDATE is refused.
  begin
    update dflow.item_workflow_action set action_key = 'rewritten' where id = v_first;
    raise exception 'workflow action rewrite was accepted';
  exception when sqlstate '55000' then null;
  end;

  -- item_workflow_action_immutable: DELETE is refused.
  begin
    delete from dflow.item_workflow_action where id = v_first;
    raise exception 'workflow action delete was accepted';
  exception when sqlstate '55000' then null;
  end;
  if not exists (select 1 from dflow.item_workflow_action where id = v_first) then
    raise exception 'workflow action row disappeared despite the append-only trigger';
  end if;

  select id into v_active
    from dflow.item_user_assignment
   where rfq_item_id = v_item and function_key = 'sourcing' and effective_to is null;
  if v_active is null then
    raise exception 'expected an active sourcing assignment to test the history trigger against';
  end if;

  -- item_user_assignment_immutable_history: rewriting an assignment fact is refused.
  begin
    update dflow.item_user_assignment set user_id = v_sales where id = v_active;
    raise exception 'assignment fact rewrite was accepted';
  exception when sqlstate '55000' then null;
  end;
  if (select user_id from dflow.item_user_assignment where id = v_active) <> v_sourcing then
    raise exception 'assignment user_id changed despite the append-only trigger';
  end if;

  -- item_user_assignment_immutable_history: DELETE is refused.
  begin
    delete from dflow.item_user_assignment where id = v_active;
    raise exception 'assignment delete was accepted';
  exception when sqlstate '55000' then null;
  end;
  if not exists (select 1 from dflow.item_user_assignment where id = v_active) then
    raise exception 'assignment row disappeared despite the append-only trigger';
  end if;

  -- Positive control: the trigger must still ALLOW the one legal update, closing
  -- an active row exactly once, and must write the closing timestamp through.
  v_close := dflow.set_item_user_assignment(v_item,'quality',v_sales,true);
  if v_close is null then
    raise exception 'expected a new quality assignment id';
  end if;
  update dflow.item_user_assignment
     set effective_to = clock_timestamp()
   where id = v_close;
  select effective_to into v_closed_at from dflow.item_user_assignment where id = v_close;
  if v_closed_at is null then
    raise exception 'closing an active assignment did not persist effective_to';
  end if;

  -- ...and closing an already-closed row is refused.
  begin
    update dflow.item_user_assignment
       set effective_to = clock_timestamp()
     where id = v_close;
    raise exception 'reclosing a closed assignment was accepted';
  exception when sqlstate '55000' then null;
  end;

  -- Every function this migration creates must pin its search_path.
  select string_agg(p.proname, ', ' order by p.proname) into v_unpinned
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'dflow'
     and p.proname in (
       'current_designflow_user_id','set_item_user_assignment','record_item_workflow_action',
       'reject_item_assignment_history_rewrite','reject_item_workflow_action_rewrite')
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%');
  if v_unpinned is not null then
    raise exception 'function(s) created by issue #1987 do not pin search_path: %', v_unpinned;
  end if;

  -- anon must reach nothing on either new table.
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    if has_table_privilege('anon','dflow.item_user_assignment','SELECT')
       or has_table_privilege('anon','dflow.item_user_assignment','INSERT')
       or has_table_privilege('anon','dflow.item_user_assignment','UPDATE')
       or has_table_privilege('anon','dflow.item_user_assignment','DELETE')
       or has_table_privilege('anon','dflow.item_workflow_action','SELECT')
       or has_table_privilege('anon','dflow.item_workflow_action','INSERT')
       or has_table_privilege('anon','dflow.item_workflow_action','UPDATE')
       or has_table_privilege('anon','dflow.item_workflow_action','DELETE') then
      raise exception 'anon can reach an issue #1987 table';
    end if;
  end if;
end
$test$;

rollback;
