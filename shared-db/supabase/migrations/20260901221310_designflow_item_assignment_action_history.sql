-- #1987: durable DesignFlow ownership, workflow action, and notification linkage.

create table dflow.item_user_assignment (
  id bigint generated always as identity primary key,
  rfq_item_id integer not null references dflow."RFQItem"("rfqItem_id") on delete cascade,
  function_key text not null check (function_key = lower(btrim(function_key)) and function_key ~ '^[a-z][a-z0-9_-]*$'),
  user_id integer not null references dflow.users(id),
  assigned_by_user_id integer not null references dflow.users(id),
  effective_from timestamptz not null default clock_timestamp(),
  effective_to timestamptz,
  assignment_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check (effective_to is null or effective_to > effective_from),
  check (jsonb_typeof(assignment_context) = 'object')
);

create unique index item_user_assignment_one_active
  on dflow.item_user_assignment (rfq_item_id, function_key, user_id)
  where effective_to is null;

create index item_user_assignment_active_lookup
  on dflow.item_user_assignment (rfq_item_id, function_key, effective_from, id)
  include (user_id)
  where effective_to is null;

create table dflow.item_workflow_action (
  id bigint generated always as identity primary key,
  rfq_item_id integer not null references dflow."RFQItem"("rfqItem_id") on delete restrict,
  actor_user_id integer not null references dflow.users(id),
  actor_auth_user_id uuid not null,
  prior_step_id integer references dflow."RFQStep"("RFQStep_id"),
  new_step_id integer not null references dflow."RFQStep"("RFQStep_id"),
  action_key text not null check (action_key = lower(btrim(action_key)) and action_key ~ '^[a-z][a-z0-9_-]*$'),
  correlation_key uuid not null unique,
  routing_context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(routing_context) = 'object')
);

create index item_workflow_action_item_time
  on dflow.item_workflow_action (rfq_item_id, occurred_at, id);

alter table dflow.user_notification
  add column workflow_action_id bigint references dflow.item_workflow_action(id) on delete restrict,
  add column idempotency_key text;

create unique index user_notification_action_recipient
  on dflow.user_notification (workflow_action_id, user_id_fk)
  where workflow_action_id is not null;

create unique index user_notification_idempotency_key
  on dflow.user_notification (idempotency_key)
  where idempotency_key is not null;

create or replace function dflow.current_designflow_user_id()
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, dflow, auth
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_user_id integer;
  v_count integer;
begin
  if v_auth_user is null or v_email is null then
    raise exception 'an authenticated user with an email claim is required' using errcode = '42501';
  end if;

  select min(u.id), count(*)::integer
    into v_user_id, v_count
    from dflow.users u
   where lower(btrim(u.email)) = v_email;

  if v_count = 0 then
    raise exception 'authenticated email is not linked to a DesignFlow user' using errcode = '23503';
  elsif v_count > 1 then
    raise exception 'authenticated email maps to multiple DesignFlow users' using errcode = '21000';
  end if;

  return v_user_id;
end
$function$;

create or replace function dflow.reject_item_assignment_history_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog, dflow
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'item assignment history is append-only' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
     or new.rfq_item_id is distinct from old.rfq_item_id
     or new.function_key is distinct from old.function_key
     or new.user_id is distinct from old.user_id
     or new.assigned_by_user_id is distinct from old.assigned_by_user_id
     or new.effective_from is distinct from old.effective_from
     or new.assignment_context is distinct from old.assignment_context
     or new.created_at is distinct from old.created_at
     or old.effective_to is not null
     or new.effective_to is null then
    raise exception 'assignment facts are immutable; only close an active assignment once' using errcode = '55000';
  end if;
  return new;
end
$function$;

create trigger item_user_assignment_immutable_history
before update or delete on dflow.item_user_assignment
for each row execute function dflow.reject_item_assignment_history_rewrite();

create or replace function dflow.reject_item_workflow_action_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog, dflow
as $function$
begin
  raise exception 'workflow action history is append-only' using errcode = '55000';
end
$function$;

