# Handoff — issue #204 ERP apply live proof

## 1. Goal
Close https://github.com/u2giants/popdam3/issues/204 by proving in production that one ERP enrichment apply page completes through the DB function `apply_erp_item_updates`.

## 2. State (verified 2026-10-22 8:10 AM EDT)
- Code fix complete and deployed: PRs #309, #332, #342 (worker sends each page to one RPC).
- Old ERP sync feature is retired (2026-09-06); leftover UI labels removed in https://github.com/u2giants/popdam3/pull/461 (merged 5ffbd734, live: Settings tab now "ERP Enrichment").
- Production (Virginia, qsllyeztdwjgirsysgai): `public.erp_enrichment_log` has 0 rows ever; pg_stat_statements shows no worker call to `apply_erp_item_updates`. `public.product_category_predictions`: 2769 auto_applied, 16 approved, 1 rejected, 2 pending.

## 3. Key facts
- Enrichment does NOT need the old ERP sync. It reads ColdLion data via `api.plm_item_list` (https://github.com/u2giants/popdam3/blob/main/apps/worker/src/canonical-erp-items.ts) in `handleApplyErpEnrichment` (https://github.com/u2giants/popdam3/blob/main/apps/worker/src/handlers/erp.ts).
- It is a bulk operation run from Settings → ERP Enrichment in the app; it runs in the Railway worker.

## 4. Next action
Albert has not yet answered whether to run the apply in production (it bulk-writes assets/style_groups). Once yes: start "Apply ERP enrichment" from the admin page, then confirm `erp_enrichment_log` gains rows and `apply_erp_item_updates` shows calls.

## 5. Done when
Issue #204 checkbox "live proof" ticked with evidence (row counts, timestamps in EST), issue closed.

## 6. Tried / failed
- Railway MCP fails to connect on hetz, so worker logs were not read; use DB evidence instead.

## 7. Risks
Bulk write over many assets; first ever run — watch for errors in the bulk-op status.

## 8. Files
https://github.com/u2giants/popdam3/blob/main/apps/worker/src/handlers/erp.ts, https://github.com/u2giants/popdam3/blob/main/docs/ADMIN_OPERATIONS.md (ERP Operations section).

## 9. Owner
Unowned after this session; next session that picks up #204.
