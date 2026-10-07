-- Claim #3704 reserves version 20261006235109.
-- Governed reissue of merged, production-unapplied version 20261006211240.
-- The original immutable migration stays in history; this successor works
-- both without it and after it, and refuses any mismatching final catalog.
-- Issue #2874: dflow_prod backend workflow parity.
-- derived-from: 20260901221310, 20260904143518, 20260905053422, 20260907121732
--
-- Brings the CURRENT canonical DesignFlow assignment and workflow-action
-- contract into the self-contained production cutover schema dflow_prod. The
-- DesignFlow backend runs single-schema in production (every model resolves to
-- one schema), so the dflow_prod copy references dflow_prod's own users,
-- "RFQItem", "RFQStep" and user_notification tables -- never legacy dflow,
-- plm or app. Each object carries the LATEST canonical definition, not the
-- first body:
--   * 20260901221310  tables, append-only triggers, assignment function
--   * 20260904143518  ON CONFLICT correlation idempotency
--   * 20260905053422  source_action_id handoff integrity, stale-step 40001,
--                     recipient-required rollback, typed fallback columns,
--                     item_workflow_handoff view
--   * 20260907121732  trusted backend actor (request.designflow.*) with
--                     actor_identity_source / actor_identity_email provenance
--
-- The tables are created empty, so every foreign key is VALID from the start
-- and the #2203 historical backfill has nothing to do. No application row is
-- copied or changed.
--
-- Access: dflow_prod is a closed schema (no browser, anon, authenticated or
-- service_role grants on any existing object). The new objects follow that
-- posture: PUBLIC/anon/authenticated/service_role are revoked and nothing is
-- granted. Least-privilege runtime roles are #2873's job.

set lock_timeout = '5s';
set statement_timeout = '5min';

-- ------------------------------------------------------------------ tables --

create table if not exists dflow_prod.item_user_assignment (
  id bigint generated always as identity primary key,
  rfq_item_id integer not null references dflow_prod."RFQItem"("rfqItem_id") on delete cascade,
  function_key text not null check (function_key = lower(btrim(function_key)) and function_key ~ '^[a-z][a-z0-9_-]*$'),
  user_id integer not null references dflow_prod.users(id),
  assigned_by_user_id integer not null references dflow_prod.users(id),
  effective_from timestamptz not null default clock_timestamp(),
  effective_to timestamptz,
  assignment_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check (effective_to is null or effective_to > effective_from),
  check (jsonb_typeof(assignment_context) = 'object')
);

create unique index if not exists item_user_assignment_one_active
  on dflow_prod.item_user_assignment (rfq_item_id, function_key, user_id)
  where effective_to is null;

create index if not exists item_user_assignment_active_lookup
  on dflow_prod.item_user_assignment (rfq_item_id, function_key, effective_from, id)
  include (user_id)
  where effective_to is null;

create index if not exists item_user_assignment_user_id_idx
  on dflow_prod.item_user_assignment (user_id);

create index if not exists item_user_assignment_assigned_by_user_id_idx
  on dflow_prod.item_user_assignment (assigned_by_user_id);

