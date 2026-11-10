# Handoff — Burlington HFC buy-sheet import: follow-ups after delivery

Written 2026-11-10 5:16 PM EST by Claude (hetz). Delivered work is complete and
live; this file carries only what is still open.

## 1. Goal

Burlington sends a bulk "PURCHASE ORDER WORKSHEET - DOMESTIC" (HFC / up-front
production) 1–2 months before its official PO. PopDAM `/orders` now imports it
("Import buy sheet"): preview, then apply, one OrderList line per style per
delivery, identity customer + style + delivery date. Remaining goal: prove the
lines behave correctly when Burlington's official PO arrives through ColdLion,
and keep the import correct for later sheets.

## 2. Current state (verified 2026-11-10 4:50 PM EST)

- Live: the 10-20-26 sample was imported on https://dam.designflow.app/orders
  as the AI admin tester. Result 54 updated, 0 new, 0 held, all styles linked to
  Item Master. Orders touched: D3722–D3726, D3728–D3730, D3733–D3736 (D3727 is a
  Ross order — not part of this buy). Delivery totals 14,400 (12/20), 11,400
  (12/30), 4,800 (12/10). Burlington active line count unchanged (8,912); zero
  duplicate style/date lines; re-upload previews 54 unchanged.
- Recorded: one row in `dam.order_buy_sheet_import` (raw sheet, 224 rows).
- Code: [popdam3 PR 904](https://github.com/u2giants/popdam3/pull/904) (screen,
  parser, tests, Google-refresh protection), docs
  [PR 915](https://github.com/u2giants/popdam3/pull/915).
- Database (all in production): shared-db
  [PR 6009](https://github.com/popcre/shared-db/pull/6009),
  [PR 6016](https://github.com/popcre/shared-db/pull/6016) (review fixes #6010,
  #6017), [PR 6021](https://github.com/popcre/shared-db/pull/6021) (set-based
  lookups after the first live apply hit the 8 s API limit and rolled back).
  Issue [shared-db#6008](https://github.com/popcre/shared-db/issues/6008) closed
  with the live proof comment.
- Documentation: [docs/ORDER_LIST.md → Customer buy-sheet import](https://github.com/u2giants/popdam3/blob/main/docs/ORDER_LIST.md).

## 3. Owner rules that govern what is open

- **Bulk (HFC) vs distro (Albert, 2026-11-10):** "a 'distro' order (broken down
  by DC) replaces a bulk (sometimes called HFC) order." Distro lines become the
  live lines under the bulk line's D-number; the bulk line is retired (voided,
  kept, linked), never hard-deleted, and excluded from totals. One bulk line to
  many DC lines — separate from the one-to-one merge rule of 2026-10-22. Text:
  [docs/ORDER_LIST.md → Bulk (HFC) vs distro orders](https://github.com/u2giants/popdam3/blob/main/docs/ORDER_LIST.md).
  Implemented by another session in
  [shared-db PR 6018](https://github.com/popcre/shared-db/pull/6018)
  (`tools/coldlion-landing/lib/order-intake-distro.mjs`); its bulk-line
  selection already accepts `popdam_buy_sheet` lines
  ([line 75](https://github.com/popcre/shared-db/blob/main/tools/coldlion-landing/lib/order-intake-distro.mjs#L75)).
  The D37xx Burlington lines also keep their Google refs, so they qualify either way.
- **One-to-one merge (2026-10-22):** customer PO + style + quantity, used when the
  official PO is a single order, not split by DC.
- **Google-only orders (2026-11-09):** Google-only lines are kept and merged later.

## 4. Open items (most urgent first)

1. **Prove the official-PO outcome for Burlington when it arrives** (expected
   ~Dec 2026–Jan 2027). Nothing has arrived yet, so neither the distro path
   (PR 6018) nor the one-to-one path has been exercised on these lines.
   Next step when ColdLion shows Burlington sales orders for references
   D3722–D3736: read back each D-number — expect either (a) distro DC lines
   under the D-number with the buy-sheet line voided and linked
   (`metadata.orderlist_replaced_by_distro`), or (b) the ColdLion refs on the
   same line (one-to-one). Zero duplicates either way. If neither happens, the
   pairing filter in `order-intake-distro.mjs` / `order-intake-write.mjs` is the
   place to look.
2. **Open review finding on the distro step:**
   [shared-db#6019](https://github.com/popcre/shared-db/issues/6019) (on PR
   6018, owned by the session that wrote it). It holds automatic production
   promotion for that PR's change set. Not this session's; check its owner has
   picked it up before relying on item 1.
3. **"Held: needs an order number" path is untested live.** The sample matched
   existing orders for every pack, so the screen's order-number boxes (new pack,
   no D-number yet) have only run in local and CI tests. First time a sheet
   contains a pack with no OrderList order, watch the preview: the pack must show
   held until a D-number is typed, then "New".
4. **A revised sheet that drops a style to 0 sets that line's quantity to 0**
   (it does not void it). This was a design choice, not a ruling; if Albert wants
   dropped styles cancelled instead, change `public.import_dam_buy_sheet`.
5. **Unrelated, pre-existing:** popdam3 `main` CI job `lint-test-build` fails in
   `apps/bridge-agent/src/sibling-scan.vitest.ts` ("Missing required:
   POPDAM_SERVER_URL or SUPABASE_URL"), from PR 902. Advisory only; frontend
   publishing still works. Owner: whoever owns the sibling scan.

## 5. What was tried and failed

- First live apply (4:10 PM EST) timed out at the 8 s authenticated statement
  limit — per-line lookups ~0.1 s each. Rolled back, nothing written. Fixed by
  PR 6021 (one lookup per sheet, ~0.1 s total).
- A CI fixture for duplicate order numbers is impossible: `plm.guard_production_po_number`
  forbids duplicate numbers, so that case was dropped from the contract test.
- The import log first had a foreign key to `core.customer`; that broke the
  customer-merge coverage test, so it stores the customer id as a plain value.

## 6. How to verify

```sql
select o.production_order_number, l.sku, l.start_ship_date, l.quantity_ordered
from plm.production_order_line l
join plm.production_order o on o.id = l.production_order_id
join plm.production_order_line_source_ref r on r.production_order_line_id = l.id
 and r.source_system = 'popdam_buy_sheet'
order by 1, 3, 2;
```
Expect 54 rows today, totals 14,400 / 11,400 / 4,800 by date.

## 7. Files

- Parser: [src/lib/buy-sheet-import.ts](https://github.com/u2giants/popdam3/blob/main/src/lib/buy-sheet-import.ts)
- Screen: [src/components/orders/BuySheetImportDialog.tsx](https://github.com/u2giants/popdam3/blob/main/src/components/orders/BuySheetImportDialog.tsx)
- Tests + fixture: [src/test/buy-sheet-import.test.ts](https://github.com/u2giants/popdam3/blob/main/src/test/buy-sheet-import.test.ts)
- Database function (latest body): [shared-db migration 20261110210943](https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261110210943_dam_order_buy_sheet_import_set_based.sql)

## 8. Access

Live test login: 1Password `vibe_coding` administrator tester item (see memory
`project_popsg_tester_login`); session injected into `localStorage['sb-popdam-auth-token']`.

## 9. Retention

Delete this file when item 1 is proven on live Burlington data and items 2–4
are resolved or ruled on.
