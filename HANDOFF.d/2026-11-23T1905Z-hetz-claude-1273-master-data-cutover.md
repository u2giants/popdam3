---
summary: "Handoff for #1273 master data cutover: packaging and vendor lists shared; remaining DesignFlow production move, Size/Depth, retirement"
kind: handoff
status: current
read-when: "Continuing u2giants/popdam3#1273"
---
# Handoff — #1273 Master Data cutover (2026-11-23, hetz, Claude)

## 1. Goal
POP staff see one set of Packaging, Size, Creative Designer, Factory/Vendor and Depth values in PopDAM and DesignFlow. Issue: https://github.com/u2giants/popdam3/issues/1273. Plan (read its STATUS table first): https://github.com/u2giants/popdam3/blob/main/plan_master_data_designflow_reference_cutover.md

## 2. Done (verified)
- One packaging list: `core.packaging_type` merged (25 names, aliases in metadata) in shared prod, shared preview and the DesignFlow sandbox DB. DesignFlow Item Details reads `/api/core/findPackagingTypes`. Live 2026-11-23.
- Vendors: 87 `core.factory_source_ref` rows (source_system `designflow`, source_table `Factory`, source_id = DesignFlow Factory id); `core.factory.designflow_vendor_id` filled for 85. Sanmen Hengxin (CNSHR) and Ningbo Chanfonn (CNCHP) added by the guarded ColdLion sync (`tools/sync-coldlion-vendors.mjs --apply`, run 5b00fff4).
- DesignFlow Item Details Vendor picker reads `/api/core/findItemVendors` (option id = legacy Factory id when linked, else the shared factory UUID; `itemHeader.vendor_code_fk` is text). Sandbox shows 128 named vendors. Released to production.
- Sandbox DB (xupnyeifmpsacrqahwwm is the DesignFlow sandbox project) had `core.factory` and source refs refreshed from prod.

## 3. Not done
- Production DesignFlow is single-schema Cloud SQL (no `core`). Its backend returns a hardcoded packaging snapshot (`FALLBACK_NAMES` in designflow-backend `services/packagingTypes.service.js`) and the legacy Factory list for vendors. Both switch automatically when `isMultiSchemaEnabled()` is true in production. Retire `FALLBACK_NAMES` then.
- Plan steps 8, 10, 11 (Size, Depth, retirement of duplicate paths) are open.
- 19 active DesignFlow-only suppliers have no ColdLion code (listed in the reconciliation; rerun the comparison to regenerate). Some shared factory display names are contact-person names (e.g. "Anna DSY") — a data-quality cleanup candidate, not started.

## 4. Gotchas
- Never point the vendor picker at name matches only; ColdLion code outranks name.
- The vendor sync deletes stale rows only from `plm.erp_vendor` (mirror), by design.
- The frontend prod Cloud Build trigger (`popcre-frontend-prod`, project lithe-breaker-323913, region us-east4) did not auto-fire once on 2026-11-23; run it manually if the live bundle is stale. A Cloud Build↔GitHub outage ("Couldn't read commit") occurred 11:52 AM–12:05 PM EST; reruns succeeded.
- Item Details template shows `factory_nickname`; vendor options must carry it.

## 5. Next action
Decide with the DesignFlow owner (Uma) when production DesignFlow moves onto the shared database; that is a separate project. Meanwhile continue plan step 8 (Size/Depth contracts) claim-first in popcre/shared-db.

## 6. Verify
Sandbox https://alsand.designflow.app Item Details → Second tab → Vendor dropdown lists shared names; `/api/core/findItemVendors` and `/findPackagingTypes` return 200 when logged in.
