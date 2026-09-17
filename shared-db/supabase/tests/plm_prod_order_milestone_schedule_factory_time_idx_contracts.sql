-- #3154 contracts: factory_time_id index on plm.prod_order_milestone_schedule.

do $$
begin
  if to_regclass('plm.prod_order_milestone_schedule_factory_time_id_idx') is null then
    raise exception 'plm.prod_order_milestone_schedule_factory_time_id_idx is missing';
  end if;

  if not exists (
    select 1
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     where i.indexrelid = 'plm.prod_order_milestone_schedule_factory_time_id_idx'::regclass
       and i.indrelid = 'plm.prod_order_milestone_schedule'::regclass
       and i.indnkeyatts = 1
       and a.attname = 'factory_time_id'
  ) then
    raise exception 'index must cover plm.prod_order_milestone_schedule(factory_time_id) only';
  end if;
end $$;
