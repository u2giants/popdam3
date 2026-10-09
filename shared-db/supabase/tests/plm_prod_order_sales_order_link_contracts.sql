-- #3869 generation 7 contracts: plm.v_prod_order_sales_order_link links on the
-- CUSTOMER PO NUMBER, never on a sales-order number (owner rule 2026-10-09).
-- Primary: prod_history_line.cust_po_number = order_history_line.po_number (trimmed,
-- upper-cased, leading zeros stripped), same company and customer (MOD011 = MOD010).
-- Fallback, only for a PO with no customer-PO pair: ColdLion D-number on same-customer
-- sales orders entered in ColdLion within the window around the PO created time.
-- Synthetic rows only; the CI runner wraps this file in begin/rollback.

do $$
declare
  v_run uuid;
  h_a integer;
  h_b integer;
  h_c integer;
  h_d integer;
  h_e integer;
  v_po_created timestamptz := timestamptz '2026-01-10 12:00:00+00';
begin
  if to_regclass('plm.v_prod_order_sales_order_link') is null then
    raise exception 'plm.v_prod_order_sales_order_link is missing';
  end if;
  if has_table_privilege('anon', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('authenticated', 'plm.v_prod_order_sales_order_link', 'select')
     or has_table_privilege('service_role', 'plm.v_prod_order_sales_order_link', 'select') then
    raise exception 'anon, authenticated and service_role must have no access';
  end if;

  insert into coldlion.sync_run (endpoint, requested_by, status, started_at)
  values ('/orderHistory', 'issue-3869-contract', 'running', now())
  returning id into v_run;

  -- PO A: customer PO 009212870 on its ColdLion history; production history also
  -- names sales order 99386999, which must NOT link (no sales-order number key).
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate", "createdTime", "salesOrderNo")
  values ('990386901', 'EDGEHOME', 'ZZCUSTA', 'ZZTYPO', '2026-01-10', v_po_created, '99386998')
  returning id into h_a;
  -- PO B: no customer PO; ColdLion D-number ZZ3869B, customer MOD011 (= MOD010).
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate", "createdTime")
  values ('990386902', 'EDGEHOME', 'MOD011', 'ZZ3869X', '2026-01-10', v_po_created)
  returning id into h_b;
  -- PO C: no ColdLion production history; its legacy header salesOrderNo must not link.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate", "salesOrderNo")
  values ('990386903', 'EDGEHOME', 'ZZCUSTA', 'ZZ3869A', '2026-01-10', '99386930')
  returning id into h_c;
  -- PO D: other company; ColdLion rows for its number are EDGEHOME. Never links.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate", "createdTime")
  values ('990386904', 'ZZOTHERCO', 'ZZCUSTA', 'ZZ3869A', '2026-01-10', v_po_created)
  returning id into h_d;
  -- PO E: no customer PO, ColdLion history names two customers: no fallback pairs.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate", "createdTime")
  values ('990386905', 'EDGEHOME', 'ZZCUSTA', 'ZZ3869E', '2026-01-10', v_po_created)
  returning id into h_e;

  insert into coldlion.order_history_line(
    company_code, sales_order_no, sales_order_line_no, master_item_no, label_code,
    customer_code, po_number, prod_reference_no, start_date, cancel_date, created_time,
    line_source_hash, run_id, fetched_at)
  values
    -- PO A: same customer PO (unpadded, padded) -> link; one also carries PO A's D-number
    ('EDGEHOME', 99386910, 1, 'ZZITEM', 'BC', 'ZZCUSTA', ' 9212870 ', 'ZZ3869A', date '2026-02-01', date '2026-03-01', v_po_created - interval '30 days', repeat('1', 64), v_run, now()),
    ('EDGEHOME', 99386911, 1, 'ZZITEM', 'BC', 'ZZCUSTA', '0009212870', 'OTHER',  date '2026-02-02', null,             null,                              repeat('2', 64), v_run, now()),
    -- PO A's customer PO under another customer: no link
    ('EDGEHOME', 99386912, 1, 'ZZITEM', 'BC', 'ZZCUSTB', '9212870',    'OTHER',  date '2026-02-01', null,             null,                              repeat('3', 64), v_run, now()),
    -- PO A's D-number, same customer, other customer PO: PO A has customer-PO pairs, no link
    ('EDGEHOME', 99386913, 1, 'ZZITEM', 'BC', 'ZZCUSTA', '1111',       'ZZ3869A', date '2026-02-01', null,            v_po_created - interval '1 day',   repeat('4', 64), v_run, now()),
    -- PO A's header salesOrderNo, same customer, PO A's D-number: must NOT link
    ('EDGEHOME', 99386998, 1, 'ZZITEM', 'BC', 'ZZCUSTA', '3333',       'ZZ3869A', date '2026-02-01', null,            v_po_created - interval '2 days',  repeat('d', 64), v_run, now()),
    -- the sales order production history names for PO A: must NOT link
    ('EDGEHOME', 99386999, 1, 'ZZITEM', 'BC', 'ZZCUSTA', '2222',       'OTHER',  date '2026-02-01', null,             null,                              repeat('5', 64), v_run, now()),
    -- PO B fallback: MOD010 line, entered 10 days before the PO -> links
    ('EDGEHOME', 99386920, 1, 'ZZITEM', 'BC', ' MOD010 ', null, ' zz3869b ', date '2026-02-01', date '2026-03-01', v_po_created - interval '10 days', repeat('6', 64), v_run, now()),
    -- PO B fallback, other customer: no link
    ('EDGEHOME', 99386921, 1, 'ZZITEM', 'BC', 'ZZCUSTB', null, 'ZZ3869B', date '2026-02-01', null, v_po_created - interval '10 days', repeat('7', 64), v_run, now()),
    -- PO B fallback, entered years before the PO: outside the window, no link
    ('EDGEHOME', 99386922, 1, 'ZZITEM', 'BC', 'MOD011', null, 'ZZ3869B', date '2023-01-01', null, v_po_created - interval '1100 days', repeat('8', 64), v_run, now()),
    -- PO B fallback, entered long after the PO: outside the window, no link
    ('EDGEHOME', 99386923, 1, 'ZZITEM', 'BC', 'MOD011', null, 'ZZ3869B', date '2027-06-01', null, v_po_created + interval '400 days', repeat('9', 64), v_run, now()),
    -- PO B fallback, no entry time known: no link
    ('EDGEHOME', 99386924, 1, 'ZZITEM', 'BC', 'MOD011', null, 'ZZ3869B', date '2026-02-01', null, null, repeat('a', 64), v_run, now()),
    -- PO C's legacy header sales order (and PO C's PLM reference): no link
    ('EDGEHOME', 99386930, 1, 'ZZITEM', 'BC', 'ZZCUSTA', null, 'ZZ3869A', date '2026-02-01', null, v_po_created - interval '1 day', repeat('b', 64), v_run, now()),
    -- PO E's D-number, one of its two customers: no link
    ('EDGEHOME', 99386950, 1, 'ZZITEM', 'BC', 'ZZCUSTA', null, 'ZZ3869E', date '2026-02-01', null, v_po_created - interval '1 day', repeat('c', 64), v_run, now());

  insert into coldlion.prod_history_line
    (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
     customer_code, sales_order_no, prod_reference_no, cust_po_number, source_observed_at,
     line_source_hash, run_id, fetched_at)
  values
    ('EDGEHOME', 990386901, 1, 'ISS', 'ISS', 'ZZCUSTA', 99386999, 'ZZ3869A', '009212870', now(), repeat('a', 64), v_run, now()),
    ('EDGEHOME', 990386902, 1, 'ISS', 'ISS', 'MOD011',  99386921, ' zz3869b ', '  ',      now(), repeat('b', 64), v_run, now()),
    ('EDGEHOME', 990386904, 1, 'ISS', 'ISS', 'ZZCUSTA', 0,        'ZZ3869A', '9212870',    now(), repeat('d', 64), v_run, now()),
    ('EDGEHOME', 990386905, 1, 'ISS', 'ISS', 'ZZCUSTA', 0,        'ZZ3869E', null,         now(), repeat('e', 64), v_run, now()),
    ('EDGEHOME', 990386905, 2, 'ISS', 'ISS', 'ZZCUSTB', 0,        'ZZ3869E', null,         now(), repeat('f', 64), v_run, now());

  if (select array_agg(sales_order_no || ':' || array_to_string(link_sources, '+') || ':' || source_count
                       order by sales_order_no)
        from plm.v_prod_order_sales_order_link where prod_order_header_id = h_a)
     is distinct from array['99386910:customer_po+prod_reference_no:2',
                            '99386911:customer_po:1'] then
    raise exception 'PO A must link by customer PO only (D-number corroborates): %',
      (select array_agg(sales_order_no || ':' || array_to_string(link_sources, '+') order by sales_order_no)
         from plm.v_prod_order_sales_order_link where prod_order_header_id = h_a);
  end if;

  if (select sales_order_start_date from plm.v_prod_order_sales_order_link
       where prod_order_header_id = h_a and sales_order_no = 99386910) <> date '2026-02-01' then
    raise exception 'the sales-order start date (the promise) must be exposed';
  end if;

  if (select array_agg(array_to_string(link_sources, '+') || ':' || source_count || ':' ||
             (latest_fetched_at is not null) || ':' || sales_order_no || ':' ||
             sales_order_start_date || ':' || sales_order_start_date_max || ':' ||
             sales_order_cancel_date || ':' || sales_order_start_date_ever_changed)
        from plm.v_prod_order_sales_order_link where prod_order_header_id = h_b)
     is distinct from array['prod_reference_no:1:true:99386920:2026-02-01:2026-02-01:2026-03-01:false'] then
    raise exception 'PO B must fall back to its ColdLion D-number, same customer (MOD011 = MOD010), entered within the window, never by sales-order number: %',
      (select array_agg(sales_order_no order by sales_order_no)
         from plm.v_prod_order_sales_order_link where prod_order_header_id = h_b);
  end if;

  if exists (select 1 from plm.v_prod_order_sales_order_link where prod_order_header_id = h_c) then
    raise exception 'a PO without ColdLion history must not link through its header sales-order number';
  end if;

  if exists (select 1 from plm.v_prod_order_sales_order_link where prod_order_header_id = h_d) then
    raise exception 'a PO must not link across companies';
  end if;

  if exists (select 1 from plm.v_prod_order_sales_order_link where prod_order_header_id = h_e) then
    raise exception 'a PO whose ColdLion history names several customers must take no fallback pairs';
  end if;
end $$;
