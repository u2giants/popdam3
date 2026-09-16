import { RevoGrid, Template, type ColumnRegular } from '@revolist/react-datagrid'
import { RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilterHeader } from './FilterHeader'
import {
  groupScrapedInventory,
  loadScrapedInventory,
  type ApiClient,
  type ScrapedInventoryKind,
  type ScrapedInventoryRow,
} from './lib/data-admin'
import { getDistinctColumnValues, rowMatchesFilters } from './lib/grid-filters'
import { scrapedInventoryColumns } from './scraped-properties-columns'

type Props = { client: ApiClient }

const inventoryTabs: Array<{ kind: ScrapedInventoryKind; label: string; itemLabel: string }> = [
  { kind: 'property', label: 'Properties', itemLabel: 'properties' },
  { kind: 'character', label: 'Characters', itemLabel: 'characters' },
  { kind: 'style_guide', label: 'Style Guides', itemLabel: 'style guides' },
]

function InventorySection({
  id,
  title,
  rows,
  columns,
  itemLabel,
}: {
  id: string
  title: string
  rows: ScrapedInventoryRow[]
  columns: ColumnRegular[]
  itemLabel: string
}) {
  const [filters, setTextFilters] = useState<Record<string, string>>({})
  const [setFilters, setSetFilters] = useState<Record<string, ReadonlySet<string> | null>>({})
  const distinctValues = useMemo(() => Object.fromEntries(columns.map(column => {
    const prop = String(column.prop)
    return [prop, getDistinctColumnValues(rows, prop)]
  })), [columns, rows])
  const gridColumns = useMemo(() => columns.map(column => ({
    ...column,
    readonly: true,
    columnTemplate: Template(FilterHeader, {
      filters,
      onFilter: (prop: string, value: string) => setTextFilters(current => ({ ...current, [prop]: value })),
      setFilters,
      onSetFilter: (prop: string, selected: Set<string> | null) => setSetFilters(current => ({ ...current, [prop]: selected })),
      distinctValues,
      scope: id,
      key: `${id}-${String(column.prop)}`,
    }),
  })), [columns, distinctValues, filters, id, setFilters])
  const visibleRows = useMemo(() => rows.filter(row => rowMatchesFilters(row, filters, setFilters)), [filters, rows, setFilters])

  return <section className="scraped-inventory-section" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    <p className="muted">{visibleRows.length} of {rows.length} {itemLabel}</p>
    {rows.length === 0
      ? <p className="empty-inventory">No scraped {itemLabel}.</p>
      : <div className="grid-wrap"><RevoGrid theme="material" readonly accessible resize rowSize={58} columns={gridColumns} source={visibleRows} rowHeaders /></div>}
  </section>
}

export function ScrapedPropertiesTable({ client }: Props) {
  const [entityKind, setEntityKind] = useState<ScrapedInventoryKind>('property')
  const [rows, setRows] = useState<ScrapedInventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [search, setSearch] = useState('')
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true); setError(null); setDenied(false)
    setRows([])
    try {
      const nextRows = await loadScrapedInventory(client, entityKind)
      if (requestId.current === currentRequest) setRows(nextRows)
    }
    catch (cause) {
      if (requestId.current !== currentRequest) return
      const message = cause instanceof Error ? cause.message : (cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '')
      if (/permission|licensing|access/i.test(message)) setDenied(true)
      else setError(message || 'Scraped source inventory could not be loaded.')
    } finally {
      if (requestId.current === currentRequest) setLoading(false)
    }
  }, [client, entityKind])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const term = search.trim().toLowerCase()
  const visibleRows = useMemo(() => rows.filter(row => !term || [
    row.display_label,
    row.licensor_name,
    row.source_system,
    row.source_table,
    row.source_id,
    row.source_status,
  ].some(value => String(value ?? '').toLowerCase().includes(term))), [rows, term])
  const groups = useMemo(() => groupScrapedInventory(visibleRows), [visibleRows])
  const tab = inventoryTabs.find(item => item.kind === entityKind) ?? inventoryTabs[0]
  const columns = useMemo(() => scrapedInventoryColumns(entityKind), [entityKind])

  if (denied) return <section className="access-denied" role="alert"><h1>Access denied</h1><p>This read-only screen requires an active Licensing Manager grant.</p></section>

  return <section className="workspace scraped-properties">
    <nav className="subtabs" aria-label="Scraped data type">
      {inventoryTabs.map(item => <button key={item.kind} className={entityKind === item.kind ? 'active' : ''} onClick={() => { setSearch(''); setRows([]); setEntityKind(item.kind) }}>{item.label}</button>)}
    </nav>
    <div className="controls">
      <label className="search"><Search aria-hidden="true" /><span className="sr-only">Search scraped {tab.itemLabel}</span><input placeholder={`Search scraped ${tab.itemLabel}`} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button className="icon-button" aria-label={`Refresh scraped ${tab.itemLabel}`} onClick={() => void load()}><RefreshCw /></button>
    </div>
    <p className="muted">Read-only source inventory from authorized licensor scrapes. Unmapped Creative Properties remain highlighted; matching decisions are made in Property Matching.</p>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div aria-busy={loading}>
      {groups.map(group => <section key={group.key} className="scraped-property-group" aria-labelledby={`scraped-${entityKind}-${group.key}`}>
        <h2 id={`scraped-${entityKind}-${group.key}`}>{group.name}</h2>
        <InventorySection key={`${entityKind}-${group.key}-creative`} id={`scraped-${entityKind}-${group.key}-creative`} title="Creative" rows={group.creative} columns={columns} itemLabel={tab.itemLabel} />
        <InventorySection key={`${entityKind}-${group.key}-submissions`} id={`scraped-${entityKind}-${group.key}-submissions`} title="Submissions" rows={group.submissions} columns={columns} itemLabel={tab.itemLabel} />
      </section>)}
      {loading && <div className="grid-loading">Loading…</div>}
      {!loading && !error && groups.length === 0 && <p className="empty-inventory">No scraped {tab.itemLabel} match this search.</p>}
    </div>
    <footer className="grid-footer"><span>{visibleRows.length} of {rows.length} scraped {tab.itemLabel}</span></footer>
  </section>
}
