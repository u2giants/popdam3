begin;

do $test$
declare
  v_tables integer;
  v_sequences integer;
  v_view text;
begin
  select count(*) into v_tables
  from information_schema.tables
  where table_schema = 'dflow_prod' and table_type = 'BASE TABLE'
    -- Frozen Cloud SQL baseline only: later governed parity migrations add
    -- their own tables and prove them in their own contract files.
    and table_name not in (
      'item_user_assignment', 'item_workflow_action',  -- #2874
      'sample_approval_event', 'sample_carrier', 'sample_creation_batch', 'sample_factory_visit', 'sample_factory_visit_event', 'sample_import_job', 'sample_import_row', 'sample_inventory_balance', 'sample_movement', 'sample_path_revision', 'sample_piece_lineage', 'sample_remote_request', 'sample_remote_request_history', 'sample_remote_request_item', 'sample_reservation', 'sample_shipment', 'sample_shipment_line', 'sample_stop_closeout', 'sample_workflow',  -- #2875
      'sample_shipment_notice', 'sample_shipment_notice_recipient', 'product_type_factory_time'  -- #3737
    );
  if v_tables <> 103 then
    raise exception 'expected 103 dflow_prod tables, found %', v_tables;
  end if;

  select count(*) into v_sequences
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'dflow_prod'
    and c.relkind = 'S'
    and not exists (
      select 1 from pg_depend d
       where d.objid = c.oid and d.deptype = 'i'
         and d.refobjid in (
           select t.oid from pg_class t
            where t.relnamespace = n.oid
              and t.relname in ('item_user_assignment', 'item_workflow_action',
                'sample_approval_event', 'sample_carrier', 'sample_creation_batch', 'sample_factory_visit', 'sample_factory_visit_event', 'sample_import_job', 'sample_import_row', 'sample_inventory_balance', 'sample_movement', 'sample_path_revision', 'sample_piece_lineage', 'sample_remote_request', 'sample_remote_request_history', 'sample_remote_request_item', 'sample_reservation', 'sample_shipment', 'sample_shipment_line', 'sample_stop_closeout', 'sample_workflow',
                'sample_shipment_notice', 'sample_shipment_notice_recipient', 'product_type_factory_time')  -- #2874, #2875 and #3737
         )
    );
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

  -- #2875 brought the current Tracking surface into dflow_prod; the retired
  -- names sample_visit/sample_visit_event were never part of it.
  if (select count(*) from information_schema.tables
      where table_schema = 'dflow_prod'
        and table_name in ('sample_import_job', 'sample_import_row', 'sample_movement',
                           'sample_shipment_line', 'sample_stop_closeout')) <> 5
     or not exists (select 1 from pg_class c where c.relnamespace = 'dflow_prod'::regnamespace
                    and c.relname = 'sample_visit_plan' and c.relkind = 'v')
     or to_regclass('dflow_prod.sample_visit') is not null
     or to_regclass('dflow_prod.sample_visit_event') is not null then
    raise exception 'dflow_prod Tracking surface does not match #2875';
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
