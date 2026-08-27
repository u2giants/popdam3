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
| Create / edit dialog | `src/components/orders/OrderEditorDialog.tsx` |
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

**Not yet exercised against live production orders:** cell editing, the order
editor dialog, manual relink, and saved views. Those paths were proven on
preview on 2026-08-16 and are unchanged, but they write to real orders and
deserve a human pass before staff rely on them.

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

Production holds the same 24,010 lines but `plm.item` there is still empty.
