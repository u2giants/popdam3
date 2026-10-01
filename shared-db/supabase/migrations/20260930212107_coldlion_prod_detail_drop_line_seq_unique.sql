-- =====================================================================================
-- Issue #3234 - drop the falsified second identity on coldlion.prod_detail.
--
-- Claim: #3851 (table coldlion.prod_detail). Reserved version 20260930212107.
--
-- SOURCE AUTHORITY (settled):
--   * ColdLion technical team, 2026-09-29: "pkey is your unique identifier. You should
--     primarily look at just pkey, but consider stage code." And: "Prod Line Seq is
--     designed to group different sizes together, it can repeat, in your case it doesn't
--     really matter if it's unique or repeated."
--   * JamieLynn, 2026-09-24: identical rows and split quantities are the customer PO
--     entered as written. Do not merge or de-duplicate on (prodOrderNo, prodLineSeq).
--   * JamieLynn, 2026-09-29: amount owed to the factory is the sum of prodQty x prodCost
--     over every real row (order 20959 was 1600+1600 = 3200 pieces).
--   * Albert Hazan, 2026-09-29: Ikonick multi-cost rows are an owner exception (ignore
--     or squeeze to fit); they are not a general multi-cost rule.
--
-- MEASUREMENT: full /proddetails scan 2026-09-20, 3,819 orders, 11 collision groups
-- across 9 orders. pkey distinct in every group and unique across the population.
-- The unique (company_code, prod_order_no, prod_line_seq) added in 20260916001944
-- (#2863) is falsified by vendor semantics, not just by outliers.
--
-- STRUCTURE ONLY. No row DDL beyond the constraint drop and comment corrections.
-- =====================================================================================

-- Drop the auto-named unique constraint from the original create table.
alter table coldlion.prod_detail
  drop constraint if exists prod_detail_company_code_prod_order_no_prod_line_seq_key;

-- Defensive: if the catalog name ever differed, drop the UNIQUE that is exactly
-- (company_code, prod_order_no, prod_line_seq). Keeps the migration correct against
-- a renamed constraint without guessing a second literal name.
do $$
declare
  cname text;
begin
  select con.conname into cname
    from pg_constraint con
   where con.conrelid = 'coldlion.prod_detail'::regclass
     and con.contype = 'u'
     and pg_get_constraintdef(con.oid) = 'UNIQUE (company_code, prod_order_no, prod_line_seq)';
  if cname is not null then
    execute format('alter table coldlion.prod_detail drop constraint %I', cname);
  end if;
end $$;

comment on table coldlion.prod_detail is
  'ColdLion GET /proddetails landing table (issue #2863 unit 5b; identity corrected #3234). One row per production-order line as the vendor sends it. Identity is (company_code, pkey) ONLY: pkey is the real vendor row id (ColdLion technical team 2026-09-29). prodLineSeq groups sizes and MAY REPEAT — it is not a line identity and must never be unique. Look-alike rows (exact duplicates, split quantities) are intentional customer-PO entry and must not be merged or de-duplicated. Factory amount owed is the sum of prodQty x prodCost over real rows. Bare JSON array; prodOrderNo is a required request parameter. Grain proof and vendor answers: docs/coldlion-unit-5b-grain-proof-20260915.md and docs/coldlion-open-questions.md 2.36.';

comment on column coldlion.prod_detail.prod_line_seq is
  'ColdLion prodLineSeq — a size-grouping field (one item/color/label/dim). It CAN REPEAT on one prodOrderNo and means nothing for POP (no apparel sizes). Never a unique constraint and never a line identity. Settled ColdLion technical team 2026-09-29; constraint dropped by issue #3234.';

comment on column coldlion.prod_detail.pkey is
  'ColdLion pkey — the REAL vendor row id and the only row identity (with company_code). ColdLion technical team 2026-09-29: "pkey is your unique identifier."';
