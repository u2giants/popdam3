-- Issue #2496: let the DesignFlow backend attribute assignment and workflow
-- writes to the staff identity in its already-verified DesignFlow JWT without
-- inventing a Supabase auth UUID. Claim #2499 reserves this version.
-- derived-from: 20260901221310

set lock_timeout = '5s';
set statement_timeout = '5min';

-- Existing rows were written only through the Supabase-authenticated function,
-- so the default truthfully classifies their UUID provenance. New backend rows
-- receive the other value from a transaction-local trusted-session contract.
alter table dflow.item_workflow_action
  alter column actor_auth_user_id drop not null,
  add column actor_identity_source text not null default
    (case
       when nullif(pg_catalog.current_setting('request.designflow.actor_id', true), '') is not null
         then 'designflow_jwt'
       else 'supabase_auth'
     end),
  add column actor_identity_email text default
    (pg_catalog.lower(nullif(pg_catalog.btrim(
       coalesce(
         nullif(pg_catalog.current_setting('request.designflow.actor_email', true), ''),
         auth.jwt() ->> 'email'
       )
     ), '')));

alter table dflow.item_workflow_action
  add constraint item_workflow_action_actor_provenance
  check (
    (actor_identity_source = 'supabase_auth' and actor_auth_user_id is not null)
    or
    (actor_identity_source = 'designflow_jwt'
      and actor_auth_user_id is null
      and actor_identity_email is not null)
  );

-- A direct DesignFlow backend transaction sets both request.designflow values
-- with set_config(..., true), then calls the existing functions. Only the
-- backend's actual direct database roles are trusted to use those values:
--   * postgres   -- current Supabase pooler login in develop/staging/sandbox
--   * designflow -- dedicated production Cloud SQL login
-- PostgREST sessions are authenticator/authenticated/service_role sessions and
-- cannot turn caller-controlled settings into a backend identity.
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
  v_backend_id_text text := nullif(current_setting('request.designflow.actor_id', true), '');
  v_backend_email text := lower(nullif(btrim(
    current_setting('request.designflow.actor_email', true)
  ), ''));
  v_user_id integer;
  v_count integer;
begin
  if v_backend_id_text is not null or v_backend_email is not null then
    if session_user::text not in ('postgres', 'designflow')
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
      from dflow.users u
     where u.id = v_user_id
       and lower(btrim(u.email)) = v_backend_email
       and lower(btrim(u.status)) = 'active';

    if v_count = 0 then
      raise exception 'backend actor is missing, inactive, or does not match its token email'
        using errcode = '42501';
    end if;
    return v_user_id;
  end if;

  -- Preserve the existing Supabase-authenticated entry point unchanged.
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

-- Keep the browser grants exactly as before. The dedicated production backend
-- role exists only on its target, so grant to it when present without creating
-- or altering role infrastructure in this schema migration.
revoke all on function dflow.current_designflow_user_id() from public;
grant execute on function dflow.current_designflow_user_id() to authenticated, service_role;

do $grant_backend$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'designflow') then
    grant execute on function dflow.current_designflow_user_id() to designflow;
    grant execute on function dflow.set_item_user_assignment(integer,text,integer,boolean,jsonb) to designflow;
    grant execute on function dflow.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb) to designflow;
  end if;
end
$grant_backend$;

comment on function dflow.current_designflow_user_id() is
  'Resolves a Supabase JWT actor, or a transaction-local DesignFlow JWT actor supplied only by direct backend roles postgres/designflow. Backend identity requires exact active dflow.users ID plus normalized email.';
comment on column dflow.item_workflow_action.actor_auth_user_id is
  'Supabase auth UUID for actor_identity_source=supabase_auth; NULL for DesignFlow-owned JWT actors because no Supabase UUID exists.';
comment on column dflow.item_workflow_action.actor_identity_source is
  'Identity authority used for the immutable actor: supabase_auth or designflow_jwt.';
comment on column dflow.item_workflow_action.actor_identity_email is
  'Normalized email presented by the verified identity token when the action was recorded; NULL is retained only for historical Supabase-auth rows.';
