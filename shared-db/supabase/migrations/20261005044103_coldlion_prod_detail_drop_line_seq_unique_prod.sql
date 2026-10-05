-- =====================================================================================
-- Issue #3234 (production fallback) — idempotent drop of the falsified unique on
-- coldlion.prod_detail.
--
-- Claim: #3879 (table coldlion.prod_detail). Reserved version 20261005044103.
--
-- WHY THIS FILE EXISTS. Version 20260930212107 already dropped this constraint on
-- the preview database, but it was applied there by a direct CLI write before any
-- workflow preview-apply run existed. The production risk gate correctly refuses a
-- high-risk ALTER TABLE promotion without a workflow run whose ledger GAINED that
-- version, and no such run can ever exist for 20260930212107. This successor
-- repeats the same drop as a static IF EXISTS statement so it can take the ordinary
-- workflow preview-apply path and then production. On preview it is a no-op; on
-- production it removes the constraint. PRIMARY KEY (company_code, pkey) is untouched.
--
-- SOURCE AUTHORITY (settled): ColdLion technical team 2026-09-29 — pkey is the only
-- row identity; prodLineSeq groups sizes and may repeat. Claim-first record and
-- cost/Ikonick rules live in docs/business-rules/erp-orders-and-source-meaning.md
-- and docs/coldlion-open-questions.md 2.36.
-- =====================================================================================

alter table coldlion.prod_detail
  drop constraint if exists prod_detail_company_code_prod_order_no_prod_line_seq_key;

-- Defensive: drop any UNIQUE (company_code, prod_order_no, prod_line_seq) that
-- survives under a non-standard name. Static named drop above handles the
-- auto-name; this keeps the migration correct against a renamed constraint.
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
