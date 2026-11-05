-- Synthetic-only aggregate and permission checks; never persists test records.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); result bigint; name text;
begin
  foreach name in array array['get_dam_asset_taxonomy_counts()','get_dam_order_list_status_counts()',
    'get_dam_style_group_asset_count(jsonb,timestamp with time zone,uuid[],text[])'] loop
    if has_function_privilege('anon','public.'||name,'EXECUTE') then raise exception 'anonymous execute leaked: %',name; end if;
    if not has_function_privilege('authenticated','public.'||name,'EXECUTE') then raise exception 'authenticated execute missing'; end if;
  end loop;
  insert into public.style_groups(id,sku,folder_path,asset_count,latest_file_date,is_licensed)
  values(a,'ZZ-AUDIT-COUNT-A','ZZ-AUDIT/Wall',3,now(),true),(b,'ZZ-AUDIT-COUNT-B','ZZ-AUDIT/Tabletop',5,now(),false);
  result:=public.get_dam_style_group_asset_count('{}', '2020-01-01',array[a,b],null);
  if result<>8 then raise exception 'sum lost group rows: %',result; end if;
  result:=public.get_dam_style_group_asset_count('{"isLicensed":true}', '2020-01-01',array[a,b],null);
  if result<>3 then raise exception 'licensed filter differs: %',result; end if;
  result:=public.get_dam_style_group_asset_count('{}', '2020-01-01',array[]::uuid[],null);
  if result<>0 then raise exception 'empty ranked IDs broadened search'; end if;
  result:=public.get_dam_style_group_asset_count('{}', '2020-01-01',array[a,b],array['COUNT-A']);
  if result<>3 then raise exception 'fallback text filter differs: %',result; end if;
  -- Aggregates expose numbers only, retaining the exact existing status names.
  if not (public.get_dam_order_list_status_counts() ?& array['total','linked','ambiguous','unmatched']) then
    raise exception 'order counts response incomplete';
  end if;
  if not (public.get_dam_asset_taxonomy_counts() ?& array['licensors','properties']) then
    raise exception 'taxonomy counts response incomplete';
  end if;
end $$;
-- A signed-in identity without DAM access must remain denied.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}',true);
do $$ begin
  begin perform public.get_dam_asset_taxonomy_counts(); raise exception 'denied identity accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.get_dam_order_list_status_counts(); raise exception 'denied identity accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.get_dam_style_group_asset_count(); raise exception 'denied identity accepted';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
