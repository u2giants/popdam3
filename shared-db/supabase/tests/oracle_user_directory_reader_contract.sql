-- Behavioural contract for migration 20261106010627 (#5776): read-only DesignFlow
-- user directory for The Oracle — function api.oracle_user_directory() and role
-- oracle_directory_reader. Catalog and privilege contract only; the live read
-- as the role lives in oracle_user_directory_reader_live_read_contracts.sql
-- (quarantined: it needs dflow_prod.user_roles, which the from-empty lane never
-- creates). Runs inside a transaction that rolls back.

do $catalog$
declare
  v_priv text;
  v_rel text;
begin
  -- Role shape: NOLOGIN and nothing but the one EXECUTE.
  if not exists (select 1 from pg_roles where rolname = 'oracle_directory_reader') then
    raise exception 'oracle_directory_reader is missing';
  end if;
  if exists (select 1 from pg_roles where rolname = 'oracle_directory_reader'
             and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication)) then
    raise exception 'oracle_directory_reader has an unexpected role attribute';
  end if;

  if to_regprocedure('api.oracle_user_directory()') is null then
    raise exception 'api.oracle_user_directory() is missing';
  end if;

  if not has_function_privilege('oracle_directory_reader', 'api.oracle_user_directory()', 'EXECUTE') then
    raise exception 'oracle_directory_reader cannot execute api.oracle_user_directory()';
  end if;

  -- Browser roles and the service role must not see the company directory.
  foreach v_priv in array array['anon', 'authenticated', 'service_role', 'public'] loop
    if has_function_privilege(v_priv, 'api.oracle_user_directory()', 'EXECUTE') then
      raise exception '% can execute api.oracle_user_directory()', v_priv;
    end if;
  end loop;

  -- No direct reach into dflow_prod — the legacy passw column included.
  -- Existence-guarded: the from-empty lane never creates dflow_prod.user_roles
  -- (20261022182809 refuses without the real role-tree rows), and
  -- has_*_privilege errors on a missing relation instead of returning false.
  if has_schema_privilege('oracle_directory_reader', 'dflow_prod', 'USAGE') then
    raise exception 'oracle_directory_reader has USAGE on dflow_prod';
  end if;
  if to_regclass('dflow_prod.users') is not null
     and has_column_privilege('oracle_directory_reader', 'dflow_prod.users', 'passw', 'SELECT') then
    raise exception 'oracle_directory_reader can read dflow_prod.users.passw';
  end if;
  foreach v_rel in array array['dflow_prod.users', 'dflow_prod.user_roles', 'dflow_prod."Roles"'] loop
    if to_regclass(v_rel) is null then
      continue;
    end if;
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('oracle_directory_reader', v_rel, v_priv) then
        raise exception 'oracle_directory_reader holds % on %', v_priv, v_rel;
      end if;
    end loop;
  end loop;
  if has_schema_privilege('oracle_directory_reader', 'api', 'CREATE') then
    raise exception 'oracle_directory_reader can CREATE in api';
  end if;

  -- Projection shape: the safe identity columns plus role names, nothing else.
  if not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('api.oracle_user_directory()')
      and p.provolatile = 's'
      and p.prosecdef
  ) then
    raise exception 'api.oracle_user_directory() must be STABLE and SECURITY DEFINER';
  end if;
  if not (
    select p.proargnames = array['user_id', 'email', 'name', 'lastname', 'status', 'level', 'office_location', 'roles']
    from pg_proc p where p.oid = to_regprocedure('api.oracle_user_directory()')
  ) then
    raise exception 'api.oracle_user_directory() output columns changed';
  end if;
end
$catalog$;
