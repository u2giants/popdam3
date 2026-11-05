-- #5696: complete format existence only; never product identity.
begin;
set local lock_timeout = '500ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '3s';

do $guard$
begin
  if length('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') <> 62
     or 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999' <> repeat('A',52)||repeat('9',10)
     or translate('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
       'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
       'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999') <> repeat('A',52)||repeat('9',10) then
    raise exception '#5696 ASCII normalizer must map exactly 52 letters and 10 digits';
  end if;
  if to_regclass('public.idx_style_groups_code_format') is not null
     or to_regprocedure('public.dam_catalog_code_format_exists(text)') is not null then
    raise exception '#5696 target already exists; reconcile its definition before proceeding';
  end if;
  if not has_table_privilege('service_role', 'public.style_groups', 'SELECT') then
    raise exception '#5696 requires existing service_role catalog SELECT; no new table grants authorized';
  end if;
end;
$guard$;

create index idx_style_groups_code_format on public.style_groups
  (pg_catalog.translate(sku,
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999'))
  where sku collate "C" ~ '^[A-Za-z0-9]{7,64}$';

create function public.dam_catalog_code_format_exists(p_format text)
returns boolean
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
set statement_timeout = '1000ms'
as $function$
begin
  if p_format is null
     or p_format collate "C" !~ '^[A9]{7,64}$'
     or pg_catalog.strpos(p_format, 'A') = 0
     or pg_catalog.strpos(p_format, '9') = 0 then
    raise exception using errcode = '22023', message = 'Invalid complete code format';
  end if;
  return exists (
    select 1 from public.style_groups g
    where g.sku collate "C" ~ '^[A-Za-z0-9]{7,64}$'
      and pg_catalog.translate(g.sku,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9999999999') = p_format
  );
end;
$function$;

revoke all on function public.dam_catalog_code_format_exists(text) from public, anon, authenticated;
grant execute on function public.dam_catalog_code_format_exists(text) to service_role;
comment on function public.dam_catalog_code_format_exists(text) is
  '#5696 service-only complete ASCII catalog format existence, not identity. Indexed equality; caller cancellation and existing outer server statement budget remain required. Function-local timeout alone is not a nested hard-deadline guarantee.';
commit;
