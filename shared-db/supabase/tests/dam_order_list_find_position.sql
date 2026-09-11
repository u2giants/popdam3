-- Read-only catalog/authorization contracts; synthetic behavior is exercised by
-- scripts/test_order_list_find_position.py in its own loopback database.
do $$
declare p pg_proc;
begin
  select * into strict p from pg_proc where oid='public.find_dam_order_list_row(text,jsonb,jsonb)'::regprocedure;
  if p.prosecdef or p.provolatile <> 's' or not p.proretset then
    raise exception 'Find must remain stable, invoker-secure and set-returning';
  end if;
  if has_function_privilege('anon',p.oid,'execute')
    or has_function_privilege('service_role',p.oid,'execute')
    or not has_function_privilege('authenticated',p.oid,'execute') then
    raise exception 'Find execute privileges differ from authenticated-only contract';
  end if;
  if p.proconfig is distinct from array['search_path=pg_catalog, auth'] then
    raise exception 'Find must retain its fixed search path without timeout changes';
  end if;
end $$;
