-- Contract for public.import_dam_buy_sheet / dam.order_buy_sheet_import
-- (migration 20261110190600_dam_order_buy_sheet_import.sql). No fixtures: the
-- behaviour (match, update, held, idempotent re-upload) is exercised by the
-- PopDAM app tests and live dry run; this file pins the security shape.
do $$
declare v_def boolean; v_rls boolean;
begin
  select prosecdef into v_def from pg_proc
   where oid = 'public.import_dam_buy_sheet(uuid,text,text,jsonb,jsonb,jsonb,boolean)'::regprocedure;
  if not v_def then raise exception 'import_dam_buy_sheet must be security definer'; end if;
  if has_function_privilege('anon', 'public.import_dam_buy_sheet(uuid,text,text,jsonb,jsonb,jsonb,boolean)', 'execute') then
    raise exception 'anon must not execute import_dam_buy_sheet';
  end if;
  if not has_function_privilege('authenticated', 'public.import_dam_buy_sheet(uuid,text,text,jsonb,jsonb,jsonb,boolean)', 'execute') then
    raise exception 'authenticated must execute import_dam_buy_sheet';
  end if;
  select relrowsecurity into v_rls from pg_class where oid = 'dam.order_buy_sheet_import'::regclass;
  if not v_rls then raise exception 'dam.order_buy_sheet_import must have RLS enabled'; end if;
  if has_table_privilege('authenticated', 'dam.order_buy_sheet_import', 'select')
     or has_table_privilege('anon', 'dam.order_buy_sheet_import', 'select') then
    raise exception 'browser roles must not read dam.order_buy_sheet_import directly';
  end if;
  begin
    perform public.import_dam_buy_sheet(gen_random_uuid(), 'x', repeat('a', 64), '{}', '[{"sku":"X","delivery_date":"2026-01-01","quantity":1}]', '{}', false);
    raise exception 'unauthenticated call was not refused';
  exception when insufficient_privilege then null;
  end;
end $$;
