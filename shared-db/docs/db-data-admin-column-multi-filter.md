# DB Data Admin — column-header Multi Filter (Text + Set)

**Status:** shipped 2026-07-23 · **Lives in:** `apps/db-data-admin/src/`
**Equivalent to:** AG Grid **Multi Filter** configured as *Text Filter + Set Filter*,
where the Set Filter supplies the searchable checkbox list.

## What it is

Every column header in the DB Data Admin RevoGrid exposes two filters at once:

| Half | UI | Behavior |
|---|---|---|
| **Text Filter** | Always-visible input under the column name | Case-insensitive substring match, 300 ms debounce. As you type, a **typeahead dropdown** suggests that column's distinct values containing the text (blanks excluded); clicking one sets the filter to that value. |
| **Set Filter** | Funnel icon → popover | Search box + checkbox list of that column's **distinct values**, `Select all` / `Clear`, `(Blanks)` entry |

A row is visible when it passes **Text AND Set for every column** (AND across columns).

Both the Set Filter popover and the Text Filter autocomplete are **portalled to
`document.body`** and positioned from their trigger's screen rect, so RevoGrid's
header `overflow` cannot clip them. This was a real bug caught only by live browser
testing (unit tests use jsdom, which has no layout/clipping) — see the popover-clipping
note under "Design decisions". The text input carries `role="combobox"`.

## Where the code lives

| File | Role |
|---|---|
| `src/lib/grid-filters.ts` | **Pure, framework-free filter logic.** No React, no RevoGrid imports. This is the reusable part. |
| `src/lib/grid-filters.test.ts` | Unit tests for the logic above |
| `src/DataAdmin.tsx` → `FilterHeader` | The React header component (input + funnel + popover) |
| `src/DataAdmin.tsx` → `DataAdmin` | Owns filter state and wires `columnTemplate` per column |
| `src/styles.css` | `.filter-header`, `.set-filter-btn`, `.set-filter-popover` |

### `grid-filters.ts` public contract

```ts
BLANK_VALUE            // '' — sentinel stored for blank/null cells
BLANK_LABEL            // '(Blanks)' — label shown for those
getCellDisplayValue(row, prop): string        // what the grid actually shows
formatFilterOptionLabel(value): string
getDistinctColumnValues(rows, prop): string[] // sorted, blanks first
textMatch(row, textFilters): boolean
setMatch(row, setFilters): boolean
rowMatchesFilters(row, textFilters, setFilters): boolean
toggleSetFilterValue(current, allValues, value): Set<string> | null
```

## Design decisions (and why)

### Distinct values come from the FULL loaded row set

`getDistinctColumnValues` is computed from `rows`, not from the already-filtered
`visibleRows`. If it used the filtered set, checking one value would collapse the list to
just that value and the user could never widen the selection again.

### `null` means "all", not "none"

A column's set selection is `Set<string> | null`. `null` = no set filter (everything
passes). An **explicit empty `Set`** matches nothing — that is what `Clear` produces.
`toggleSetFilterValue` collapses back to `null` when every distinct value ends up
selected, so "all checked" and "no filter" are the same state and the funnel's active
indicator stays truthful.

### Display value, not raw value, is what gets filtered

`getCellDisplayValue` centralizes the PLM mapping
(`plm_linked === false → 'Not linked'`, `plm_status == null → 'Unknown'`, else
`Active`/`Inactive`). Both the Set Filter checkbox list and the Text Filter run against
that same display string, so the list always matches what the user sees on screen.
Before this change that mapping was duplicated inline in `visibleRows`; do not
re-duplicate it.

### Derived columns must go through `getCellDisplayValue` — the Name column proved why

`name_display` is the second derived column (added 2026-07-28). It resolves the
effective entity name as **non-empty `display_name`, else `name`**.

`display_name` is an *optional curated override*; `name` is canonical. On
2026-07-28 the count was **824 of 862 customers (96%) with no override at all**,
and 92 of 93 factories. The Name column originally rendered raw `display_name`,
so almost every row showed a **blank Name** — while still sorting into its correct
alphabetical slot, because the list RPC already sorts on
`lower(coalesce(display_name, name))`. That "blank cells in the right order"
signature is what makes this class of bug confusing: the sort key and the
rendered value came from different expressions.

Routing it through `getCellDisplayValue` fixes the row source, the distinct-value
list, the Text Filter, and the Set Filter in one place — the four consumers this
function exists to unify. Sorting is RevoGrid client-side over the same derived
value, so no RPC contract changed.

Two constraints on this column, both deliberate:

- **It cannot use `??`.** A present-but-empty `display_name` (`''`) must fall
  through to `name`. `??` only falls through on `null`/`undefined`.
- **The raw `display_name` field stays on the row, untouched.** `RecordEditor`
  reads it to tell "no override set" apart from a real override, and its
  unchanged-field check (`displayName === String(row.display_name ?? '')`) relies
  on that to send `null` instead of silently writing the fallback name in as a
  brand-new override. Never overwrite `display_name` with the effective name.

