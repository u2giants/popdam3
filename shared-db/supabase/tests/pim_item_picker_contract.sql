begin;
do $$
begin
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='api' and c.relname='pim_item_picker' and 'security_invoker=true'=any(c.reloptions)) then
    raise exception 'picker must preserve invoker security';
  end if;
  if has_table_privilege('anon','api.pim_item_picker','select') then raise exception 'anonymous read granted'; end if;
  if not has_table_privilege('authenticated','api.pim_item_picker','select') then raise exception 'authenticated read missing'; end if;
  if has_table_privilege('anon','api.pim_item_picker','insert')
     or has_table_privilege('anon','api.pim_item_picker','update')
     or has_table_privilege('anon','api.pim_item_picker','delete')
     or has_table_privilege('authenticated','api.pim_item_picker','insert')
     or has_table_privilege('authenticated','api.pim_item_picker','update')
     or has_table_privilege('authenticated','api.pim_item_picker','delete') then
    raise exception 'picker gained a browser write privilege';
  end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='plm' and c.relname='item' and c.relrowsecurity) then
    raise exception 'invoker picker relies on plm.item row security, which is not enabled';
  end if;
  if exists(select item_id from api.pim_item_picker group by item_id having count(*)<>1) then raise exception 'duplicate item identity'; end if;
  if exists((select id,source_system,source_id,item_number,description,raw->>'companyCode',raw->>'divisionCode'
       from plm.item where source_system='coldlion')
      except (select item_id,source_system,source_id,item_number,description,company_code,division_code from api.pim_item_picker))
    or exists((select item_id,source_system,source_id,item_number,description,company_code,division_code from api.pim_item_picker)
      except (select id,source_system,source_id,item_number,description,raw->>'companyCode',raw->>'divisionCode'
       from plm.item where source_system='coldlion')) then raise exception 'canonical projection mismatch'; end if;
end $$;
rollback;
