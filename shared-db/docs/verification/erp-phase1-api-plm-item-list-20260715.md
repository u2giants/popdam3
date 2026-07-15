# Verification — ERP Phase 1: `api.plm_item_list` serving view (2026-07-15)

Durable evidence for Phase 1 of [`../../fix_schema_for_api.md`](../../fix_schema_for_api.md).
Migration: `supabase/migrations/20260715193000_erp_phase1_api_plm_item_list.sql` · PR
[#70](https://github.com/u2giants/shared-db/pull/70).

## What was deployed
- `api.plm_item_list` — read-only `security_invoker` view over `public.erp_items_current`
  (faithful 1:1; `external_id` exposed as `source_id`).
- `public.style_tracker_rows_with_bridge` — repointed to read ERP columns
  (`canonical_description`, `erp_style_number`) through the view instead of the base table.
  Column set/order and (security-definer) execution mode unchanged.

## Deliberately NOT changed
- `plm.refresh_style_tracker_item_bridge()` was left reading `public.erp_items_current`
  directly. It writes the physical ERP row `id` into FK `plm.style_tracker_item_bridge.erp_item_id`
  and branches on `target_table = 'erp_items_current'`; routing it through a view gives no real
  decoupling. It moves in Phase 4 when that FK repoints to `plm.item(id)`.

## Pre-authoring checks (read-only, against production `qsllyeztdwjgirsysgai`)
- `api.plm_item_list` SELECT compiled and returned **17,703** rows, **17,703** distinct `source_id`
  (confirms `external_id` is the unique natural key).
- Outer-view rewrite equivalence: across **15,509** non-null-`erp_item_id` bridge rows, **0**
  differences in `item_description` / `style_number` between the base table and the view path.

## Deploy path (sanctioned preview-first flow)
1. `scripts/check-sql.sh` — passed.
2. PR CI `validate` — passed.
3. `workflow_dispatch` dry-run vs **preview** (`xjcyeuvzkhtzsheknaiu`) — clean; only this migration pending.
4. `workflow_dispatch` apply vs **preview** — success.
5. Merged PR #70 → `main`.
6. `workflow_dispatch` apply vs **production** (`qsllyeztdwjgirsysgai`) — success
   (run 29445431196). Only this one migration applied (reconciliation history already present).

## Post-deploy verification (production, via MCP)
- `api.plm_item_list` → **17,703** rows, **17,703** distinct `source_id`.
- `style_tracker_rows_with_bridge` vs base table → **15,509** bridge rows, **0** mismatches.
- Net effect: **no behavior change** — pure decoupling, as intended for Phase 1.

## Reusable check (re-run any time)
```sql
select 'api.plm_item_list' as check, count(*) rows, count(distinct source_id) distinct_source_ids
from api.plm_item_list
union all
select 'style_tracker equivalence', count(*),
       count(*) filter (where b.erp_item_id is not null
         and (v.canonical_description is distinct from base.item_description
           or v.erp_style_number is distinct from base.style_number))
from plm.style_tracker_item_bridge b
join public.style_tracker_rows_with_bridge v on v.bridge_id = b.id
left join public.erp_items_current base on base.id = b.erp_item_id;
```
Expected: view returns the full item count with unique `source_id`; equivalence mismatches = 0.