create table if not exists dflow_prod.item_workflow_action (
  id bigint generated always as identity primary key,
  rfq_item_id integer not null references dflow_prod."RFQItem"("rfqItem_id") on delete restrict,
  actor_user_id integer not null references dflow_prod.users(id),
  actor_auth_user_id uuid,
  prior_step_id integer references dflow_prod."RFQStep"("RFQStep_id"),
  new_step_id integer not null references dflow_prod."RFQStep"("RFQStep_id"),
  action_key text not null check (action_key = lower(btrim(action_key)) and action_key ~ '^[a-z][a-z0-9_-]*$'),
  correlation_key uuid not null unique,
  routing_context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  source_action_id bigint,
  fallback_recipient_user_id integer references dflow_prod.users(id),
  fallback_reason text,
  requires_admin_review boolean not null default false,
  actor_identity_source text not null default
    (case
       when nullif(pg_catalog.current_setting('request.designflow.actor_id', true), '') is not null
         then 'designflow_jwt'
       else 'supabase_auth'
     end),
  actor_identity_email text default
    (pg_catalog.lower(nullif(pg_catalog.btrim(
       coalesce(
         nullif(pg_catalog.current_setting('request.designflow.actor_email', true), ''),
         auth.jwt() ->> 'email'
       )
     ), ''))),
  check (jsonb_typeof(routing_context) = 'object'),
  constraint item_workflow_action_id_rfq_item_key unique (id, rfq_item_id),
  constraint item_workflow_action_source_action_id_fkey
    foreign key (source_action_id, rfq_item_id)
    references dflow_prod.item_workflow_action(id, rfq_item_id)
    on delete restrict,
  constraint item_workflow_action_source_action_not_self
    check (source_action_id is null or source_action_id <> id),
  constraint item_workflow_action_fallback_is_labeled
    check (
      (fallback_recipient_user_id is null and fallback_reason is null)
      or (fallback_recipient_user_id is not null
          and fallback_reason is not null
          and btrim(fallback_reason) <> ''
          and source_action_id is not null)
    ),
  constraint item_workflow_action_return_names_its_source
    check (
      routing_context ->> 'return_to_original_handoff' is distinct from 'true'
      or source_action_id is not null
    ),
  constraint item_workflow_action_actor_provenance
    check (
      (actor_identity_source = 'supabase_auth' and actor_auth_user_id is not null)
      or
      (actor_identity_source = 'designflow_jwt'
        and actor_auth_user_id is null
        and actor_identity_email is not null)
    )
);

create index if not exists item_workflow_action_item_time
  on dflow_prod.item_workflow_action (rfq_item_id, occurred_at, id);

create unique index if not exists item_workflow_action_one_return_per_source
  on dflow_prod.item_workflow_action (source_action_id)
  where source_action_id is not null;

create index if not exists item_workflow_action_open_handoff_lookup
  on dflow_prod.item_workflow_action (rfq_item_id, occurred_at desc, id desc)
  include (actor_user_id);

create index if not exists item_workflow_action_admin_review
  on dflow_prod.item_workflow_action (rfq_item_id, occurred_at)
  where requires_admin_review;

create index if not exists item_workflow_action_actor_user_id_idx
  on dflow_prod.item_workflow_action (actor_user_id);

create index if not exists item_workflow_action_new_step_id_idx
  on dflow_prod.item_workflow_action (new_step_id);

create index if not exists item_workflow_action_prior_step_id_idx
  on dflow_prod.item_workflow_action (prior_step_id);

create index if not exists item_workflow_action_fallback_recipient_idx
  on dflow_prod.item_workflow_action (fallback_recipient_user_id)
  where fallback_recipient_user_id is not null;

-- The production backend model already declares these two columns; dflow_prod
-- is the only DesignFlow notification table that lacked them.
alter table dflow_prod.user_notification
  add column if not exists workflow_action_id bigint
    references dflow_prod.item_workflow_action(id) on delete restrict,
  add column if not exists idempotency_key text;

create unique index if not exists user_notification_action_recipient
  on dflow_prod.user_notification (workflow_action_id, user_id_fk)
  where workflow_action_id is not null;

create unique index if not exists user_notification_idempotency_key
  on dflow_prod.user_notification (idempotency_key)
  where idempotency_key is not null;

-- --------------------------------------------------------------- functions --

create or replace function dflow_prod.current_designflow_user_id()
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, dflow_prod, auth
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_backend_id_text text := nullif(current_setting('request.designflow.actor_id', true), '');
  v_backend_email text := lower(nullif(btrim(
    current_setting('request.designflow.actor_email', true)
  ), ''));
  v_user_id integer;
  v_count integer;
