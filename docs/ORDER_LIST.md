# OrderList (`/orders`)

PopDAM's replacement for the legacy Google Sheet `OrderList`. Signed-in PopDAM
staff can view, search, filter, sort, edit and create order lines, with product
facts read from PopDAM Master Data instead of copied onto every order row.

PopSG never exposes this page: both the route and the nav item are behind
`!IS_POPSG`, and `src/test/order-list-routing.test.ts` fails if that changes.

---

## Files

| Piece | File |
|---|---|
| Route registration | `src/App.tsx` (protected, `!IS_POPSG`) |
| Navigation entry | `src/components/AppHeader.tsx` (`popdamNavItems`, and `SECONDARY_NAV_LABELS` for compact chrome) |
| Page | `src/pages/OrdersPage.tsx` |
| Grid | `src/components/orders/OrderListGrid.tsx` |
| Row Edit action (the only way into the editor for an existing order) | `src/components/orders/OrderActionsCell.tsx` |
| Create / edit / void dialog | `src/components/orders/OrderEditorDialog.tsx` |
| Link status cell | `src/components/orders/MasterDataLinkCell.tsx` |
| Manual relink dialog | `src/components/orders/MasterDataLinkDialog.tsx` |
| Saved views menu | `src/components/orders/OrderListViewsMenu.tsx` |
| Summary counts | `src/components/orders/OrderListSummary.tsx` |
| Data access | `src/hooks/useOrderList.ts` |
| Pure rules (columns, parsing, matching, query building) | `src/lib/order-list.ts` |
| Types for the `api` view and the RPCs | `src/types/order-list.ts` |
| Tests | `src/test/order-list*.test.ts(x)` |

## Database contract

All objects are owned by `u2giants/shared-db`. Nothing here may be changed from
this repo.

| Object | Used for |
|---|---|
| `api.dam_order_list` | The one read surface. Security-invoker view joining `plm.production_order`, `plm.production_order_line`, the linked `plm.item`, and Master Data through `plm.style_tracker_item_bridge`. |
| `public.create_dam_order(p_order jsonb, p_lines jsonb)` | Create an order with its lines. |
| `public.update_dam_order(p_order_id uuid, p_order_patch jsonb, p_line_patches jsonb)` | Edit header and line fields. Only keys present in the patch are written. |
| `public.link_dam_order_line(p_line_id uuid, p_item_id uuid, p_match_status text)` | Manual relink to a canonical item. |
| `public.order_list_user_views` | Per-user saved column/filter/sort layouts, unique on `(user_id, view_name)`. |
| `public.style_tracker_rows_with_bridge` | Source of eligible relink candidates. |

**Patch-key trap:** the RPCs accept `status`, while the view exposes
`order_status` and `line_status`. `patchKeyFor()` in `src/lib/order-list.ts`
does the translation. Sending a key outside the RPC's allow-list fails with
`42501` (HTTP 403), so this is a hard contract, not a preference.
`ordering_company` is not an accepted key, so that column is read-only.

## How the page loads data

The list is **not** loaded in full. Measured against the preview database on
2026-08-16 the whole view is about 53 MB (2.2 MB per 1,000 rows x 24,010 rows)
and took roughly 25 seconds to appear. The grid therefore uses AG Grid's
infinite row model and reads 200-row blocks, pushing sort, filter and search
into the database, so results always cover every matching row rather than only
the rows in the browser. First rows now appear in well under a second.

Consequence, deliberate: **Set filters are not offered.** A Set filter lists the
distinct values of the whole dataset, which the browser no longer holds; showing
one would silently filter against loaded rows only. Columns use Text, Number and
Date filters, plus the free-text search box, which searches
`ORDER_LIST_SEARCH_COLUMNS` in the database.

The summary counts (total, linked, ambiguous, not linked) are read as count
queries over the whole dataset, not derived from loaded rows.

