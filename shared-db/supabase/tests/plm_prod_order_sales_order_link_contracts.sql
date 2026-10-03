-- #3869 contracts: plm.v_prod_order_sales_order_link links a production order only to
-- sales orders of the same customer, with a -120..+240 day window on the
-- PO-reference path. Synthetic rows only; the CI runner wraps this file in
-- begin/rollback.

do $$
declare
  v_run uuid;
  h_a integer;
  h_b integer;
  h_c integer;
  h_d integer;
  h_e integer;
  h_f integer;
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

  -- PO A: customer ZZCUSTA, reference ZZ3869A, ordered 2026-01-10.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate")
  values ('990386901', 'EDGEHOME', 'ZZCUSTA', 'ZZ3869A', '2026-01-10')
  returning id into h_a;
  -- PO B: blank PLM customer; ColdLion production history says ZZCUSTC.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate")
  values ('990386902', 'EDGEHOME', '', 'ZZ3869B', '2026-01-10')
  returning id into h_b;
  -- PO C: an invalid order date must not raise; it only disables the reference path.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate")
  values ('990386903', 'EDGEHOME', 'ZZCUSTA', 'ZZ3869A', '2026-02-30')
  returning id into h_c;

  -- PO D: no PLM customer and no ColdLion production history: never links.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate", "salesOrderNo")
  values ('990386904', 'EDGEHOME', null, 'ZZ3869A', '2026-01-10', '99386900')
  returning id into h_d;
  -- PO E: other company; the legacy header salesOrderNo links only with a customer match.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate", "salesOrderNo")
  values ('990386905', 'ZZOTHERCO', 'ZZCUSTA', 'ZZ3869A', '2026-01-10', '99386900')
  returning id into h_e;

  -- Sales-order lines carrying PO A's reference code.
  insert into coldlion.order_history_line(
    company_code, sales_order_no, sales_order_line_no, master_item_no, label_code,
    customer_code, prod_reference_no, start_date, cancel_date,
    line_source_hash, run_id, fetched_at)
  values
    -- same customer, inside the window: links
    ('EDGEHOME', 99386900, 1, 'ZZITEM', 'BC', 'ZZCUSTA', 'ZZ3869A', date '2026-02-01', date '2026-03-01', repeat('1', 64), v_run, now()),
    -- other customer, same reference: must not link
    ('EDGEHOME', 99386901, 1, 'ZZITEM', 'BC', 'ZZCUSTB', 'zz3869a', date '2026-02-01', date '2026-03-01', repeat('2', 64), v_run, now()),
    -- same customer, two years earlier (reused reference): must not link
    ('EDGEHOME', 99386902, 1, 'ZZITEM', 'BC', 'ZZCUSTA', 'ZZ3869A', date '2024-01-01', date '2024-02-01', repeat('3', 64), v_run, now()),
    -- sales order of PO B's ColdLion customer
    ('EDGEHOME', 99386904, 1, 'ZZITEM', 'BC', 'ZZCUSTC', 'OTHER', date '2026-02-01', date '2026-03-01', repeat('4', 64), v_run, now()),
    -- window boundaries for PO A (ordered 2026-01-10): -120 and +240 days link, -121 and +241 do not
    ('EDGEHOME', 99386910, 1, 'ZZITEM', 'BC', 'ZZCUSTA', 'ZZ3869A', date '2026-01-10' - 120, null, repeat('7', 64), v_run, now()),
    ('EDGEHOME', 99386911, 1, 'ZZITEM', 'BC', 'ZZCUSTA', 'ZZ3869A', date '2026-01-10' + 240, null, repeat('8', 64), v_run, now()),
    ('EDGEHOME', 99386912, 1, 'ZZITEM', 'BC', 'ZZCUSTA', 'ZZ3869A', date '2026-01-10' - 121, null, repeat('9', 64), v_run, now()),
    ('EDGEHOME', 99386913, 1, 'ZZITEM', 'BC', 'ZZCUSTA', 'ZZ3869A', date '2026-01-10' + 241, null, repeat('a', 64), v_run, now()),
    -- precedence: order lines say ZZCUSTB for 99386914, production history (below) says ZZCUSTA;
    -- the order-line customer wins, so PO A must not link to it
    ('EDGEHOME', 99386914, 1, 'ZZITEM', 'BC', 'ZZCUSTB', 'OTHER', date '2026-02-01', null, repeat('b', 64), v_run, now()),
    -- ColdLion-side padding: customer ' ZZCUSTA ' and reference ' zz3869a ' still link PO A
    ('EDGEHOME', 99386915, 1, 'ZZITEM', 'BC', ' ZZCUSTA ', ' zz3869a ', date '2026-02-02', null, repeat('f', 64), v_run, now());

  -- Production history: PO A names sales order 99386903 (no order lines exist for it,
  -- so its customer comes from production history); PO B names 99386904.
  insert into coldlion.prod_history_line
    (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
     customer_code, sales_order_no, source_observed_at, line_source_hash, run_id, fetched_at)
  values
    ('EDGEHOME', 990386901, 1, 'ISS', 'ISS', 'ZZCUSTA', 99386903, now(), repeat('5', 64), v_run, now()),
    ('EDGEHOME', 990386902, 1, 'ISS', 'ISS', 'ZZCUSTC', 99386904, now(), repeat('6', 64), v_run, now()),
    ('EDGEHOME', 990386901, 2, 'ISS', 'ISS', 'ZZCUSTA', 99386914, now(), repeat('c', 64), v_run, now()),
    -- PO C (invalid date) still links through production history
    ('EDGEHOME', 990386903, 1, 'ISS', 'ISS', 'ZZCUSTA', 99386903, now(), repeat('d', 64), v_run, now()),
    -- PO A: production history also names 99386910, which the reference path links too
    ('EDGEHOME', 990386901, 3, 'ISS', 'ISS', 'ZZCUSTA', 99386910, now(), repeat('e', 64), v_run, now());

  -- PO F: the legacy PLM header names a same-customer sales order; nothing else links it.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate", "salesOrderNo")
  values ('990386906', 'EDGEHOME', ' ZZCUSTC ', null, '2026-01-10', '99386904')
  returning id into h_f;

  if (select array_agg(sales_order_no order by sales_order_no)
        from plm.v_prod_order_sales_order_link where prod_order_header_id = h_a)
     is distinct from array[99386900, 99386903, 99386910, 99386911, 99386915]::bigint[] then
    raise exception 'PO A must link exactly to its same-customer, in-window (inclusive -120..+240) sales orders, never to an order-line customer that differs: %',
      (select array_agg(sales_order_no order by sales_order_no)
         from plm.v_prod_order_sales_order_link where prod_order_header_id = h_a);
  end if;

  if (select sales_order_start_date from plm.v_prod_order_sales_order_link
       where prod_order_header_id = h_a and sales_order_no = 99386900) <> date '2026-02-01' then
    raise exception 'the sales-order start date (the promise) must be exposed';
  end if;

  if (select array_agg(sales_order_no)
        from plm.v_prod_order_sales_order_link where prod_order_header_id = h_b)
     is distinct from array[99386904]::bigint[] then
    raise exception 'a blank PLM customer must fall back to the ColdLion PO customer';
  end if;

  -- Multi-source aggregation: 99386900 is asserted by the reference path; the
  -- production-history pair 99386903 by production history only.
  if (select array_agg(array_to_string(link_sources, '+') || ':' || source_count order by sales_order_no)
        from plm.v_prod_order_sales_order_link
       where prod_order_header_id = h_a and sales_order_no in (99386900, 99386903))
     is distinct from array['order_history_line:1', 'prod_history_line:1'] then
    raise exception 'link_sources/source_count must name the asserting sources';
  end if;

  -- Two sources agreeing on one pair: one row, both sources named, count 2.
  if (select array_to_string(link_sources, '+') || ':' || source_count
        from plm.v_prod_order_sales_order_link
       where prod_order_header_id = h_a and sales_order_no = 99386910)
     is distinct from 'order_history_line+prod_history_line:2' then
    raise exception 'a pair asserted by two sources must appear once with both sources';
  end if;

  -- Legacy header source with a matching (trimmed) customer links, with its fields.
  if (select array_to_string(link_sources, '+') || ':' || source_count || ':' ||
             coalesce(latest_fetched_at::text, 'null') || ':' || sales_order_start_date || ':' ||
             sales_order_cancel_date || ':' || sales_order_start_date_ever_changed
        from plm.v_prod_order_sales_order_link
       where prod_order_header_id = h_f and sales_order_no = 99386904)
     is distinct from 'prod_order_header:1:null:2026-02-01:2026-03-01:false' then
    raise exception 'the legacy header source must link a same-customer sales order with its dates';
  end if;

  -- No customer anywhere: never links, even with a matching reference and header SO.
  if exists (select 1 from plm.v_prod_order_sales_order_link where prod_order_header_id = h_d) then
    raise exception 'a PO with no customer must not link';
  end if;

  -- Company mismatch: ColdLion rows are EDGEHOME, PO E is ZZOTHERCO; nothing links.
  if exists (select 1 from plm.v_prod_order_sales_order_link where prod_order_header_id = h_e) then
    raise exception 'a PO must not link across companies';
  end if;

  -- An invalid order date disables only the reference path: PO C keeps its
  -- production-history link and gains no reference-code link.
  if (select array_agg(sales_order_no || ':' || array_to_string(link_sources, '+'))
        from plm.v_prod_order_sales_order_link where prod_order_header_id = h_c)
     is distinct from array['99386903:prod_history_line'] then
    raise exception 'an invalid order date must disable only the reference path';
  end if;
end $$;
