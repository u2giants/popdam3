-- #5696: preview contracts with synthetic fixtures; entire transaction rolls back.
begin;
set local search_path = pg_catalog, public;
do $test$
declare
  f pg_proc;
  item text;
  installed_expression text;
  installed_predicate text;
  expected_expression constant text := $expr$translate(sku, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'::text, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999'::text)$expr$;
  expected_predicate constant text := $predicate$((sku COLLATE "C") ~ '^[A-Za-z0-9]{7,64}$'::text)$predicate$;
begin
  select * into strict f from pg_proc
  where oid='public.dam_catalog_code_format_exists(text)'::regprocedure;
  if f.prosecdef or f.provolatile <> 's'
     or pg_get_userbyid(f.proowner) <> 'postgres'
     or f.prorettype <> 'boolean'::regtype then
    raise exception 'format reader must remain stable/security-invoker';
  end if;
  if has_function_privilege('anon',f.oid,'EXECUTE')
     or has_function_privilege('authenticated',f.oid,'EXECUTE')
     or not has_function_privilege('service_role',f.oid,'EXECUTE')
     or exists (select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))
                where grantee=0 and privilege_type='EXECUTE') then
    raise exception 'format reader is restricted to the existing service-role contract';
  end if;
  if (select count(*) from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))) <> 2
     or exists (select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))
                where grantee not in (f.proowner,'service_role'::regrole)
                   or grantor <> f.proowner or privilege_type <> 'EXECUTE' or is_grantable) then
    raise exception 'format reader owner/ACL differs from exact owner-plus-service-role contract';
  end if;
  select pg_get_expr(i.indexprs,i.indrelid),pg_get_expr(i.indpred,i.indrelid)
    into strict installed_expression,installed_predicate
    from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
    where i.indexrelid='public.idx_style_groups_code_format'::regclass
      and i.indrelid='public.style_groups'::regclass
      and i.indisvalid and i.indisready and not i.indisunique and not i.indisprimary
      and i.indnkeyatts=1 and i.indnatts=1 and am.amname='btree';
  if regexp_replace(installed_expression,'[[:space:]]','','g') is distinct from regexp_replace(expected_expression,'[[:space:]]','','g')
     or regexp_replace(installed_predicate,'[[:space:]]','','g') is distinct from regexp_replace(expected_predicate,'[[:space:]]','','g') then
    raise exception 'complete-format index expression/predicate changed';
  end if;
  if installed_expression is null or installed_predicate is null then
    raise exception 'complete-format equality index is absent/invalid';
  end if;
  if not ('statement_timeout=1000ms'=any(f.proconfig)) then
    raise exception 'function timeout hint changed; outer deadline proof remains separately required';
  end if;
  -- Actual installed RPC behavior, not a separately handwritten reader.
  insert into public.style_groups(sku,folder_path)
    values (repeat('z',63)||'7','__contract_5696__') on conflict do nothing;
end;
$test$;
set local role service_role;
do $behavior$
declare item text; negative_format text;
begin
  if public.dam_catalog_code_format_exists(repeat('A',63)||'9') is distinct from true then
    raise exception 'installed format RPC missed synthetic complete shape';
  end if;
  select candidate into negative_format
  from (select repeat('9',n)||repeat('A',64-n) candidate from generate_series(1,63) n) c
  where not exists (select 1 from public.style_groups g
    where g.sku collate "C" ~ '^[A-Za-z0-9]{7,64}$'
      and translate(g.sku,'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999')=c.candidate)
  limit 1;
  if negative_format is null then raise exception 'no independently absent negative fixture shape'; end if;
  if public.dam_catalog_code_format_exists(negative_format) is distinct from false then
    raise exception 'installed format RPC returned true for independently absent shape';
  end if;
  foreach item in array array[null::text,'','AAAAAAA','9999999','AAA99','A9.*AAAA','A9AAAAĀ',repeat('A',64)||'9'] loop
    begin
      perform public.dam_catalog_code_format_exists(item);
      raise exception 'invalid format did not raise22023';
    exception when invalid_parameter_value then null;
    end;
  end loop;
end;
$behavior$;
rollback;
