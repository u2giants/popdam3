-- #3869 / claim #3969 contracts: plm.v_prod_order_sales_order_link links on
-- ColdLion's own numbers. Production-history pairs are authoritative; only a PO
-- with none falls back to ColdLion's own D-number for the PO on sales-order lines
-- of the same customer (MOD011 read as MOD010); PLM prodReferenceNo is never used.
-- Synthetic rows only; the CI runner wraps this file in begin/rollback.

do $$
declare
  v_run uuid;
  h_a integer;
  h_b integer;
  h_c integer;
  h_d integer;
  h_e integer;
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
  values ('/orderHistory', 'issue-3969-contract', 'running', now())
  returning id into v_run;

  -- PO A: PLM reference is a typo (ZZTYPO); ColdLion says ZZ3969A. Direct pairs exist.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate")
  values ('990396901', 'EDGEHOME', 'ZZCUSTA', 'ZZTYPO', '2026-01-10')
  returning id into h_a;
  -- PO B: no direct pair; ColdLion D-number ZZ3969B, customer MOD011 (= MOD010).
  -- Its PLM reference ZZ3969X must be ignored.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate")
  values ('990396902', 'EDGEHOME', 'MOD011', 'ZZ3969X', '2026-01-10')
  returning id into h_b;
  -- PO C: no ColdLion production history. Its PLM reference matches order lines
  -- (must not link); its legacy header salesOrderNo is same-customer (links).
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate", "salesOrderNo")
  values ('990396903', 'EDGEHOME', ' ZZCUSTC ', 'ZZ3969A', '2026-01-10', '99396930')
  returning id into h_c;
  -- PO D: other company; ColdLion rows for its number are EDGEHOME. Never links.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate")
  values ('990396904', 'ZZOTHERCO', 'ZZCUSTA', 'ZZ3969A', '2026-01-10')
  returning id into h_d;
  -- PO E: ColdLion history names two customers; no fallback pairs.
  insert into plm."ProdOrderHeader"("prodOrderNo", "companyCode", "customerCode",
                                    "prodReferenceNo", "prodOrderDate")
  values ('990396905', 'EDGEHOME', 'ZZCUSTA', 'ZZ3969E', '2026-01-10')
  returning id into h_e;

  insert into coldlion.order_history_line(
    company_code, sales_order_no, sales_order_line_no, master_item_no, label_code,
    customer_code, prod_reference_no, start_date, cancel_date,
    line_source_hash, run_id, fetched_at)
  values
    -- PO A's D-number on a direct-pair sales order: corroborates it
    ('EDGEHOME', 99396910, 1, 'ZZITEM', 'BC', 'ZZCUSTA', 'ZZ3969A', date '2026-02-01', date '2026-03-01', repeat('1', 64), v_run, now()),
    -- PO A's D-number, same customer, no direct pair: PO A has direct pairs, so no link
    ('EDGEHOME', 99396900, 1, 'ZZITEM', 'BC', 'ZZCUSTA', 'ZZ3969A', date '2026-02-01', null, repeat('2', 64), v_run, now()),
    -- PO B fallback: MOD010 line with padding and other case links (alias MOD011 -> MOD010)
    ('EDGEHOME', 99396920, 1, 'ZZITEM', 'BC', ' MOD010 ', ' zz3969b ', date '2026-02-01', date '2026-03-01', repeat('3', 64), v_run, now()),
    -- PO B fallback, other customer: no link
    ('EDGEHOME', 99396921, 1, 'ZZITEM', 'BC', 'ZZCUSTB', 'ZZ3969B', date '2026-02-01', null, repeat('4', 64), v_run, now()),
    -- PO B fallback, years away: links (no date guard; D-numbers are not reused)
    ('EDGEHOME', 99396922, 1, 'ZZITEM', 'BC', 'MOD011', 'ZZ3969B', date '2019-01-01', null, repeat('5', 64), v_run, now()),
    -- PO B's PLM reference: must not link
    ('EDGEHOME', 99396923, 1, 'ZZITEM', 'BC', 'MOD011', 'ZZ3969X', date '2026-02-01', null, repeat('6', 64), v_run, now()),
    -- PO C's legacy header sales order
    ('EDGEHOME', 99396930, 1, 'ZZITEM', 'BC', 'ZZCUSTC', 'OTHER', date '2026-02-01', date '2026-03-01', repeat('7', 64), v_run, now()),
    -- PO E's D-number, one of its two customers: no link
    ('EDGEHOME', 99396950, 1, 'ZZITEM', 'BC', 'ZZCUSTA', 'ZZ3969E', date '2026-02-01', null, repeat('8', 64), v_run, now());

  insert into coldlion.prod_history_line
    (company_code, prod_order_no, prod_line_seq, requested_stage_code, stage_code,
     customer_code, sales_order_no, prod_reference_no, source_observed_at, line_source_hash, run_id, fetched_at)
  values
    -- PO A direct pairs (99396903 has no order lines at all)
    ('EDGEHOME', 990396901, 1, 'ISS', 'ISS', 'ZZCUSTA', 99396903, 'ZZ3969A', now(), repeat('a', 64), v_run, now()),
    ('EDGEHOME', 990396901, 2, 'ISS', 'ISS', 'ZZCUSTA', 99396910, 'ZZ3969A', now(), repeat('b', 64), v_run, now()),
    -- PO B: history with no sales order
    ('EDGEHOME', 990396902, 1, 'ISS', 'ISS', 'MOD011', 0, ' zz3969b ', now(), repeat('c', 64), v_run, now()),
    -- PO D's number under EDGEHOME
    ('EDGEHOME', 990396904, 1, 'ISS', 'ISS', 'ZZCUSTA', 99396903, 'ZZ3969A', now(), repeat('d', 64), v_run, now()),
    -- PO E: two customers
    ('EDGEHOME', 990396905, 1, 'ISS', 'ISS', 'ZZCUSTA', 0, 'ZZ3969E', now(), repeat('e', 64), v_run, now()),
    ('EDGEHOME', 990396905, 2, 'ISS', 'ISS', 'ZZCUSTB', 0, 'ZZ3969E', now(), repeat('f', 64), v_run, now());

  if (select array_agg(sales_order_no || ':' || array_to_string(link_sources, '+') || ':' || source_count
                       order by sales_order_no)
        from plm.v_prod_order_sales_order_link where prod_order_header_id = h_a)
     is distinct from array['99396903:prod_history_line:1',
                            '99396910:order_history_line+prod_history_line:2'] then
    raise exception 'PO A must link exactly to its production-history pairs, corroborated by its ColdLion D-number: %',
      (select array_agg(sales_order_no order by sales_order_no)
         from plm.v_prod_order_sales_order_link where prod_order_header_id = h_a);
  end if;

  if (select sales_order_start_date from plm.v_prod_order_sales_order_link
       where prod_order_header_id = h_a and sales_order_no = 99396910) <> date '2026-02-01' then
    raise exception 'the sales-order start date (the promise) must be exposed';
  end if;

  if (select array_agg(sales_order_no || ':' || array_to_string(link_sources, '+') order by sales_order_no)
        from plm.v_prod_order_sales_order_link where prod_order_header_id = h_b)
     is distinct from array['99396920:order_history_line', '99396922:order_history_line'] then
    raise exception 'PO B must fall back to its ColdLion D-number, same customer with MOD011 = MOD010, never its PLM reference: %',
      (select array_agg(sales_order_no order by sales_order_no)
         from plm.v_prod_order_sales_order_link where prod_order_header_id = h_b);
  end if;

  if (select array_agg(array_to_string(link_sources, '+') || ':' || source_count || ':' ||
             coalesce(latest_fetched_at::text, 'null') || ':' || sales_order_no || ':' ||
             sales_order_start_date || ':' || sales_order_cancel_date || ':' ||
             sales_order_start_date_ever_changed)
        from plm.v_prod_order_sales_order_link where prod_order_header_id = h_c)
     is distinct from array['prod_order_header:1:null:99396930:2026-02-01:2026-03-01:false'] then
    raise exception 'PO C must link only through its same-customer legacy header sales order';
  end if;

  if exists (select 1 from plm.v_prod_order_sales_order_link where prod_order_header_id = h_d) then
    raise exception 'a PO must not link across companies';
  end if;

  if exists (select 1 from plm.v_prod_order_sales_order_link where prod_order_header_id = h_e) then
    raise exception 'a PO whose ColdLion history names several customers must take no fallback pairs';
  end if;
end $$;
