-- #4268: bounded, authenticated OrderList Sales Order received-date reader.
-- Synthetic fixture only. Run in the isolated so_date_test database; everything rolls back.
begin;

do $fixture$
declare
  v_run uuid;
  v_order_a uuid;
  v_order_b uuid;
begin
  insert into coldlion.sync_run (endpoint, company_code, requested_by)
  values ('/orderHistory', 'EDGEHOME', 'popdam_sales_order_received_dates_contract')
  returning id into v_run;

  insert into plm.production_order
    (id, production_order_number, status, source_system, source_id)
  values
    ('42680000-0000-4000-8000-000000000001', 'ZZ-SO-DATE-PO-A', 'Open', 'so_date_test', 'header-a')
  returning id into v_order_a;

  insert into plm.production_order
    (id, production_order_number, status, source_system, source_id)
  values
    ('42680000-0000-4000-8000-000000000002', 'ZZ-SO-DATE-PO-B', 'Open', 'so_date_test', 'header-b')
  returning id into v_order_b;

  -- Two headers share one customer PO but point to different exact ColdLion SO refs.
  insert into plm.production_order_line
    (id, production_order_id, line_number, customer_po_number, sku, quantity_ordered, source_system, source_id)
  values
    ('42680000-0000-4000-8000-000000000101', v_order_a, '1', 'ZZ-SHARED-PO', 'ZZ-SKU-A', 1, 'so_date_test', 'line-a'),
    ('42680000-0000-4000-8000-000000000102', v_order_b, '1', 'ZZ-SHARED-PO', 'ZZ-SKU-B', 1, 'so_date_test', 'line-b'),
    ('42680000-0000-4000-8000-000000000103', v_order_a, '2', 'ZZ-SHARED-PO', 'ZZ-SKU-C', 1, 'so_date_test', 'line-duplicate'),
    ('42680000-0000-4000-8000-000000000104', v_order_a, '3', 'ZZ-SHARED-PO', 'ZZ-SKU-D', 1, 'so_date_test', 'line-missing-stamp'),
    ('42680000-0000-4000-8000-000000000105', v_order_a, '4', 'ZZ-SHARED-PO', 'ZZ-SKU-E', 1, 'so_date_test', 'line-conflict'),
    ('42680000-0000-4000-8000-000000000106', v_order_a, '5', 'ZZ-SHARED-PO', 'ZZ-SKU-F', 1, 'so_date_test', 'line-wrong-company'),
    ('42680000-0000-4000-8000-000000000107', v_order_a, '6', 'ZZ-SHARED-PO', 'ZZ-SKU-G', 1, 'so_date_test', 'line-malformed'),
    ('42680000-0000-4000-8000-000000000108', v_order_a, '7', 'ZZ-SHARED-PO', 'ZZ-SKU-H', 1, 'so_date_test', 'line-overflow'),
    ('42680000-0000-4000-8000-000000000109', v_order_a, '8', 'ZZ-SHARED-PO', 'ZZ-SKU-I', 1, 'so_date_test', 'line-no-coldlion-ref'),
    ('42680000-0000-4000-8000-000000000110', v_order_a, '9', 'ZZ-SHARED-PO', 'ZZ-SKU-J', 1, 'so_date_test', 'line-header-ref'),
    ('42680000-0000-4000-8000-000000000111', v_order_a, '10', 'ZZ-SHARED-PO', 'ZZ-SKU-K', 1, 'so_date_test', 'line-fall-back'),
    ('42680000-0000-4000-8000-000000000112', v_order_a, '11', 'ZZ-SHARED-PO', 'ZZ-SKU-L', 1, 'so_date_test', 'line-unknown-so');

  insert into plm.production_order_line_source_ref
    (production_order_line_id, source_system, source_id, is_primary)
  values
    ('42680000-0000-4000-8000-000000000101', 'coldlion', 'coldlion:so:42680001:line:1:component:1', true),
    -- A second same-system ref must not displace the primary SO identity.
    ('42680000-0000-4000-8000-000000000101', 'coldlion', 'coldlion:so:42680009:line:1:component:1', false),
    ('42680000-0000-4000-8000-000000000102', 'coldlion', 'coldlion:so:42680002:line:1:component:1', true),
    ('42680000-0000-4000-8000-000000000103', 'coldlion', 'coldlion:so:42680001:line:2:component:1', true),
    ('42680000-0000-4000-8000-000000000104', 'coldlion', 'coldlion:so:42680004:line:1:component:1', true),
    ('42680000-0000-4000-8000-000000000105', 'coldlion', 'coldlion:so:42680005:line:1:component:1', true),
    ('42680000-0000-4000-8000-000000000106', 'coldlion', 'coldlion:so:42680006:line:1:component:1', true),
    ('42680000-0000-4000-8000-000000000107', 'coldlion', 'coldlion:so:not-a-number:line:1:component:1', true),
    ('42680000-0000-4000-8000-000000000108', 'coldlion', 'coldlion:so:9999999999999999999:line:1:component:1', true),
    ('42680000-0000-4000-8000-000000000110', 'coldlion', 'coldlion:so-header:42680001', true),
    ('42680000-0000-4000-8000-000000000111', 'coldlion', 'coldlion:so:42680007:line:1:component:1', true),
    ('42680000-0000-4000-8000-000000000112', 'coldlion', 'coldlion:so:42680008:line:1:component:1', true);

  insert into coldlion.order_history_line
    (company_code, sales_order_no, sales_order_line_no, master_item_no, created_time,
     line_source_hash, run_id, fetched_at)
  values
    -- UTC values straddle the New York spring-forward boundary: dates are Mar 7 and Mar 8.
    ('EDGEHOME', 42680001, 1, 'ZZ-SKU-A', timestamptz '2026-03-08 04:30:00+00', repeat('a',64), v_run, now()),
    ('EDGEHOME', 42680002, 1, 'ZZ-SKU-B', timestamptz '2026-03-08 07:30:00+00', repeat('b',64), v_run, now()),
    -- Different date than line 101's primary ref; this belongs only to its non-primary ref.
    ('EDGEHOME', 42680009, 1, 'ZZ-SKU-A-ALTERNATE', timestamptz '2026-04-10 12:00:00+00', repeat('9',64), v_run, now()),
    -- One known stamp plus one missing version must abstain.
    ('EDGEHOME', 42680004, 1, 'ZZ-SKU-D1', timestamptz '2026-04-01 12:00:00+00', repeat('c',64), v_run, now()),
    ('EDGEHOME', 42680004, 2, 'ZZ-SKU-D2', null,                                  repeat('d',64), v_run, now()),
    -- Conflicting non-null order-level stamps must abstain.
    ('EDGEHOME', 42680005, 1, 'ZZ-SKU-E1', timestamptz '2026-04-01 12:00:00+00', repeat('e',64), v_run, now()),
    ('EDGEHOME', 42680005, 2, 'ZZ-SKU-E2', timestamptz '2026-04-02 12:00:00+00', repeat('f',64), v_run, now()),
    -- Same number under another company must never satisfy EDGEHOME.
    ('OTHERCO', 42680006, 1, 'ZZ-SKU-F', timestamptz '2026-04-03 12:00:00+00', repeat('1',64), v_run, now()),
    -- Fall-back transition remains a local Nov 1 date.
    ('EDGEHOME', 42680007, 1, 'ZZ-SKU-K', timestamptz '2026-11-01 05:30:00+00', repeat('2',64), v_run, now());
