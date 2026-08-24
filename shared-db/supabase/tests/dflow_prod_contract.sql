begin;

do $test$
declare
  v_tables integer;
  v_sequences integer;
  v_view text;
begin
  select count(*) into v_tables
  from information_schema.tables
  where table_schema = 'dflow_prod' and table_type = 'BASE TABLE';
  if v_tables <> 103 then
    raise exception 'expected 103 dflow_prod tables, found %', v_tables;
  end if;

  select count(*) into v_sequences
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'dflow_prod'
    and c.relkind = 'S';
  if v_sequences <> 97 then
    raise exception 'expected 97 dflow_prod sequences, found %', v_sequences;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'dflow_prod'
      and column_default like '%dflow.%'
  ) then
    raise exception 'dflow_prod default still references nonproduction dflow';
  end if;

  if to_regclass('dflow_archive."AuditLog"') is null
     or to_regclass('dflow_prod."AuditLogHistory"') is null then
    raise exception 'audit live/archive read contract is incomplete';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'dflow_prod'
      and table_name in (
        'sample_import_job', 'sample_import_row', 'sample_movement',
        'sample_shipment_line', 'sample_stop_closeout', 'sample_visit',
        'sample_visit_event', 'sample_visit_plan'
      )
  ) then
    raise exception 'newer Sample Tracking-only surface is active';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'dflow_prod' and table_name = 'users'
      and column_name = 'office_location'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'dflow_prod' and table_name = 'users'
      and column_name = 'preferred_language'
  ) then
    raise exception 'current production user fields are missing';
  end if;

  select pg_get_viewdef('public.style_tracker_rows_with_bridge'::regclass, true)
    into v_view;
  if v_view not like '%dflow."RFQItem"%'
     or v_view not like '%dflow."RFQGroup"%'
     or v_view like '%dflow_prod."RFQItem"%'
     or v_view like '%dflow_prod."RFQGroup"%' then
    raise exception 'style tracker bridge moved before the guarded data cutover';
  end if;

  if (select count(*) from dflow_prod."AuditLog") <> 0
     or (select count(*) from dflow_archive."AuditLog") <> 0 then
    raise exception 'structure migration copied AuditLog rows';
  end if;
end
$test$;

rollback;