begin
  if v_backend_id_text is not null or v_backend_email is not null then
    if session_user::text not in ('postgres', 'designflow', 'designflow_prod_backend_runtime')
       or auth.role() is not null then
      raise exception 'backend actor context requires the DesignFlow backend database role'
        using errcode = '42501';
    end if;
    if v_backend_id_text is null or v_backend_email is null then
      raise exception 'backend actor id and email are both required' using errcode = '22004';
    end if;
    if v_backend_id_text !~ '^[1-9][0-9]*$'
       or v_backend_id_text::numeric > 2147483647 then
      raise exception 'backend actor id is invalid' using errcode = '22023';
    end if;

    v_user_id := v_backend_id_text::integer;
    select count(*)::integer
      into v_count
      from dflow_prod.users u
     where u.id = v_user_id
       and lower(btrim(u.email)) = v_backend_email
       and lower(btrim(u.status)) = 'active';

    if v_count = 0 then
      raise exception 'backend actor is missing, inactive, or does not match its token email'
        using errcode = '42501';
    end if;
    return v_user_id;
  end if;

  if v_auth_user is null or v_email is null then
    raise exception 'an authenticated user with an email claim is required' using errcode = '42501';
  end if;

  select min(u.id), count(*)::integer
    into v_user_id, v_count
    from dflow_prod.users u
   where lower(btrim(u.email)) = v_email;

  if v_count = 0 then
    raise exception 'authenticated email is not linked to a DesignFlow user' using errcode = '23503';
  elsif v_count > 1 then
    raise exception 'authenticated email maps to multiple DesignFlow users' using errcode = '21000';
  end if;
  return v_user_id;
end
$function$;

create or replace function dflow_prod.reject_item_assignment_history_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog, dflow_prod
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

create or replace trigger item_user_assignment_immutable
before update or delete on dflow_prod.item_user_assignment
for each row execute function dflow_prod.reject_item_assignment_history_rewrite();

create or replace function dflow_prod.reject_item_workflow_action_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog, dflow_prod
as $function$
begin
  raise exception 'workflow action history is append-only' using errcode = '55000';
end
$function$;

create or replace trigger item_workflow_action_immutable
before update or delete on dflow_prod.item_workflow_action
for each row execute function dflow_prod.reject_item_workflow_action_rewrite();