create trigger item_workflow_action_immutable
before update or delete on dflow.item_workflow_action
for each row execute function dflow.reject_item_workflow_action_rewrite();

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
  perform 1 from dflow."RFQItem" where "rfqItem_id" = p_rfq_item_id for update;
  if not found then raise exception 'RFQ item % does not exist', p_rfq_item_id using errcode = '23503'; end if;
  perform 1 from dflow.users where id = p_user_id;
  if not found then raise exception 'DesignFlow user % does not exist', p_user_id using errcode = '23503'; end if;

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
        rfq_item_id,function_key,user_id,assigned_by_user_id,assignment_context
      ) values (
        p_rfq_item_id,v_function,p_user_id,v_actor,p_assignment_context
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
    from dflow."RFQItem" i
   where i."rfqItem_id" = p_rfq_item_id
   for update;
  if not found then
    raise exception 'RFQ item % does not exist', p_rfq_item_id using errcode = '23503';
  end if;

  perform 1 from dflow."RFQStep" s where s."RFQStep_id" = p_new_step_id;
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
  ) returning id into v_action_id;

  update dflow."RFQItem"
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

    insert into dflow.user_notification(
      type, created_date, event, unread, message, title, user_id_fk,
      workflow_action_id, idempotency_key
    ) values (
      p_notification_type, current_date, lower(btrim(p_action_key)), true,
      p_notification_message, p_notification_title, v_recipient,
      v_action_id, p_correlation_key::text || ':' || v_recipient::text
    ) on conflict (workflow_action_id, user_id_fk) where workflow_action_id is not null do nothing;
  elsif v_to is not null then
    insert into dflow.user_notification(
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
exception
  when unique_violation then
    select * into v_existing
      from dflow.item_workflow_action
     where correlation_key = p_correlation_key;
    if found
       and v_existing.rfq_item_id = p_rfq_item_id
       and v_existing.new_step_id = p_new_step_id
       and v_existing.action_key = lower(btrim(p_action_key))
       and v_existing.actor_user_id = v_actor then
      return v_existing.id;
    end if;
    raise;
end
$function$;

-- Access model for the two new tables (issue #1987): the `dflow` schema is not
-- exposed through PostgREST and is not in any API search path, so there is no
-- browser-reachable route to these tables. Access is closed explicitly rather
-- than relying on that: every privilege is revoked from `anon` and
-- `authenticated` first, then only SELECT is granted back to `authenticated`
-- and `service_role`. `anon` is granted nothing and can reach nothing. All
-- writes go exclusively through the two SECURITY DEFINER RPCs below, which
-- derive the actor from the JWT, so row-level security is deliberately not
-- enabled here: there is no direct-write path for RLS to police, and no other
-- table in `dflow` enables it. Enabling RLS with no policy would additionally
-- revoke the intended `authenticated` SELECT.
revoke all on dflow.item_user_assignment, dflow.item_workflow_action from anon, authenticated;
revoke all on function dflow.current_designflow_user_id() from public;
-- The two append-only guard functions are trigger functions: they are only ever
-- invoked by the triggers below, never called directly. Revoke the default
-- PUBLIC EXECUTE so they cannot be invoked outside their trigger context.
revoke all on function dflow.reject_item_assignment_history_rewrite() from public;
revoke all on function dflow.reject_item_workflow_action_rewrite() from public;
revoke all on function dflow.set_item_user_assignment(integer,text,integer,boolean,jsonb) from public;
revoke all on function dflow.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb) from public;
grant select on dflow.item_user_assignment, dflow.item_workflow_action to authenticated, service_role;
grant execute on function dflow.current_designflow_user_id() to authenticated, service_role;
grant execute on function dflow.set_item_user_assignment(integer,text,integer,boolean,jsonb) to authenticated, service_role;
grant execute on function dflow.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb) to authenticated, service_role;

comment on table dflow.item_user_assignment is
  'Append-only effective-dated RFQ item assignments. Close an active row; never rewrite assignment facts.';
comment on table dflow.item_workflow_action is
  'Immutable server-attributed RFQ workflow actions. Correlation keys make retries idempotent.';
comment on column dflow.user_notification.workflow_action_id is
  'Links a notification to the immutable workflow action that created it; NULL only for legacy rows.';
