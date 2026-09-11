-- #2202: point DesignFlow workflow history and notifications at the canonical
-- multi-schema application tables. Existing history is retained without being
-- guessed or copied; NOT VALID foreign keys enforce canonical identity for all
-- new rows while permitting pre-existing legacy-keyed history to remain.
-- derived-from: 20260901221310

set lock_timeout = '5s';
set statement_timeout = '5min';

alter table dflow.item_user_assignment
  drop constraint if exists item_user_assignment_rfq_item_id_fkey,
  add constraint item_user_assignment_rfq_item_id_fkey
    foreign key (rfq_item_id) references plm."RFQItem"("rfqItem_id")
    on delete cascade not valid;

alter table dflow.item_workflow_action
  drop constraint if exists item_workflow_action_rfq_item_id_fkey,
  drop constraint if exists item_workflow_action_prior_step_id_fkey,
  drop constraint if exists item_workflow_action_new_step_id_fkey,
  add constraint item_workflow_action_rfq_item_id_fkey
    foreign key (rfq_item_id) references plm."RFQItem"("rfqItem_id")
    on delete restrict not valid,
  add constraint item_workflow_action_prior_step_id_fkey
    foreign key (prior_step_id) references plm."RFQStep"("RFQStep_id")
    not valid,
  add constraint item_workflow_action_new_step_id_fkey
    foreign key (new_step_id) references plm."RFQStep"("RFQStep_id")
    not valid;

-- app.user_notification already exists in the shared live catalog and is the
-- table used by DesignFlow notification list/count/read APIs. Defining its
-- legacy-compatible shape when absent also makes a clean migration replay
-- converge on that live contract.
create table if not exists app.user_notification (
  id integer generated always as identity primary key,
  type character varying,
  created_date date,
  event character varying,
  unread boolean,
  message character varying,
  title character varying,
  user_id_fk integer
);

alter table app.user_notification
  add column if not exists workflow_action_id bigint,
  add column if not exists idempotency_key text;

alter table app.user_notification
  drop constraint if exists user_notification_workflow_action_id_fkey,
  add constraint user_notification_workflow_action_id_fkey
    foreign key (workflow_action_id) references dflow.item_workflow_action(id)
    on delete restrict not valid;

create unique index if not exists user_notification_action_recipient
  on app.user_notification (workflow_action_id, user_id_fk)
  where workflow_action_id is not null;

create unique index if not exists user_notification_idempotency_key
  on app.user_notification (idempotency_key)
  where idempotency_key is not null;