create or replace function dflow_prod.set_item_user_assignment(
  p_rfq_item_id integer,
  p_function_key text,
  p_user_id integer,
  p_active boolean,
  p_assignment_context jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, dflow_prod, auth
as $function$
declare
  v_actor integer := dflow_prod.current_designflow_user_id();
  v_function text := lower(nullif(btrim(p_function_key), ''));
  v_assignment_id bigint;
begin
  if v_function is null or v_function !~ '^[a-z][a-z0-9_-]*$' then
    raise exception 'function key is invalid' using errcode = '22023';
  end if;
  if p_assignment_context is null or jsonb_typeof(p_assignment_context) <> 'object' then
    raise exception 'assignment context must be a JSON object' using errcode = '22023';
  end if;

  perform 1 from dflow_prod."RFQItem" where "rfqItem_id" = p_rfq_item_id for update;
  if not found then
    raise exception 'RFQ item % does not exist', p_rfq_item_id using errcode = '23503';
  end if;
  perform 1 from dflow_prod.users where id = p_user_id;
  if not found then
    raise exception 'DesignFlow user % does not exist', p_user_id using errcode = '23503';
  end if;

  select id into v_assignment_id
    from dflow_prod.item_user_assignment
   where rfq_item_id = p_rfq_item_id
     and function_key = v_function
     and user_id = p_user_id
     and effective_to is null
   for update;

  if p_active then
    if v_assignment_id is null then
      insert into dflow_prod.item_user_assignment(
        rfq_item_id, function_key, user_id, assigned_by_user_id, assignment_context
      ) values (
        p_rfq_item_id, v_function, p_user_id, v_actor, p_assignment_context
      ) returning id into v_assignment_id;
    end if;
  elsif v_assignment_id is not null then
    update dflow_prod.item_user_assignment
       set effective_to = clock_timestamp()
     where id = v_assignment_id;
  end if;

  return v_assignment_id;
end
$function$;

create or replace function dflow_prod.record_item_workflow_action(
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
set search_path = pg_catalog, dflow_prod, auth
as $function$
declare
  v_actor integer := dflow_prod.current_designflow_user_id();
  v_auth_actor uuid := auth.uid();
  v_prior_step integer;
  v_action_id bigint;
  v_existing dflow_prod.item_workflow_action%rowtype;
  v_from text := lower(nullif(btrim(p_from_function_key), ''));
  v_to text := lower(nullif(btrim(p_to_function_key), ''));
  v_context jsonb;
  v_source_action_id bigint;
  v_original_actor integer;
  v_recipient integer;
  v_expected_prior_step_id integer;
  v_require_recipient boolean := true;
  v_fallback_recipient_user_id integer;
  v_fallback_reason text;
  v_notified integer;
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

  if jsonb_typeof(p_routing_context -> 'expected_prior_step_id') not in ('null', 'undefined') then
    if jsonb_typeof(p_routing_context -> 'expected_prior_step_id') <> 'number' then
      raise exception 'routing context expected_prior_step_id must be a number' using errcode = '22023';
    end if;
    v_expected_prior_step_id := (p_routing_context ->> 'expected_prior_step_id')::integer;
  end if;

  if jsonb_typeof(p_routing_context -> 'require_recipient') not in ('null', 'undefined') then
    if jsonb_typeof(p_routing_context -> 'require_recipient') <> 'boolean' then
      raise exception 'routing context require_recipient must be a boolean' using errcode = '22023';
    end if;
    v_require_recipient := (p_routing_context ->> 'require_recipient')::boolean;
  end if;

  if jsonb_typeof(p_routing_context -> 'fallback_recipient_user_id') not in ('null', 'undefined') then
    if jsonb_typeof(p_routing_context -> 'fallback_recipient_user_id') <> 'number' then
      raise exception 'routing context fallback_recipient_user_id must be a number' using errcode = '22023';
    end if;
    v_fallback_recipient_user_id := (p_routing_context ->> 'fallback_recipient_user_id')::integer;
  end if;

  if jsonb_typeof(p_routing_context -> 'fallback_reason') not in ('null', 'undefined') then
    if jsonb_typeof(p_routing_context -> 'fallback_reason') <> 'string' then
      raise exception 'routing context fallback_reason must be a string' using errcode = '22023';
    end if;
    v_fallback_reason := nullif(btrim(p_routing_context ->> 'fallback_reason'), '');
  end if;

  if v_fallback_recipient_user_id is not null then
    if not p_return_to_original_handoff then
      raise exception 'a fallback recipient is only valid on a return to the original handoff'
        using errcode = '22023';
    end if;
    if v_fallback_reason is null then
      raise exception 'a fallback recipient requires a fallback reason' using errcode = '22023';
    end if;
  elsif v_fallback_reason is not null then
    raise exception 'a fallback reason requires a fallback recipient' using errcode = '22023';
  end if;

  select * into v_existing
    from dflow_prod.item_workflow_action
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
    from dflow_prod."RFQItem" i
   where i."rfqItem_id" = p_rfq_item_id
   for update;
  if not found then
    raise exception 'RFQ item % does not exist', p_rfq_item_id using errcode = '23503';
  end if;

  if v_expected_prior_step_id is not null
     and v_prior_step is distinct from v_expected_prior_step_id then
    raise exception
      'RFQ item % moved to step % since it was read at step %; refetch and retry',
      p_rfq_item_id, v_prior_step, v_expected_prior_step_id
      using errcode = '40001';
  end if;

  perform 1 from dflow_prod."RFQStep" s where s."RFQStep_id" = p_new_step_id;
  if not found then
    raise exception 'RFQ step % does not exist', p_new_step_id using errcode = '23503';
  end if;

  if p_return_to_original_handoff then
    select a.id, a.actor_user_id
      into v_source_action_id, v_original_actor
      from dflow_prod.item_workflow_action a
     where a.rfq_item_id = p_rfq_item_id
       and a.routing_context ->> 'from_function_key' = v_to
       and a.routing_context ->> 'to_function_key' = v_from
       and a.source_action_id is null
       and coalesce((a.routing_context ->> 'return_to_original_handoff')::boolean, false) is not true
       and not exists (
             select 1
               from dflow_prod.item_workflow_action r
              where r.source_action_id = a.id
           )
     order by a.occurred_at desc, a.id desc
     limit 1;

    if v_source_action_id is null then
      raise exception 'no open % to % handoff exists for RFQ item %', v_to, v_from, p_rfq_item_id
        using errcode = 'P0002';
    end if;

    v_recipient := coalesce(v_fallback_recipient_user_id, v_original_actor);

    perform 1 from dflow_prod.users u where u.id = v_recipient;
    if not found then
      raise exception 'DesignFlow user % does not exist', v_recipient using errcode = '23503';
    end if;
  end if;

  v_context := (p_routing_context
                  - 'expected_prior_step_id'
                  - 'require_recipient'
                  - 'fallback_recipient_user_id'
                  - 'fallback_reason')
               || jsonb_strip_nulls(jsonb_build_object(
    'from_function_key', v_from,
    'to_function_key', v_to,
    'return_to_original_handoff', p_return_to_original_handoff
  ));

  insert into dflow_prod.item_workflow_action(
    rfq_item_id, actor_user_id, actor_auth_user_id, prior_step_id, new_step_id,
    action_key, correlation_key, routing_context,
    source_action_id, fallback_recipient_user_id, fallback_reason, requires_admin_review
  ) values (
    p_rfq_item_id, v_actor, v_auth_actor, v_prior_step, p_new_step_id,
    lower(btrim(p_action_key)), p_correlation_key, v_context,
    v_source_action_id, v_fallback_recipient_user_id, v_fallback_reason,
    v_fallback_recipient_user_id is not null
  )
  on conflict (correlation_key) do nothing
  returning id into v_action_id;

  if v_action_id is null then
    select * into v_existing
      from dflow_prod.item_workflow_action
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

  update dflow_prod."RFQItem"
     set "rfqItem_step" = p_new_step_id,
         "rfqItem_date_modified" = clock_timestamp()
   where "rfqItem_id" = p_rfq_item_id;

  if p_return_to_original_handoff then
    insert into dflow_prod.user_notification(
      type, created_date, event, unread, message, title, user_id_fk,
      workflow_action_id, idempotency_key
    ) values (
      p_notification_type, current_date, lower(btrim(p_action_key)), true,
      p_notification_message, p_notification_title, v_recipient,
      v_action_id, p_correlation_key::text || ':' || v_recipient::text
    ) on conflict (workflow_action_id, user_id_fk) where workflow_action_id is not null do nothing;
    get diagnostics v_notified = row_count;
  elsif v_to is not null then
    insert into dflow_prod.user_notification(
      type, created_date, event, unread, message, title, user_id_fk,
      workflow_action_id, idempotency_key
    )
    select p_notification_type, current_date, lower(btrim(p_action_key)), true,
           p_notification_message, p_notification_title, a.user_id,
           v_action_id, p_correlation_key::text || ':' || a.user_id::text
      from dflow_prod.item_user_assignment a
     where a.rfq_item_id = p_rfq_item_id
       and a.function_key = v_to
       and a.effective_to is null
    on conflict (workflow_action_id, user_id_fk) where workflow_action_id is not null do nothing;
    get diagnostics v_notified = row_count;
  else
    v_notified := 0;
  end if;

  if v_require_recipient and v_to is not null and coalesce(v_notified, 0) = 0 then
    raise exception
      'no eligible active recipient in function % for RFQ item %; transition rolled back',
      v_to, p_rfq_item_id
      using errcode = 'P0002';
  end if;

  return v_action_id;
end
$function$;

-- -------------------------------------------------------------------- view --

create or replace view dflow_prod.item_workflow_handoff as
select
  a.id                          as handoff_action_id,
  a.rfq_item_id,
  a.actor_user_id               as original_actor_user_id,
  a.occurred_at                 as handed_off_at,
  a.routing_context ->> 'from_function_key' as from_function_key,
  a.routing_context ->> 'to_function_key'   as to_function_key,
  r.id                          as return_action_id,
  r.actor_user_id               as returned_by_user_id,
  r.occurred_at                 as returned_at,
  r.fallback_recipient_user_id,
  r.fallback_reason,
  coalesce(r.requires_admin_review, false) as requires_admin_review,
  (r.id is null)                as is_open
from dflow_prod.item_workflow_action a
left join dflow_prod.item_workflow_action r
       on r.source_action_id = a.id
where a.routing_context ->> 'to_function_key' is not null
  and a.source_action_id is null
  and coalesce((a.routing_context ->> 'return_to_original_handoff')::boolean, false) is not true;

-- ------------------------------------------------------------------ access --

revoke all on dflow_prod.item_user_assignment, dflow_prod.item_workflow_action,
  dflow_prod.item_workflow_handoff from public, anon, authenticated, service_role;
revoke all on sequence dflow_prod.item_user_assignment_id_seq
  from public, anon, authenticated, service_role;
revoke all on sequence dflow_prod.item_workflow_action_id_seq
  from public, anon, authenticated, service_role;
revoke all on function dflow_prod.current_designflow_user_id() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.reject_item_assignment_history_rewrite() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.reject_item_workflow_action_rewrite() from public, anon, authenticated, service_role;
revoke all on function dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb) from public, anon, authenticated, service_role;
revoke all on function dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb) from public, anon, authenticated, service_role;

