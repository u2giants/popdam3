begin;

do $test$
declare
  r record;
  v_count integer;
begin
  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='plm' and c.relkind='r'
    and (c.relname like 'lucasfilm\_dcp\_%'
         or c.relname like 'twentieth_century\_dcp\_%');
  if v_count <> 40 then
    raise exception '#2879 expected 40 DCP family tables, found %',v_count;
  end if;

  for r in
    select c.relname,
      case when c.relname like 'lucasfilm\_dcp\_%'
        then 'lucasfilm_dcpvault' else 'twentieth_century_dcpvault' end expected
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='plm' and c.relkind='r'
      and (c.relname like 'lucasfilm\_dcp\_%'
           or c.relname like 'twentieth_century\_dcp\_%')
  loop
    if (select i.source_system from api.source_capture_inventory i
        where i.table_name=r.relname) is distinct from r.expected then
      raise exception '#2879 browser inventory misclassified plm.%',r.relname;
    end if;
    if (select i.source_system from api.source_capture_inventory_exact(r.relname) i)
       is distinct from r.expected then
      raise exception '#2879 exact inventory misclassified plm.%',r.relname;
    end if;
  end loop;

  if exists (
    select 1 from api.source_capture_inventory
    where source_system='other'
      and (table_name like 'lucasfilm\_dcp\_%'
           or table_name like 'twentieth_century\_dcp\_%')) then
    raise exception '#2879 a DCP family table remains classified as other';
  end if;
end
$test$;

rollback;
