# DB Data Admin — column-header Multi Filter (Text + Set)

**Status:** shipped 2026-07-23 · **Lives in:** `apps/db-data-admin/src/`
**Equivalent to:** AG Grid **Multi Filter** configured as *Text Filter + Set Filter*,
where the Set Filter supplies the searchable checkbox list.

## What it is

Every column header in the DB Data Admin RevoGrid exposes two filters at once:

| Half | UI | Behavior |
|---|---|---|
| **Text Filter** | Always-visible input under the column name | Case-insensitive substring match, 300 ms debounce |
| **Set Filter** | Funnel icon → popover | Search box + checkbox list of that column's **distinct values**, `Select all` / `Clear`, `(Blanks)` entry |

A row is visible when it passes **Text AND Set for every column** (AND across columns).

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
