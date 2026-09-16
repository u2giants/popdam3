import type { AdminRow } from './data-admin'

/** Sentinel stored for blank/empty/null cell values in set-filter selections. */
export const BLANK_VALUE = ''

/** Label shown for blank values in the set-filter checkbox list. */
export const BLANK_LABEL = '(Blanks)'

/**
 * Display value for a grid cell — matches what the RevoGrid row source shows.
 * PLM uses the same linked/status mapping applied when building visible rows.
 * Name falls back to the canonical `name` when no `display_name` override is
 * set, mirroring the list RPC's `coalesce(display_name, name)` sort key — most
 * records carry only `name`, so rendering the raw override left them blank.
 */
export function getCellDisplayValue(row: AdminRow, prop: string): string {
  if (prop === 'name_display') {
    // An override that is present but empty must still fall through to `name`,
    // so this cannot use `??` — only a non-empty override wins.
    const override = row.display_name == null ? '' : String(row.display_name)
    if (override !== '') return override
    return row.name == null ? BLANK_VALUE : String(row.name)
  }
  if (prop === 'plm_display') {
    if (row.plm_linked === false) return 'Not linked'
    if (row.plm_status == null) return 'Unknown'
    return row.plm_status === 'ACTIVE' ? 'Active' : 'Inactive'
  }
  const raw = row[prop]
  if (raw == null) return BLANK_VALUE
  const text = String(raw)
  return text === '' ? BLANK_VALUE : text
}

export function formatFilterOptionLabel(value: string): string {
  return value === BLANK_VALUE ? BLANK_LABEL : value
}

/**
 * Distinct display values for a column across the full loaded row set
 * (not the already-filtered subset). Sorted case-insensitively; blanks first.
 */
export function getDistinctColumnValues(rows: readonly AdminRow[], prop: string): string[] {
  const values = new Set<string>()
  for (const row of rows) values.add(getCellDisplayValue(row, prop))
  return [...values].sort((a, b) => {
    if (a === BLANK_VALUE && b !== BLANK_VALUE) return -1
    if (b === BLANK_VALUE && a !== BLANK_VALUE) return 1
    return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
  })
}

/** Case-insensitive substring match; empty/missing filter text means pass. */
export function textMatch(row: AdminRow, filters: Record<string, string>): boolean {
  return Object.entries(filters).every(([key, value]) => {
    if (!value) return true
    return getCellDisplayValue(row, key).toLowerCase().includes(value.toLowerCase())
  })
}

/**
 * Set filter match. Missing/undefined selected set means "all" (no set filter).
 * An explicit empty Set matches nothing. Otherwise the row's display value must
 * be in the selected set.
 */
export function setMatch(
  row: AdminRow,
  setFilters: Record<string, ReadonlySet<string> | undefined | null>,
): boolean {
  return Object.entries(setFilters).every(([key, selected]) => {
    if (selected == null) return true
    return selected.has(getCellDisplayValue(row, key))
  })
}

/** Row is visible when it passes Text AND Set filters for every column. */
export function rowMatchesFilters(
  row: AdminRow,
  textFilters: Record<string, string>,
  setFilters: Record<string, ReadonlySet<string> | undefined | null>,
): boolean {
  return textMatch(row, textFilters) && setMatch(row, setFilters)
}

/**
 * Toggle one value in a set-filter selection.
 * - When currently inactive (null), start from all distinct values then toggle.
 * - When every distinct value is selected after the toggle, return null ("all").
 */
export function toggleSetFilterValue(
  current: ReadonlySet<string> | null | undefined,
  allValues: readonly string[],
  value: string,
): Set<string> | null {
  const next = current == null ? new Set(allValues) : new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  if (next.size === allValues.length && allValues.every(v => next.has(v))) return null
  return next
}
