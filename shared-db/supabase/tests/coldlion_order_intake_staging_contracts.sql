-- Issue #3679: the ColdLion intake staging layer holds its contracts —
-- identity uniques, the EP001 exclusion, version-on-hash-change, the novelty
-- queue's zero guard, the routing-map decode key, and the closed landing
-- posture (RLS on; public/anon/authenticated nothing; service_role arwd
-- without truncate/references/trigger/maintain).
begin;

-- Fixtures: one admitted intake run to hang staging rows off.
insert into coldlion.sync_run (endpoint, company_code, request_params,
                               window_from, window_to, status, requested_by)
values ('/orderHistory', 'CT', '{"contract":"3679"}'::jsonb,
        date '2026-09-28', date '2026-10-02', 'succeeded',
        'coldlion-order-intake');

do $test$
declare
  v_run uuid := (select id from coldlion.sync_run
                  where requested_by = 'coldlion-order-intake'
                    and request_params->>'contract' = '3679');
  v_line uuid;
  v_component uuid;
begin
  -- 1. Sealed identity verbatim: same identity + same hash = one row.
  insert into coldlion.intake_order_line
    (company_code, sales_order_no, sales_order_line_no, master_item_no,
     division_code, customer_code, po_number, sales_person_code1,
     line_source_hash, first_seen_run, last_seen_run, fetched_at)
  values ('CT', 47001, 1, 'CT-ASSORT-1', 'CT1', 'CTCUST', '0001234567', 'ADAM',
          repeat('a', 64), v_run, v_run, now());
  begin
    insert into coldlion.intake_order_line
      (sales_order_no, sales_order_line_no, master_item_no,
       line_source_hash, first_seen_run, last_seen_run, fetched_at)
    values (47001, 1, 'CT-ASSORT-1', repeat('a', 64), v_run, v_run, now());
    raise exception 'duplicate identity + hash inserted a second row';
  exception when unique_violation then null;
  end;

  -- 2. A changed hash is a NEW VERSION, never a merge or a rewrite.
  insert into coldlion.intake_order_line
    (sales_order_no, sales_order_line_no, master_item_no,
     line_source_hash, first_seen_run, last_seen_run, fetched_at)
  values (47001, 1, 'CT-ASSORT-1', repeat('b', 64), v_run, v_run, now());
  if (select count(*) from coldlion.intake_order_line
       where sales_order_no = 47001) <> 2 then
    raise exception 'two projections of one line must be two version rows';
  end if;

  -- 3. EP001 exclusion: the sealed tables' exact nullable form — NULL passes,
  --    'EP001' is refused at the database, not just at ingestion.
  begin
    insert into coldlion.intake_order_line
      (sales_order_no, sales_order_line_no, master_item_no, division_code,
       line_source_hash, first_seen_run, last_seen_run, fetched_at)
    values (47002, 1, 'CT-ITEM-2', 'EP001',
            repeat('c', 64), v_run, v_run, now());
    raise exception 'EP001 division row was accepted by the staging table';
  exception when check_violation then null;
  end;

  -- 4. Component identity: one component per (line, sub_item, sub_label, hash);
  --    NULL sub_item (non-prepack single component) replays without duplicating.
  v_line := (select id from coldlion.intake_order_line
              where sales_order_no = 47001 and sales_order_line_no = 1
                and line_source_hash = repeat('a', 64));
  insert into coldlion.intake_order_component
    (line_id, sub_item_no, order_qty, component_source_hash,
     first_seen_run, last_seen_run, fetched_at)
  values (v_line, null, 12, repeat('d', 64), v_run, v_run, now());
  begin
    insert into coldlion.intake_order_component
      (line_id, sub_item_no, component_source_hash,
       first_seen_run, last_seen_run, fetched_at)
    values (v_line, null, repeat('d', 64), v_run, v_run, now());
    raise exception 'component identity allowed a duplicate NULL sub_item row';
  exception when unique_violation then null;
  end;
  v_component := (select id from coldlion.intake_order_component
                   where line_id = v_line);

  -- 5. Novelty queue: salesOrderNo = 0 can never mint a row here — it would
  --    collapse every such order onto COLDLION-SO-0 under the source-ref
  --    unique; the value is quarantined upstream instead.
  begin
    insert into coldlion.intake_new_order
      (sales_order_no, first_seen_run, warehouse_code)
    values (0, v_run, 'FOB');
    raise exception 'sales_order_no = 0 was accepted by the novelty queue';
  exception when check_violation then null;
  end;
  insert into coldlion.intake_new_order
    (sales_order_no, first_seen_run, warehouse_code)
  values (47001, v_run, 'DDPNJ');
  begin
    insert into coldlion.intake_new_order
      (sales_order_no, first_seen_run, warehouse_code)
    values (47001, v_run, 'FOB');
    raise exception 'novelty queue accepted the same sales order twice';
  exception when unique_violation then null;
  end;
  begin
    update coldlion.intake_new_order set state = 'teleported' where sales_order_no = 47001;
    raise exception 'novelty queue accepted an out-of-domain state';
  exception when check_violation then null;
  end;

  -- 6. Routing decode key: the map's PK refuses a second row per code, and the
  --    decode join is unambiguous (exactly one order_type/ship_to per code).
  begin
    insert into coldlion.routing_code_map
      (code, description, order_type, ship_to, is_poe_ddp_family)
    values ('FOB', 'FOB (imposter)', 'DDP', 'NJ', false);
    raise exception 'routing_code_map accepted a duplicate code';
  exception when unique_violation then null;
  end;
  if exists (
    select 1 from coldlion.routing_code_map m
    join coldlion.intake_new_order n on n.warehouse_code = m.code
    group by m.code having count(*) > 1
  ) then
    raise exception 'a routing code decodes to more than one map row';
  end if;
  if not exists (select 1 from coldlion.routing_code_map where code = 'DDPNJ'
                  and order_type = 'DDP' and ship_to = 'NJ') then
    raise exception 'the DDPNJ correction (ERP more correct than the sheet) is not seeded';
  end if;
  if (select count(*) from coldlion.routing_code_map) <> 16 then
    raise exception 'the observed 2026-09-17 routing vocabulary is not fully seeded';
  end if;

  -- 7. Quarantine is a visible row with a reason, keyed to its run.
  insert into coldlion.intake_quarantine
    (reason, sales_order_no, routing_code, detail, first_seen_run)
  values ('unknown-routing-code', 47003, 'ZZZ999',
          '{"warehouseCode":"ZZZ999"}'::jsonb, v_run);
  if not exists (select 1 from coldlion.intake_quarantine
                  where routing_code = 'ZZZ999' and reason = 'unknown-routing-code') then
    raise exception 'quarantine rows are not visible with their reason';
  end if;

  -- 8. Window state: one row per (track, from_date); pair + 7-day cap enforced.
  insert into coldlion.intake_window_state
    (track, from_date, to_date, last_run, rows_fetched, rows_staged, new_orders)
  values ('trailing', date '2026-09-25', date '2026-10-01', v_run, 135, 135, 1);
  begin
    insert into coldlion.intake_window_state (track, from_date, to_date)
    values ('trailing', date '2026-09-25', date '2026-09-30');
    raise exception 'window state accepted a duplicate (track, from_date)';
  exception when unique_violation then null;
  end;
  begin
    insert into coldlion.intake_window_state (track, from_date, to_date)
    values ('forward', date '2026-09-28', date '2026-10-10');
    raise exception 'window state accepted a window wider than 7 days inclusive';
  exception when check_violation then null;
  end;

  -- 9. Staging rows carry the run FKs (the one shared table).
  if (select first_seen_run from coldlion.intake_order_line where id = v_line) <> v_run
     or (select last_seen_run from coldlion.intake_order_component where id = v_component) <> v_run then
    raise exception 'staging rows do not carry their sync_run FKs';
  end if;