**The block's rows and its exact total are two separate requests** (fixed
2026-08-26). Asking PostgREST for both in one call put the request that renders
the screen within reach of the 8-second `authenticated` statement timeout, and
in production it exceeded it — the whole grid failed with `canceling statement
due to statement timeout`. Rows cost ~50 ms; an exact count of the view costs
~2.2 s under RLS. The count is now best-effort, cached per filter/search result
set, and reported as **unknown, never 0**, when it fails — which the grid shows
as "of more". See `docs/KNOWN_QUIRKS.md` #75. Do not re-merge them.

## Master Data rules

- An order line points at a canonical `plm.item`. Master Data is reached through
  the style-to-item bridge. There is no second link to `style_tracker_rows`.
- Master Data columns are **read-only** and visually marked. Order columns are
  editable.
- When a line has no link, the Master Data cells fall back to the immutable
  import snapshot and are labelled `at import`. A snapshot value is never shown
  as if it were current product truth.
- Rows needing a human decision (ambiguous, or unlinked with a Style #) are
  highlighted and named in the Master Data Link column.
- A manual relink offers only exact, catalog-eligible candidates: the normalized
  Style # must match exactly (trim + case-fold only, never fuzzy) and the Master
  Data catalog must match the line's Licensed/Generic value. Manual links are
  saved with match status `manual`.
- A relink always writes `manual`, in both directions. There is no UI path back
  to `matched`, so re-pointing a line at the item it already had still changes
  its status. That is deliberate: a human decision stays visible as one.

## Editing rules

- **Editing an existing order** starts from the pencil in the pinned Edit column
  on each row. The editor dialog was previously reachable only through **New
  order**, which left `mode: "edit"` as dead code and made the whole edit and
  void path unreachable (fixed 2026-08-26, issue #99).
- **There is no delete.** A correction voids the order: `update_dam_order` takes
  `{"voided": true, "void_reason": "..."}`, which stamps `voided_at`/`voided_by`
  and keeps the record. The dialog requires a reason and asks for confirmation,
  and offers **Restore** on an order that is already voided.
- **`api.dam_order_list` does NOT filter voided rows out.** A voided order stays
  in the grid and must therefore be *rendered* as voided — struck through, faded,
  with a ban icon in the Edit column — or a cancelled order reads as a live one.
- **`order_voided_at` is not a grid column, so it must be named explicitly in
  `ORDER_LIST_SELECT`.** That select list is built from the grid's columns plus a
  short list of extras; a field the grid needs but never displays is invisible to
  it otherwise. Leaving it out made voiding write correctly while looking like
  nothing happened. A test pins it in place.
- **An unreadable value is refused, never written as null.** `parseOrderDate` and
  `parseOrderNumber` return `null` both for "the user cleared this field" and for
  "this text is not a date/number", so typing `not-a-date` over a real date used
  to ERASE it and report "Order saved" — silent data loss with a success message,
  reproduced against production on 2026-08-26. `coerceFieldValueStrict` now
  throws on non-empty input it cannot parse, naming the column; the grid turns
  that into a toast and rolls the cell back. Clearing a cell to empty still
  writes `null`, because that is a real edit. **Any new write path must use
  `coerceFieldValueStrict`, not `coerceFieldValue`.**

## Permissions

Read and write follow the collaborative Master Data model: any signed-in PopDAM
user can read and edit. There is no delete; corrections use status and void
fields so history survives.

> **Settled by the owner, 2026-08-26.** Albert Hazan ruled that **everyone
> signed in should be able to see OrderList data**. The four OrderList tables
> carry `USING (true)` SELECT policies for `authenticated`, which already match
> the ruling, so no policy change was required — read access is now a deliberate,
> approved decision rather than an unreviewed default. Writes remain restricted
> to `plm_admin_write` (administrator role). This closes open question 2 in the
> shared-db plan `plan_popdam_order_list.md`.

## Verification (2026-08-16, preview `rjyboqwcdzcocqgmsyel`)

Checked in the real app, signed in, against the preview database:

- 24,010 lines listed, first rows visible immediately;
- free-text search `NCV3SP1` returned 23 rows from the database;
- column filter `Style # contains BFC02GABB` returned 1 row of 24,010;
- a cell edit (PO Status) saved through `update_dam_order` and was confirmed in
  the database, then reverted the same way;
- a manual relink of a licensed line saved through `link_dam_order_line` and the
  whole-dataset counts moved to `Linked to Master Data: 1`;
- a saved view was created (60 columns of state) and deleted;
- Columns panel, compact width (900px) and the PopSG exclusion all behave.

## Verification (2026-08-26, production `qsllyeztdwjgirsysgai`)

Checked in the deployed app at `dam.designflow.app/orders`, signed in as an
administrator, at build `47a42e92`:

- **24,486 shown of 24,486 lines · Linked to Master Data: 24,473 · Ambiguous: 0
  · Not linked: 0**; page 1 of 245 at 100 rows per page;
- Master Data descriptions render live on every row (no `at import` fallback);
- no console errors beyond the pre-existing AG Grid trial-licence notice.

## Human pass over the write paths (2026-08-26, production, issue #99)

Every write path was exercised against live production orders, signed in as an
administrator, and every change was reverted. The database confirms production
was left exactly as it was found: 3,212 orders (0 voided), 24,010 lines
(23,997 `matched`, 13 `not_applicable`), 0 saved views.

| Path | Result |
|---|---|
| Cell edit | PASS — saved, persisted across reload, reverted; one order and one line touched |
| Order editor dialog on an existing order | PASS — after adding the row Edit action; prefilled correctly, saved, reverted |
| Create an order | PASS — created, then voided, restored, voided again, and finally removed so production carries no test data |
| Void / restore | PASS — reason required, confirm step, row renders struck through, Restore clears `voided_at` and the reason |
| Manual relink | PASS — offered exactly one candidate (the exact Style # in the line's own catalog), wrote `manual` without changing `item_id` |
| Saved views | PASS — created, survived reload, restored the exact column layout, deleted |
| Error honesty (failed save) | PASS — a forced 503 produced a toast and a visible rollback; nothing was written |
| Error honesty (unreadable input) | **FAILED, then fixed** — see the coercion rule under *Editing rules* |
| PopSG exclusion | PASS — no Orders nav item; `sg.designflow.app/orders` renders the app 404 |
| Deep paging | PASS — page 26 of 245 (rows 2,501-2,600), total held at 24,486, zero failed requests |

Three defects were found and fixed in the same pass: the editor was unreachable
for an existing order, there was no way to void, and unreadable input silently
erased the field it was meant to change. All three are described under
*Editing rules*.

Two measurement traps cost time and are worth knowing:

- **AG Grid virtualises columns horizontally.** Reading `.ag-header-cell-text`
  shows only what is on screen, so a restored saved view looks wrong when it is
  right. Scroll the grid end to end, or read the column state, before concluding
  anything about which columns are visible.
- **Pinned columns live in a different DOM container.** `PO Status` and
  `Import PO #` are pinned left, so they are not inside
  `.ag-center-cols-container`; a row reader that only looks there finds nothing.

One intermittent remains, unchanged in nature: on 1 cold load out of 7 the row
query itself hit the 8s `authenticated` statement timeout. The rows still
rendered, the pager honestly said "of more", and the banner named the cause —
which is quirk #75 behaving as designed — but the ceiling is still occasionally
reached.

## Current data state

**Production is fully linked (2026-08-26).** `plm.item` holds **19,362** items
loaded from ColdLion through `plm.import_item_master_data`; the style-item
bridge carries `plm_item_id` on 14,621 rows; and
`public.relink_dam_order_lines_bulk()` linked **23,997 of 24,010 order lines**
with zero ties and zero no-candidates. The remaining 13 are
`not_applicable` — lines with no SKU to match. Link integrity was checked: zero
rows where `plm.item.item_number` disagrees with the line's `sku_normalized`.

The import-snapshot fallback therefore no longer fires in normal use. It stays
in the code because new orders can arrive before their item does.