end
$fixture$;

-- The function must not alter any fixture rows. Capture complete fixture-row images before calls.
create temporary table _so_date_before_history on commit drop as
  select to_jsonb(h) as row_image from coldlion.order_history_line h
  where h.run_id = (select id from coldlion.sync_run where requested_by = 'popdam_sales_order_received_dates_contract');
create temporary table _so_date_before_orders on commit drop as
  select to_jsonb(o) as row_image from plm.production_order o where o.source_system = 'so_date_test';
create temporary table _so_date_before_lines on commit drop as
  select to_jsonb(l) as row_image from plm.production_order_line l where l.source_system = 'so_date_test';
create temporary table _so_date_before_refs on commit drop as
  select to_jsonb(r) as row_image from plm.production_order_line_source_ref r
  where r.production_order_line_id in (select l.id from plm.production_order_line l where l.source_system = 'so_date_test');

do $acl$
begin
  if has_function_privilege('anon', 'public.get_dam_order_sales_order_dates(uuid[])', 'execute') then
    raise exception 'FAIL: anon can execute the SO-date reader';
  end if;
  if not has_function_privilege('authenticated', 'public.get_dam_order_sales_order_dates(uuid[])', 'execute') then
    raise exception 'FAIL: authenticated cannot execute the SO-date reader';
  end if;
  if has_table_privilege('anon', 'coldlion.order_history_line', 'select')
     or has_table_privilege('authenticated', 'coldlion.order_history_line', 'select') then
    raise exception 'FAIL: an application role can read raw ColdLion history';
  end if;
end
$acl$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"42680000-0000-4000-8000-000000000900","role":"authenticated"}', true);

do $authenticated$
declare
  v_date date;
  v_count integer;
