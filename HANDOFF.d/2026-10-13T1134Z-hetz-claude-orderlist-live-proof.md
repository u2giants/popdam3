# OrderList source outlines, refresh blink, default sort — live proof pending

## 1. Goal
Albert asked (chat, 2026-10-12): orange thin border on OrderList rows from Google Sheets, purple for ColdLion; stop the grid "blinking" (data vanishes ~1s then reappears); default sort by Start Ship date, latest first.

## 2. Current state
Code shipped and deployed (CI + Publish Frontend Image green on main):
- https://github.com/u2giants/popdam3/pull/360 — outlines + in-place background refresh.
- https://github.com/u2giants/popdam3/pull/361 — default sort start_ship_date desc.
NOT done: visual check on the live site.

## 3. What changed
- https://github.com/u2giants/popdam3/blob/main/src/components/orders/OrderListGrid.tsx — `orderListSourceBorder` (coldlion_source_id → purple #9333ea inset 1px; else google_source_id → orange #f97316); merged into getRowStyle incl. highlight/voided/needs-review styles. Default column sort is start_ship_date desc.
- https://github.com/u2giants/popdam3/blob/main/src/lib/order-list-grid-refresh.ts — `refreshOrderListRowsInPlace`: fetches only displayed rows with current sort/filter and calls node.setData; falls back to `refreshOrderListRows` (purgeInfiniteCache) when rows were added/removed/reordered.
- https://github.com/u2giants/popdam3/blob/main/src/pages/OrdersPage.tsx — 30s timer, window focus and style_tracker_rows realtime now call the quiet refresh; edits still use the purge path.
- https://github.com/u2giants/popdam3/blob/main/src/lib/order-list.ts — server fallback sort start_ship_date desc.

## 4. Root cause of blink
Every 30s/focus/realtime event called purgeInfiniteCache, which empties the infinite row model before refetching.

## 5. Tried and rejected
refreshInfiniteCache: no blink but re-reads every cached block (up to 20×500 rows); existing tests require only the visible block be re-read.

## 6. Exact next step
Open the live PopDAM Orders → OrderList as an admin tester (1Password tester items, see memory/AGENTS). Confirm: (a) orange/purple row outlines visible; (b) watch ≥60s and refocus the window — rows never disappear; (c) Start Ship column shows descending arrow, latest dates first. Screenshot as proof.

## 7. Verify
All three observations above, with screenshot. If outlines invisible, the cell backgrounds may cover the row box-shadow — move to rowClassRules with a CSS border on .ag-row.

## 8. Risks
Rows with both IDs show purple. Saved views with their own sort override the default.

## 9. Owner
Unassigned — next session.

Posted by Claude chat 1cbbd0c7-b01b-4b7e-8498-abe50c3fc445 on hetz
