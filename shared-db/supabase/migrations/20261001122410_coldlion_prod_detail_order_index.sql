-- =====================================================================================
-- Issue #3859 - supporting index for per-order reconcile on coldlion.prod_detail.
--
-- Claim: #3861 (index coldlion.prod_detail_company_code_prod_order_no_idx).
-- Reserved version 20261001122410.
--
-- WHY: After 20260930212107 dropped unique (company_code, prod_order_no, prod_line_seq),
-- the per-order reconcile query (reconcileSql in tools/coldlion-landing/lib/prod-details.mjs)
-- groups by prod_order_no under a company_code filter with no supporting index.
-- Review finding M1 on PR #3852.
--
-- STRUCTURE ONLY. Additive index; no data change.
-- =====================================================================================

-- derived-from: none

create index if not exists prod_detail_company_code_prod_order_no_idx
  on coldlion.prod_detail (company_code, prod_order_no);