begin
  -- Exact references, duplicate UUID collapse, and same-PO headers retain their own SO dates.
  select count(*) into v_count
  from public.get_dam_order_sales_order_dates(array[
    '42680000-0000-4000-8000-000000000101'::uuid,
    '42680000-0000-4000-8000-000000000101'::uuid
  ]);
  if v_count <> 1 then raise exception 'FAIL: duplicate UUID produced % rows, expected one', v_count; end if;

  select sales_order_date into v_date from public.get_dam_order_sales_order_dates(array['42680000-0000-4000-8000-000000000101'::uuid]);
  if v_date is distinct from date '2026-03-07' then raise exception 'FAIL: pre-DST New York date was %', v_date; end if;
  select sales_order_date into v_date from public.get_dam_order_sales_order_dates(array['42680000-0000-4000-8000-000000000102'::uuid]);
  if v_date is distinct from date '2026-03-08' then raise exception 'FAIL: post-DST New York date was %', v_date; end if;
  select sales_order_date into v_date from public.get_dam_order_sales_order_dates(array['42680000-0000-4000-8000-000000000111'::uuid]);
  if v_date is distinct from date '2026-11-01' then raise exception 'FAIL: fall-back New York date was %', v_date; end if;
  select sales_order_date into v_date from public.get_dam_order_sales_order_dates(array['42680000-0000-4000-8000-000000000112'::uuid]);
  if v_date is not null then raise exception 'FAIL: unknown exact ColdLion SO invented date %', v_date; end if;

  -- Missing and conflicting versions, wrong company, malformed/overflow/header refs, and no ref abstain.
  foreach v_count in array array[104,105,106,107,108,109,110] loop
    select sales_order_date into v_date
    from public.get_dam_order_sales_order_dates(array[('42680000-0000-4000-8000-000000000' || lpad(v_count::text,3,'0'))::uuid]);
    if v_date is not null then raise exception 'FAIL: case line % invented a date %', v_count, v_date; end if;
  end loop;

  select count(*) into v_count from public.get_dam_order_sales_order_dates(array[]::uuid[]);
  if v_count <> 0 then raise exception 'FAIL: empty input returned % rows', v_count; end if;
  select count(*) into v_count from public.get_dam_order_sales_order_dates(array['42680000-0000-4000-8000-000000009999'::uuid]);
  if v_count <> 0 then raise exception 'FAIL: unknown line returned % rows', v_count; end if;

  begin
    perform * from public.get_dam_order_sales_order_dates(null::uuid[]);
    raise exception 'FAIL: NULL array was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform * from public.get_dam_order_sales_order_dates(array_fill(gen_random_uuid(), array[1501]));
    raise exception 'FAIL: 1501 IDs were accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform * from public.get_dam_order_sales_order_dates(array['42680000-0000-4000-8000-000000000101'::uuid, null::uuid]);
    raise exception 'FAIL: NULL element was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- The caller may invoke the narrow reader but still cannot read its raw source table.
  begin
    perform 1 from coldlion.order_history_line limit 1;
    raise exception 'FAIL: authenticated read raw ColdLion history';
  exception when insufficient_privilege then null;
  end;
end
$authenticated$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
set local role authenticated;
do $unauthenticated$
begin
  begin
    perform * from public.get_dam_order_sales_order_dates(array['42680000-0000-4000-8000-000000000101'::uuid]);
    raise exception 'FAIL: missing auth.uid was accepted';
  exception when insufficient_privilege then null;
  end;
end
$unauthenticated$;
reset role;

set local role anon;
do $anonymous$
begin
  begin
    perform * from public.get_dam_order_sales_order_dates(array['42680000-0000-4000-8000-000000000101'::uuid]);
    raise exception 'FAIL: anon executed the SO-date reader';
  exception when insufficient_privilege then null;
  end;
end
$anonymous$;
reset role;

do $unchanged$
begin
  if exists (
    (select row_image from _so_date_before_history except all
     select to_jsonb(h) from coldlion.order_history_line h
     where h.run_id = (select id from coldlion.sync_run where requested_by = 'popdam_sales_order_received_dates_contract'))
    union all
    (select to_jsonb(h) from coldlion.order_history_line h
     where h.run_id = (select id from coldlion.sync_run where requested_by = 'popdam_sales_order_received_dates_contract')
     except all select row_image from _so_date_before_history)
  ) then raise exception 'FAIL: reader changed ColdLion source rows'; end if;
  if exists (
    (select row_image from _so_date_before_orders except all select to_jsonb(o) from plm.production_order o where o.source_system='so_date_test')
    union all
    (select to_jsonb(o) from plm.production_order o where o.source_system='so_date_test' except all select row_image from _so_date_before_orders)
  ) then raise exception 'FAIL: reader changed OrderList headers'; end if;
  if exists (
    (select row_image from _so_date_before_lines except all select to_jsonb(l) from plm.production_order_line l where l.source_system='so_date_test')
    union all
    (select to_jsonb(l) from plm.production_order_line l where l.source_system='so_date_test' except all select row_image from _so_date_before_lines)
  ) then raise exception 'FAIL: reader changed OrderList lines'; end if;
  if exists (
    (select row_image from _so_date_before_refs except all select to_jsonb(r) from plm.production_order_line_source_ref r
     where r.production_order_line_id in (select l.id from plm.production_order_line l where l.source_system='so_date_test'))
    union all
    (select to_jsonb(r) from plm.production_order_line_source_ref r
     where r.production_order_line_id in (select l.id from plm.production_order_line l where l.source_system='so_date_test')
     except all select row_image from _so_date_before_refs)
  ) then raise exception 'FAIL: reader changed source references'; end if;
  raise notice 'PASS: SO received-date reader synthetic contract checks';
end
$unchanged$;

rollback;