comment on table dflow_prod.item_user_assignment is
  'Append-only effective-dated RFQ item assignments. Close an active row; never rewrite assignment facts.';
comment on table dflow_prod.item_workflow_action is
  'Immutable server-attributed RFQ workflow actions. Correlation keys make retries idempotent.';
comment on column dflow_prod.user_notification.workflow_action_id is
  'Links a notification to the immutable dflow_prod workflow action that created it; NULL only for legacy rows.';
comment on column dflow_prod.item_workflow_action.source_action_id is
  'The handoff action this action answers. At most one action may answer any handoff.';
comment on column dflow_prod.item_workflow_action.actor_identity_source is
  'Identity authority used for the immutable actor: supabase_auth or designflow_jwt.';
comment on view dflow_prod.item_workflow_handoff is
  'One row per originating handoff action with the return that closed it; is_open drives the open/closed handoff rule.';
comment on function dflow_prod.current_designflow_user_id() is
  'Resolves a Supabase JWT actor, or a transaction-local DesignFlow JWT actor supplied only by direct backend roles postgres/designflow/designflow_prod_backend_runtime, against dflow_prod.users.';
comment on function dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb) is
  'Records one immutable RFQ workflow action in dflow_prod: stale-step rejection, latest-open-handoff return binding, recipient-required rollback.';