end;
$test$;

-- 10. Closed landing posture, asserted per table: RLS on; nothing for
--     public/anon/authenticated; service_role arwd WITHOUT
--     truncate/references/trigger/maintain (arwd alone cannot detect TRUNCATE,
--     which bypasses row triggers — the defect class 20260812020000 records).
do $access$
declare
  r record;
begin
  for r in
    select unnest(array['intake_window_state','intake_order_line',
                        'intake_order_component','intake_new_order',
                        'routing_code_map','intake_quarantine']) as relname
  loop
    if not (select relrowsecurity from pg_catalog.pg_class
             where oid = format('coldlion.%I', r.relname)::regclass) then
      raise exception 'RLS is not enabled on coldlion.%', r.relname;
    end if;
    if exists (
      select 1
      from (values ('public'), ('anon'), ('authenticated')) as roles(role)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as privs(privilege)
      where has_table_privilege(role, format('coldlion.%I', r.relname)::regclass, privilege)
    ) then
      raise exception 'coldlion.% holds a privilege for public/anon/authenticated', r.relname;
    end if;
    if not has_table_privilege('service_role', format('coldlion.%I', r.relname)::regclass,
                               'SELECT, INSERT, UPDATE, DELETE') then
      raise exception 'service_role lacks arwd on coldlion.%', r.relname;
    end if;
    if has_table_privilege('service_role', format('coldlion.%I', r.relname)::regclass, 'TRUNCATE')
       or has_table_privilege('service_role', format('coldlion.%I', r.relname)::regclass, 'REFERENCES')
       or has_table_privilege('service_role', format('coldlion.%I', r.relname)::regclass, 'TRIGGER')
       or has_table_privilege('service_role', format('coldlion.%I', r.relname)::regclass, 'MAINTAIN') then
      raise exception 'service_role holds truncate/references/trigger/maintain on coldlion.% — the append-only evidence posture forbids it', r.relname;
    end if;
  end loop;
end;
$access$;

rollback;
