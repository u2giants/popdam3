-- Behavioural contract for migration 20261026181941 (#4836): read-only Poppim
-- diagnostic role poppim_readonly_jcortazar. Runs inside a transaction that rolls back.

do $catalog$
declare
  v_rel regclass;
  v_schema text;
  v_priv text;
begin
  -- Reads what Poppim needs.
  foreach v_rel in array array['pim.product', 'pim.stage', 'app.profile', 'core.licensor']::regclass[] loop
    if not has_table_privilege('poppim_readonly_jcortazar', v_rel, 'SELECT') then
      raise exception 'poppim_readonly_jcortazar cannot read %', v_rel;
    end if;
  end loop;

  -- Never writes anything it can read.
  for v_rel in
    select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('pim', 'app', 'core', 'api') and c.relkind in ('r', 'v', 'm', 'p')
  loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('poppim_readonly_jcortazar', v_rel, v_priv) then
        raise exception 'poppim_readonly_jcortazar holds % on %', v_priv, v_rel;
      end if;
    end loop;
  end loop;

  -- No reach into excluded schemas, and no CREATE anywhere.
  foreach v_schema in array array['crm', 'dam', 'plm', 'coldlion', 'auth', 'vault', 'storage', 'ingest', 'api'] loop
    if exists (select 1 from pg_namespace where nspname = v_schema)
       and has_schema_privilege('poppim_readonly_jcortazar', v_schema, 'USAGE') then
      raise exception 'poppim_readonly_jcortazar has USAGE on %', v_schema;
    end if;
  end loop;
  foreach v_schema in array array['pim', 'app', 'core', 'public'] loop
    if has_schema_privilege('poppim_readonly_jcortazar', v_schema, 'CREATE') then
      raise exception 'poppim_readonly_jcortazar can CREATE in %', v_schema;
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'poppim_readonly_jcortazar'
             and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication)) then
    raise exception 'poppim_readonly_jcortazar has an unexpected role attribute';
  end if;
end
$catalog$;

-- Live read and write-deny as the role. The CI session user created the role and
-- holds ADMIN on it; this grant is test-only and rolls back.
grant poppim_readonly_jcortazar to postgres;
set local role poppim_readonly_jcortazar;

select count(*) from pim.product;
select count(*) from core.licensor;

do $deny$
begin
  begin
    update pim.product set id = id where false;
    raise exception 'poppim_readonly_jcortazar was able to UPDATE pim.product';
  exception when insufficient_privilege or read_only_sql_transaction then null;
  end;
end
$deny$;

reset role;