-- Fail closed within this migration transaction if an existing object differs.
-- This is the exact catalog contract, including every FK, index, trigger,
-- function signature/body/owner/configuration and client access boundary.
do $reissue_exact_catalog$
declare v_catalog jsonb; v_dependencies jsonb; v_identities jsonb; v_auth jsonb;
begin
-- Fixed metadata-only observation for the backend workflow surface.
WITH rels AS (
 SELECT c.oid,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='dflow_prod' AND c.relname IN ('item_user_assignment','item_workflow_action','user_notification','item_workflow_handoff')
), shape AS (
 SELECT jsonb_build_object(
  'relations',(SELECT jsonb_agg(jsonb_build_array(relname,relkind) ORDER BY relname) FROM rels),
  'columns',(SELECT jsonb_agg(jsonb_build_array(r.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY r.relname,a.attnum) FROM rels r JOIN pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT jsonb_agg(jsonb_build_array(r.relname,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid)) ORDER BY r.relname,c.conname) FROM rels r JOIN pg_constraint c ON c.conrelid=r.oid),
  'indexes',(SELECT jsonb_agg(jsonb_build_array(r.relname,c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) ORDER BY r.relname,c.relname) FROM rels r JOIN pg_index i ON i.indrelid=r.oid JOIN pg_class c ON c.oid=i.indexrelid),
  'triggers',(SELECT jsonb_agg(jsonb_build_array(r.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY r.relname,t.tgname) FROM rels r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal),
  'views',(SELECT jsonb_agg(jsonb_build_array(relname,pg_get_viewdef(oid)) ORDER BY relname) FROM rels WHERE relkind='v')
 ) AS metadata
), funcs AS (
 SELECT p.*,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='dflow_prod' AND p.proname IN ('current_designflow_user_id','reject_item_assignment_history_rewrite','reject_item_workflow_action_rewrite','set_item_user_assignment','record_item_workflow_action')
)
SELECT jsonb_build_object(
 'structure_sha256',(SELECT encode(sha256(convert_to(metadata::text,'UTF8')),'hex') FROM shape),
 'relation_count',(SELECT count(*) FROM rels),
 'client_access_closed',
   NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(rolname,'dflow_prod','USAGE'))
   AND NOT EXISTS (SELECT 1 FROM rels r JOIN pg_class c ON c.oid=r.oid CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee=0 OR acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))
   AND NOT EXISTS (SELECT 1 FROM funcs p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 OR acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))),
 'functions',(SELECT jsonb_agg(jsonb_build_object(
  'name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),
  'argument_names',coalesce(to_jsonb(p.proargnames),'[]'::jsonb),
  'argument_types',(SELECT coalesce(jsonb_agg(format_type(t.oid,NULL) ORDER BY a.ordinal),'[]'::jsonb) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a(oid,ordinal) JOIN pg_type t ON t.oid=a.oid),
  'default_count',p.pronargdefaults,'return_type',format_type(p.prorettype,NULL),
  'security_definer',p.prosecdef,'volatility',p.provolatile,'configuration',to_jsonb(p.proconfig),
  'owner',pg_get_userbyid(p.proowner),'source_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')
 ) ORDER BY p.proname) FROM funcs p)
) INTO v_catalog;

  if v_catalog is distinct from '{"functions":[{"name":"current_designflow_user_id","owner":"postgres","volatility":"s","return_type":"integer","configuration":["search_path=pg_catalog, dflow_prod, auth"],"default_count":0,"source_sha256":"4186a2c9f2d3d15d97a1fb96145ca333870c43988cbd833b38744f4975ccf936","argument_names":[],"argument_types":[],"security_definer":true,"identity_arguments":""},{"name":"record_item_workflow_action","owner":"postgres","volatility":"v","return_type":"bigint","configuration":["search_path=pg_catalog, dflow_prod, auth"],"default_count":7,"source_sha256":"72cebdd3737b54b0809fa31273ed2e6f5f35f1ee0681c922b51641a36acda75d","argument_names":["p_rfq_item_id","p_new_step_id","p_action_key","p_correlation_key","p_from_function_key","p_to_function_key","p_return_to_original_handoff","p_notification_type","p_notification_title","p_notification_message","p_routing_context"],"argument_types":["integer","integer","text","uuid","text","text","boolean","text","text","text","jsonb"],"security_definer":true,"identity_arguments":"p_rfq_item_id integer, p_new_step_id integer, p_action_key text, p_correlation_key uuid, p_from_function_key text, p_to_function_key text, p_return_to_original_handoff boolean, p_notification_type text, p_notification_title text, p_notification_message text, p_routing_context jsonb"},{"name":"reject_item_assignment_history_rewrite","owner":"postgres","volatility":"v","return_type":"trigger","configuration":["search_path=pg_catalog, dflow_prod"],"default_count":0,"source_sha256":"0dc5007ad4850b0e69f81b6b436a59d921e4592a66857dddf719baca47148012","argument_names":[],"argument_types":[],"security_definer":false,"identity_arguments":""},{"name":"reject_item_workflow_action_rewrite","owner":"postgres","volatility":"v","return_type":"trigger","configuration":["search_path=pg_catalog, dflow_prod"],"default_count":0,"source_sha256":"c1618fcdf51e28706a2a88bb75c087255cc527f3f1f588d96f1800d3fd9d5a01","argument_names":[],"argument_types":[],"security_definer":false,"identity_arguments":""},{"name":"set_item_user_assignment","owner":"postgres","volatility":"v","return_type":"bigint","configuration":["search_path=pg_catalog, dflow_prod, auth"],"default_count":1,"source_sha256":"c60d7cf3dd96999e17031c172066fce04bc59c4d172e562676c97b05de05d0f1","argument_names":["p_rfq_item_id","p_function_key","p_user_id","p_active","p_assignment_context"],"argument_types":["integer","text","integer","boolean","jsonb"],"security_definer":true,"identity_arguments":"p_rfq_item_id integer, p_function_key text, p_user_id integer, p_active boolean, p_assignment_context jsonb"}],"relation_count":4,"structure_sha256":"a4ff412de69582b5611d5f459b994cba33b73e4f57c6ceb165eaf0b9f8e89452","client_access_closed":true}'::jsonb then
    raise exception 'issue-2874 reissue refused: existing or resulting catalog differs from the exact canonical contract';
  end if;

  select jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,pg_get_expr(d.adbin,d.adrelid)) order by c.relname,a.attname)
  into v_dependencies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
  left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where n.nspname='dflow_prod' and a.attnum>0 and not a.attisdropped and
    ((c.relname='users' and a.attname in ('id','email','status'))
     or (c.relname='RFQItem' and a.attname in ('rfqItem_id','rfqItem_step','rfqItem_date_modified'))
     or (c.relname='RFQStep' and a.attname='RFQStep_id'));
  if v_dependencies is distinct from '[
    ["RFQItem","rfqItem_date_modified","timestamp without time zone",false,"",null],
    ["RFQItem","rfqItem_id","integer",true,"d",null],
    ["RFQItem","rfqItem_step","integer",false,"",null],
    ["RFQStep","RFQStep_id","integer",true,"a",null],
    ["users","email","character varying(255)",false,"",null],
    ["users","id","integer",true,"a",null],
    ["users","status","character varying(255)",false,"",null]]'::jsonb then
    raise exception 'issue-2874 reissue refused: existing or resulting catalog differs from the exact canonical contract';
  end if;

  select jsonb_agg(jsonb_build_array(t.relname,a.attname,a.attidentity,
    pg_get_serial_sequence(format('%I.%I',n.nspname,t.relname),a.attname),
    format_type(q.seqtypid,null),q.seqincrement,q.seqmin,q.seqmax,q.seqstart,q.seqcache,q.seqcycle,
    pg_get_userbyid(counter.relowner)) order by t.relname)
  into v_identities
  from pg_class t join pg_namespace n on n.oid=t.relnamespace
  join pg_attribute a on a.attrelid=t.oid and a.attname='id' and a.attnum>0 and not a.attisdropped
  join pg_depend ownership on ownership.refclassid='pg_class'::regclass and ownership.refobjid=t.oid
    and ownership.refobjsubid=a.attnum and ownership.classid='pg_class'::regclass and ownership.deptype='i'
  join pg_class counter on counter.oid=ownership.objid and counter.relkind='S'
  join pg_sequence q on q.seqrelid=counter.oid
  where n.nspname='dflow_prod' and t.relname in ('item_user_assignment','item_workflow_action');
  if v_identities is distinct from '[
    ["item_user_assignment","id","a","dflow_prod.item_user_assignment_id_seq","bigint",1,1,9223372036854775807,1,1,false,"postgres"],
    ["item_workflow_action","id","a","dflow_prod.item_workflow_action_id_seq","bigint",1,1,9223372036854775807,1,1,false,"postgres"]]'::jsonb
    or exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('s',c.relowner))) acl
      where n.nspname='dflow_prod' and c.relname in ('item_user_assignment_id_seq','item_workflow_action_id_seq')
        and (acl.grantee=0 or acl.grantee in (select oid from pg_roles where rolname in ('anon','authenticated','service_role')))
    ) or exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join pg_roles r
      where n.nspname='dflow_prod' and c.relname in ('item_user_assignment_id_seq','item_workflow_action_id_seq')
        and r.rolname in ('anon','authenticated','service_role')
        and has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')
    ) then
    raise exception 'issue-2874 reissue refused: existing or resulting catalog differs from the exact canonical contract';
  end if;

  select jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),
    format_type(p.prorettype,null),p.provolatile,p.prosecdef) order by p.proname)
  into v_auth from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='auth' and p.proname in ('jwt','role','uid');
  if v_auth is distinct from '[["jwt","","jsonb","s",false],["role","","text","s",false],["uid","","uuid","s",false]]'::jsonb then
    raise exception 'issue-2874 reissue refused: existing or resulting catalog differs from the exact canonical contract';
  end if;

end
$reissue_exact_catalog$;