create or replace function dflow.set_item_user_assignment(
  p_rfq_item_id integer,
  p_function_key text,
  p_user_id integer,
  p_active boolean,
  p_assignment_context jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, dflow, auth
as $function$
declare
  v_actor integer := dflow.current_designflow_user_id();
  v_function text := lower(nullif(btrim(p_function_key), ''));
  v_assignment_id bigint;
begin
  if v_function is null or v_function !~ '^[a-z][a-z0-9_-]*$' then
    raise exception 'function key is invalid' using errcode = '22023';
  end if;
  if p_assignment_context is null or jsonb_typeof(p_assignment_context) <> 'object' then
    raise exception 'assignment context must be a JSON object' using errcode = '22023';
  end if;

  perform 1 from plm."RFQItem" where "rfqItem_id" = p_rfq_item_id for update;
  if not found then
    raise exception 'RFQ item % does not exist', p_rfq_item_id using errcode = '23503';
  end if;
  perform 1 from dflow.users where id = p_user_id;
  if not found then
    raise exception 'DesignFlow user % does not exist', p_user_id using errcode = '23503';
  end if;

  select id into v_assignment_id
    from dflow.item_user_assignment
   where rfq_item_id = p_rfq_item_id
     and function_key = v_function
     and user_id = p_user_id
     and effective_to is null
   for update;

  if p_active then
    if v_assignment_id is null then
      insert into dflow.item_user_assignment(
        rfq_item_id, function_key, user_id, assigned_by_user_id, assignment_context
      ) values (
        p_rfq_item_id, v_function, p_user_id, v_actor, p_assignment_context
      ) returning id into v_assignment_id;
    end if;
  elsif v_assignment_id is not null then
    update dflow.item_user_assignment
       set effective_to = clock_timestamp()
     where id = v_assignment_id;
  end if;

  return v_assignment_id;
end
$function$;

create or replace function dflow.record_item_workflow_action(
  p_rfq_item_id integer,
  p_new_step_id integer,
  p_action_key text,
  p_correlation_key uuid,
  p_from_function_key text default null,
  p_to_function_key text default null,
  p_return_to_original_handoff boolean default false,
  p_notification_type text default 'workflow',
  p_notification_title text default 'RFQ workflow update',
  p_notification_message text default 'An RFQ item needs your attention',
  p_routing_context jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, dflow, auth
as $function$
declare
  v_actor integer := dflow.current_designflow_user_id();
  v_auth_actor uuid := auth.uid();
  v_prior_step integer;
  v_action_id bigint;
  v_existing dflow.item_workflow_action%rowtype;
  v_from text := lower(nullif(btrim(p_from_function_key), ''));
  v_to text := lower(nullif(btrim(p_to_function_key), ''));
  v_context jsonb;
  v_recipient integer;
begin
  if p_correlation_key is null then
    raise exception 'correlation key is required' using errcode = '22004';
  end if;
  if p_action_key is null or lower(btrim(p_action_key)) !~ '^[a-z][a-z0-9_-]*$' then
    raise exception 'action key is invalid' using errcode = '22023';
  end if;
  if p_routing_context is null or jsonb_typeof(p_routing_context) <> 'object' then
    raise exception 'routing context must be a JSON object' using errcode = '22023';
  end if;
  if p_return_to_original_handoff and (v_from is null or v_to is null) then
    raise exception 'return routing requires from and to function keys' using errcode = '22023';
  end if;

  select * into v_existing
    from dflow.item_workflow_action
   where correlation_key = p_correlation_key;
  if found then
    if v_existing.rfq_item_id <> p_rfq_item_id
       or v_existing.new_step_id <> p_new_step_id
       or v_existing.action_key <> lower(btrim(p_action_key))
       or v_existing.actor_user_id <> v_actor then
      raise exception 'correlation key was already used for a different action' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  select i."rfqItem_step" into v_prior_step
    from plm."RFQItem" i
   where i."rfqItem_id" = p_rfq_item_id
   for update;
  if not found then
    raise exception 'RFQ item % does not exist', p_rfq_item_id using errcode = '23503';
  end if;

  perform 1 from plm."RFQStep" s where s."RFQStep_id" = p_new_step_id;
  if not found then
    raise exception 'RFQ step % does not exist', p_new_step_id using errcode = '23503';
  end if;

  v_context := p_routing_context || jsonb_strip_nulls(jsonb_build_object(
    'from_function_key', v_from,
    'to_function_key', v_to,
    'return_to_original_handoff', p_return_to_original_handoff
  ));

  insert into dflow.item_workflow_action(
    rfq_item_id, actor_user_id, actor_auth_user_id, prior_step_id, new_step_id,
    action_key, correlation_key, routing_context
  ) values (
    p_rfq_item_id, v_actor, v_auth_actor, v_prior_step, p_new_step_id,
    lower(btrim(p_action_key)), p_correlation_key, v_context
  )
  on conflict (correlation_key) do nothing
  returning id into v_action_id;

  if v_action_id is null then
    select * into v_existing
      from dflow.item_workflow_action
     where correlation_key = p_correlation_key;
    if not found
       or v_existing.rfq_item_id <> p_rfq_item_id
       or v_existing.new_step_id <> p_new_step_id
       or v_existing.action_key <> lower(btrim(p_action_key))
       or v_existing.actor_user_id <> v_actor then
      raise exception 'correlation key was already used for a different action' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  update plm."RFQItem"
     set "rfqItem_step" = p_new_step_id,
         "rfqItem_date_modified" = clock_timestamp()
   where "rfqItem_id" = p_rfq_item_id;

  if p_return_to_original_handoff then
    select a.actor_user_id into v_recipient
      from dflow.item_workflow_action a
     where a.rfq_item_id = p_rfq_item_id
       and a.id <> v_action_id
       and a.routing_context ->> 'from_function_key' = v_to
       and a.routing_context ->> 'to_function_key' = v_from
     order by a.occurred_at, a.id
     limit 1;

    if v_recipient is null then
      raise exception 'no original % to % handoff exists for RFQ item %', v_to, v_from, p_rfq_item_id
        using errcode = 'P0002';
    end if;

    insert into app.user_notification(
      type, created_date, event, unread, message, title, user_id_fk,
      workflow_action_id, idempotency_key
    ) values (
      p_notification_type, current_date, lower(btrim(p_action_key)), true,
      p_notification_message, p_notification_title, v_recipient,
      v_action_id, p_correlation_key::text || ':' || v_recipient::text
    ) on conflict (workflow_action_id, user_id_fk) where workflow_action_id is not null do nothing;
  elsif v_to is not null then
    insert into app.user_notification(
      type, created_date, event, unread, message, title, user_id_fk,
      workflow_action_id, idempotency_key
    )
    select p_notification_type, current_date, lower(btrim(p_action_key)), true,
           p_notification_message, p_notification_title, a.user_id,
           v_action_id, p_correlation_key::text || ':' || a.user_id::text
      from dflow.item_user_assignment a
     where a.rfq_item_id = p_rfq_item_id
       and a.function_key = v_to
       and a.effective_to is null
    on conflict (workflow_action_id, user_id_fk) where workflow_action_id is not null do nothing;
  end if;

  return v_action_id;
end
$function$;

revoke all on function dflow.set_item_user_assignment(integer,text,integer,boolean,jsonb) from public;
revoke all on function dflow.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb) from public;
grant execute on function dflow.set_item_user_assignment(integer,text,integer,boolean,jsonb) to authenticated, service_role;
grant execute on function dflow.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb) to authenticated, service_role;

comment on constraint item_user_assignment_rfq_item_id_fkey on dflow.item_user_assignment is
  'NOT VALID preserves legacy-keyed history; every new assignment must reference canonical plm.RFQItem.';
comment on constraint item_workflow_action_rfq_item_id_fkey on dflow.item_workflow_action is
  'NOT VALID preserves legacy-keyed history; every new action must reference canonical plm.RFQItem.';
comment on column app.user_notification.workflow_action_id is
  'Links the canonical application notification to the immutable workflow action that created it; NULL only for legacy rows.';
