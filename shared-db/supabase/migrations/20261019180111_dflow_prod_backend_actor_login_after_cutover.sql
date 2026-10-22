-- #4493: restore the production backend login in the DesignFlow actor check.
-- derived-from: 20261006235109
--
-- The 2026-10-17 Cloud SQL -> Supabase host cutover (#770) renamed the Cloud SQL
-- dump schema into dflow_prod. That replaced the repository-managed
-- dflow_prod.current_designflow_user_id() with the Cloud SQL copy, whose
-- session_user allowlist is ('postgres', 'designflow') and which has no
-- Supabase-JWT route. Production logs in as designflow_prod_backend_runtime
-- (#2873), so every backend workflow write (RFQ Step changes,
-- SYS-RFQ-WF-004) fails with 42501.
--
-- This restores the canonical body from 20261006235109 unchanged, which
-- allows designflow_prod_backend_runtime and keeps the Supabase-JWT route the
-- dflow_prod workflow parity contracts require. Client access stays closed.

-- Precondition: the columns the restored body reads exist in live dflow_prod.users.
do $pre$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'dflow_prod' and table_name = 'users'
         and column_name in ('id', 'email', 'status')) <> 3 then
    raise exception '#4493 precondition failed: dflow_prod.users lacks id, email or status';
  end if;
  if to_regrole('designflow_prod_backend_runtime') is null then
    raise exception '#4493 precondition failed: designflow_prod_backend_runtime role is missing';
  end if;
end
$pre$;

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

revoke all on function dflow_prod.current_designflow_user_id() from public, anon, authenticated, service_role;
comment on function dflow_prod.current_designflow_user_id() is
  'Resolves a Supabase JWT actor, or a transaction-local DesignFlow JWT actor supplied only by direct backend roles postgres/designflow/designflow_prod_backend_runtime, against dflow_prod.users.';

-- Postcondition: exact shape, security and allowlist of the restored function.
do $post$
declare
  v_oid oid := to_regprocedure('dflow_prod.current_designflow_user_id()');
  v_def text;
begin
  if v_oid is null then
    raise exception '#4493 postcondition failed: function is missing';
  end if;
  v_def := pg_get_functiondef(v_oid);
  if not (select p.prosecdef and p.provolatile = 's'
                 and p.prorettype = 'integer'::regtype
                 and p.proconfig = array['search_path=pg_catalog, dflow_prod, auth']
                 and pg_get_userbyid(p.proowner) = 'postgres'
            from pg_proc p where p.oid = v_oid) then
    raise exception '#4493 postcondition failed: definer, volatility, return type, search_path or owner differs';
  end if;
  if position($q$'postgres', 'designflow', 'designflow_prod_backend_runtime'$q$ in v_def) = 0 then
    raise exception '#4493 postcondition failed: backend login allowlist missing';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute')
     or has_function_privilege('service_role', v_oid, 'execute') then
    raise exception '#4493 postcondition failed: client roles can execute the actor function';
  end if;
end
$post$;
