begin;

-- shared-db#4168: get/set_sg_nas_password are service_role-only and round-trip
-- through Vault. Rolled back.
do $$
begin
  -- supabase_vault ships with every Supabase stack, including the CLI stack the
  -- ephemeral contract-test job starts (this test passed there on PR #4182); skip
  -- with a notice, like the pg_cron/dblink tests, on a bare PostgreSQL without it.
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise notice 'SKIP: supabase_vault is not installed in this database';
    return;
  end if;
  if has_function_privilege('authenticated', 'public.get_sg_nas_password()', 'execute')
     or has_function_privilege('anon', 'public.get_sg_nas_password()', 'execute')
     or has_function_privilege('authenticated', 'public.set_sg_nas_password(text)', 'execute')
     or has_function_privilege('anon', 'public.set_sg_nas_password(text)', 'execute') then
    raise exception 'sg nas password functions must not be executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.get_sg_nas_password()', 'execute')
     or not has_function_privilege('service_role', 'public.set_sg_nas_password(text)', 'execute') then
    raise exception 'service_role must execute the sg nas password functions';
  end if;

  if (select count(*) from pg_proc p
       where p.oid = 'public.get_sg_nas_password()'::regprocedure
         and p.prosecdef and p.provolatile = 's'
         and p.prorettype = 'text'::regtype
         and 'search_path=""' = any(p.proconfig)) <> 1 then
    raise exception 'get_sg_nas_password must be stable security definer returning text with empty search_path';
  end if;
  if (select count(*) from pg_proc p
       where p.oid = 'public.set_sg_nas_password(text)'::regprocedure
         and p.prosecdef and p.provolatile = 'v'
         and p.prorettype = 'void'::regtype
         and 'search_path=""' = any(p.proconfig)) <> 1 then
    raise exception 'set_sg_nas_password must be volatile security definer returning void with empty search_path';
  end if;

  if has_table_privilege('anon', 'vault.secrets', 'select')
     or has_table_privilege('authenticated', 'vault.secrets', 'select')
     or has_table_privilege('anon', 'vault.decrypted_secrets', 'select')
     or has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select') then
    raise exception 'anon/authenticated must not read Vault directly';
  end if;

  perform public.set_sg_nas_password('zz-test-4168-a');
  if public.get_sg_nas_password() <> 'zz-test-4168-a' then
    raise exception 'set then get did not round-trip';
  end if;
  perform public.set_sg_nas_password('zz-test-4168-b');
  if public.get_sg_nas_password() <> 'zz-test-4168-b' then
    raise exception 'replace did not round-trip';
  end if;
  if (select count(*) from vault.secrets where name = 'popdam_sg_nas_password') <> 1 then
    raise exception 'replace must keep exactly one vault secret';
  end if;
  perform public.set_sg_nas_password(null);
  if public.get_sg_nas_password() <> '' then
    raise exception 'clear must yield empty string';
  end if;
end;
$$;

rollback;