**Latent trap.** The RPC's sort key is plain `coalesce(display_name, name)`, and
`coalesce('', name)` is `''` — SQL does *not* fall through on empty string, but
the client now does. A row with `display_name = ''` would therefore sort as blank
server-side while displaying its canonical name, reintroducing the same
sort-vs-display split. Verified 2026-07-28 on **both** preview and production:
**zero** empty or whitespace-only overrides in `core.customer` and `core.factory`,
so this is currently unreachable. If anything ever starts writing `''` instead of
`NULL` on clear, change the RPC to
`coalesce(nullif(btrim(display_name), ''), name)` rather than reverting the client.

### Focus/caret preservation is a hard requirement

RevoGrid re-renders headers when filtering. There is a standing acceptance test —
`src/DataAdmin.test.tsx`, "retains focus and caret while publishing controlled filter
text" — proving the text input keeps focus **and cursor position** across those
re-renders. Any refactor of `FilterHeader` must keep that test passing.

### Why hand-built instead of a library feature

RevoGrid's official always-visible header-input plugin is a **Pro** feature. This adapter
is built only on documented public Core APIs (`columnTemplate` via `Template()`), keeping
the app on MIT RevoGrid Core. Do not copy Pro source or rely on undocumented internals.

## Reusing this in another app

`grid-filters.ts` has **zero** React/RevoGrid dependencies — it only imports the `AdminRow`
type. To reuse it elsewhere:

1. Copy `grid-filters.ts` + its test file.
2. Replace the `AdminRow` import with that app's row type (or make it generic over
   `Record<string, unknown>`).
3. Replace the `plm_display` branch in `getCellDisplayValue` with that app's own
   display mappings — that is the only app-specific logic in the module.
4. Re-implement the header UI for whatever grid that app uses; the logic module is
   grid-agnostic.

### Prior art in the org (checked 2026-07-23)

A read-only audit of the Markdown in all 28 `u2giants` repos found **no pre-existing
reusable Text+Set header Multi Filter**. Closest relatives, none of them shareable:

| Where | What | Verdict |
|---|---|---|
| `popcrm-web` `src/components/app/DataTable` + `FilterSelect` | Checkbox value popover **and** header quick-search w/ autocomplete | Same ideas, but two separate side-by-side tools, not one Multi Filter. **Bespoke to PopCRM and explicitly marked legacy** in this repo — do not grow it into a third cross-app grid platform. |
| `popdam3` `src/components/ui/filterable-table-head.tsx` | Text input + suggestions + sorting | Interaction reference only; no set/checkbox list. |
| `popdam3` faceted filter panel | Page-level facet sidebar | Different concept — not a column-header filter. |

So this module is the org's **first** reusable Text+Set filter logic. If a second app needs
it, promote `grid-filters.ts` to a shared package rather than copy-pasting a third time.

### Cross-pollination with PopCRM (2026-07-24) — deliberately NOT a shared package

After reading PopCRM's actual `DataTable.tsx` source (not just docs), the two were found
to be **too different to share code**: PopCRM uses a hand-rolled DOM `<table>` (no grid
library), extracts values via per-column callbacks generic over `T`, and models "no
filter" as an empty array; this app uses RevoGrid, prop-name lookup, and `null` vs empty
`Set`. Different engines mean **zero shared UI**, and unifying the ~120 lines of shallow
logic would cost more than it saves. Instead each side borrowed the other's strength:

- **Into this app:** PopCRM's header **autocomplete** (typeahead on the text input).
  Shipped in PR #219. Not ported: PopCRM's `filterLabel` callback — `getCellDisplayValue`
  already covers display mapping here.
- **Into PopCRM** (`popcrm-web`, on `main`): this app's **blank-value handling**. PopCRM's
  Set Filter dropped blank/empty values entirely, so rows with no value in a column were
  unfilterable even though its popover already had an unreachable `(blank)` renderer. Fixed
  by collapsing blanks to one `''` sentinel; logic extracted to
  `popcrm-web/src/components/app/columnFilters.ts` with unit tests. Not ported: this app's
  `null` vs empty-`Set` semantics — it would have changed PopCRM's Clear-button behavior in
  production for marginal benefit.

#### Verified live in PopCRM production (2026-07-25)

Logged into `crm.designflow.app` → Contacts and opened the **Title** column filter: it now
offers `(blank)`, and selecting it registers as a real filter (`256 rows · 1 filter
active`) matching all 256 blank rows — a broken sentinel would have matched 0. Confirmed
the old algorithm returned `[]` for that same data (popover rendered *"No values in
column."*), so the Title filter was **completely unusable** before the fix.

**Non-obvious gotcha for future sessions:** most PopCRM columns never produce blanks
because their `filterValue` runs through `relatedName()` / `label()`, which substitute
placeholder **strings** — `Department` yields a literal `"—"` and `Type` yields
`"Unspecified"`. Those are real values to the filter, not blanks. Only columns whose
`filterValue` returns the raw nullable field (e.g. Contacts `job_title`) can produce a
`(blank)` entry. Don't read a missing `(blank)` option on those columns as a regression.
