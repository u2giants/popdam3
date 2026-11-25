-- Behavioural contract for migration 20261225141301 (#7132): read-only role
-- ai_readonly_reader for AI helper tools. Catalog and privilege contract only.
-- Runs inside a transaction that rolls back.

do $contract$
declare
  v_rel text;
  v_priv text;
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_readonly_reader') then
    raise exception 'ai_readonly_reader is missing';
  end if;
  -- NOLOGIN in git; login is provisioned outside git after promotion.
  if exists (select 1 from pg_roles where rolname = 'ai_readonly_reader'
             and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication)) then
    raise exception 'ai_readonly_reader has an unexpected role attribute';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'ai_readonly_reader' and rolbypassrls) then
    raise exception 'ai_readonly_reader must bypass row rules to read business tables';
  end if;
  if not exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
                 where r.rolname = 'ai_readonly_reader'
                   and 'default_transaction_read_only=on' = any(s.setconfig)) then
    raise exception 'ai_readonly_reader lacks default_transaction_read_only=on';
  end if;
  if pg_has_role('ai_readonly_reader', 'authenticated', 'MEMBER')
     or pg_has_role('ai_readonly_reader', 'service_role', 'MEMBER') then
    raise exception 'ai_readonly_reader must not be a member of an API role';
  end if;

  -- No write privilege on any table, no schema CREATE.
  if exists (select 1 from information_schema.role_table_grants
             where grantee = 'ai_readonly_reader' and privilege_type <> 'SELECT') then
    raise exception 'ai_readonly_reader holds a non-SELECT table privilege';
  end if;
  if exists (select 1 from pg_namespace n
             where has_schema_privilege('ai_readonly_reader', n.oid, 'CREATE')
               and n.nspname not in ('public')) then
    raise exception 'ai_readonly_reader can CREATE in a schema';
  end if;

  -- Supabase system schemas stay closed.
  foreach v_rel in array array['auth', 'storage', 'vault'] loop
    if to_regnamespace(v_rel) is not null
       and has_schema_privilege('ai_readonly_reader', v_rel, 'USAGE') then
      raise exception 'ai_readonly_reader has USAGE on %', v_rel;
    end if;
  end loop;

  -- Secret columns and token tables are withheld (existence-guarded).
  foreach v_rel in array array['app.users', 'dflow_prod.users'] loop
    if to_regclass(v_rel) is not null
       and has_column_privilege('ai_readonly_reader', v_rel, 'passw', 'SELECT') then
      raise exception 'ai_readonly_reader can read %.passw', v_rel;
    end if;
  end loop;
  foreach v_rel in array array['app.auth_token', 'app.quote_auth_token',
                               'dflow_prod.auth_token', 'dflow_prod.quote_auth_token'] loop
    if to_regclass(v_rel) is not null
       and has_any_column_privilege('ai_readonly_reader', v_rel, 'SELECT') then
      raise exception 'ai_readonly_reader can read %', v_rel;
    end if;
  end loop;

  -- It can read ordinary business tables created by migrations (existence-guarded).
  foreach v_rel in array array['core.licensor'] loop
    if to_regclass(v_rel) is not null
       and not has_table_privilege('ai_readonly_reader', v_rel, 'SELECT') then
      raise exception 'ai_readonly_reader cannot read %', v_rel;
    end if;
  end loop;
end
$contract$;
