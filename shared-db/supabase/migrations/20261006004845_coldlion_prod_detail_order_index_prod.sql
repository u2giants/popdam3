-- =====================================================================================
-- Issue #3948 — production-path successor for the per-order index on
-- coldlion.prod_detail (company_code, prod_order_no).
--
-- Claim: #3950 (index coldlion.prod_detail_company_code_prod_order_no_idx).
-- Reserved version 20261006004845.
--
-- WHY THIS FILE EXISTS. Version 20261001122410 (#3859, PR #3862) authored this exact
-- index and it exists on preview, but that version never reached production: the
-- production ledger lacks it and production has no such index. Following the
-- 20261005044103 precedent, this successor repeats the same static, idempotent
-- statement under a new version so it can take the ordinary workflow preview-apply
-- path and then automatic production promotion. On preview it is a no-op; on
-- production it creates the index.
--
-- Supports the per-order reconcile query in tools/coldlion-landing/lib/prod-details.mjs.
-- Non-unique; no data, grant, RLS or constraint change.
-- =====================================================================================

create index if not exists prod_detail_company_code_prod_order_no_idx
  on coldlion.prod_detail (company_code, prod_order_no);
