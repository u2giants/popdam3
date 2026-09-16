import { Editor, RevoGrid, Template, type BeforeRangeSaveDataDetails, type BeforeSaveDataDetails, type ColumnRegular, type Editors, type EditorType } from '@revolist/react-datagrid'
import { Check, ChevronRight, GitMerge, History, LogOut, Pencil, RefreshCw, Search, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { executeMerge, initialQuery, loadAllRows, loadAudit, loadDetail, loadGridState, loadRows, previewMerge, probeAccess, saveGridState, searchMergeCandidates, updateRecord, type AdminRow, type ApiClient, type AuditEvent, type EntityKind, type MergeResult, type QueryState, type UpdateInput } from './lib/data-admin'
import {
  getCellDisplayValue,
  getDistinctColumnValues,
  rowMatchesFilters,
} from './lib/grid-filters'
import { RecordEditor } from './RecordEditor'
import { MergeDialog } from './MergeDialog'
import { ProductDepthTable } from './ProductDepthTable'
import { PropertyTable } from './PropertyTable'
import { PropertyMatchReview } from './PropertyMatchReview'
import { ScrapedPropertiesTable } from './ScrapedPropertiesTable'
import { INLINE_EDITABLE_PROPS, INLINE_EDIT_REASON, INLINE_UNDO_REASON, saveInlineRow } from './lib/inline-edit'
import { FilterHeader, type HeaderProps } from './FilterHeader'

// Re-exported so existing imports (and tests) can keep reaching these here.
export { FilterHeader }
export type { HeaderProps }

type Props = { client: ApiClient; email?: string; environmentLabel: string; onSignOut: () => void }
type UndoStep = Array<{ id: string; changes: Record<string, unknown> }>

export function StatusDropdownEditor({ column, val, save, close }: EditorType) {
  const isGlobalStatus = String(column.prop) === 'status'
  const options = isGlobalStatus
    ? [['active', 'Active'], ['potential', 'Potential'], ['inactive', 'Inactive']]
    : [['active', 'Active'], ['inactive', 'Inactive']]

  return (
    <select
      className="grid-status-editor"
      aria-label={`Edit ${String(column.name ?? column.prop)}`}
      autoFocus
      defaultValue={String(val ?? 'active')}
      onBlur={() => close()}
      onKeyDown={event => {
        if (event.key === 'Escape') close()
      }}
      onChange={event => {
        save(event.target.value)
        close(true)
      }}
    >
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  )
}

const gridEditors: Editors = {
  'global-status': Editor(StatusDropdownEditor),
  'app-status': Editor(StatusDropdownEditor),
}

const baseColumns: ColumnRegular[] = [
  { prop: 'name_display', name: 'Name', size: 260, sortable: true },
  { prop: 'status', name: 'Status', size: 105, sortable: true, editor: 'global-status' },
  { prop: 'crm_status', name: 'CRM', size: 105, editor: 'app-status' },
  { prop: 'pm_status', name: 'PM/PIM', size: 105, editor: 'app-status' },
  { prop: 'dam_status', name: 'DAM', size: 105, editor: 'app-status' },
  { prop: 'plm_display', name: 'PLM', size: 115 },
  { prop: 'erp_active', name: 'ERP active', size: 105 },
  { prop: 'alias_count', name: 'Aliases', size: 85 },
  { prop: 'updated_at', name: 'Updated', size: 175, sortable: true },
]

export function DataAdmin({ client, email, environmentLabel, onSignOut }: Props) {
  const [kind, setKind] = useState<EntityKind>('customer')
  const [section, setSection] = useState<'entity' | 'scraped-property' | 'property-match' | 'product-depth' | 'property-status'>('entity')
  const [query, setQuery] = useState<QueryState>(initialQuery)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})
  const [setFiltersState, setSetFiltersState] = useState<Record<string, Set<string> | null>>({})
  const [rows, setRows] = useState<AdminRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [editing, setEditing] = useState(false)
  const [editorReloadKey, setEditorReloadKey] = useState(0)
  const [merging, setMerging] = useState(false)
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([])
  const [dataMode, setDataMode] = useState<'client' | 'server'>('client')
  const [inlineEditing, setInlineEditing] = useState(false)
  const [inlineSaving, setInlineSaving] = useState(0)
  const [inlineMessage, setInlineMessage] = useState<string | null>(null)
  const [undoStack, setUndoStack] = useState<UndoStep[]>([])
  const version = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchRows = useCallback(async (append = false, override?: QueryState) => {
    setLoading(true); setError(null)
    try {
      const result = dataMode === 'client' && !append ? await loadAllRows(client, kind, override ?? query) : await loadRows(client, kind, override ?? query)
      setRows(current => append ? [...current, ...result.rows] : result.rows)
      setNextCursor(result.nextCursor)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Data could not be loaded.') }
    finally { setLoading(false) }
  }, [client, dataMode, kind, query])

  useEffect(() => {
    let active = true
    // Resets every tab-scoped piece of state before the new tab loads. React's
    // preferred alternative is remounting via a `key`, which this screen cannot
    // use yet because the cursor/grid-state refs must survive a tab switch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDenied(false); setRows([]); setFilters({}); setActiveFilters({}); setSetFiltersState({}); setDetail(null); setUndoStack([]); setLoading(true)
    void (async () => {
      try {
        const allowedChannels = await probeAccess(client)
        if (active) setChannels(allowedChannels)
        const cached = localStorage.getItem(`db-data-admin:${kind}`)
        const remote = await loadGridState(client, kind)
        const restored = { ...initialQuery, ...(cached ? JSON.parse(cached) : {}), ...(remote?.state ?? {}) }
        version.current = remote?.version ?? 0
        if (active) { setQuery(restored); await fetchRows(false, restored) }
      } catch (cause) {
        if (!active) return
        const message = cause instanceof Error ? cause.message : ''
        if (/permission|administrator|access/i.test(message)) setDenied(true); else setError(message || 'Data could not be loaded.')
        setLoading(false)
      }
    })()
    return () => { active = false }
  // fetchRows intentionally excluded: this effect resets when the tab changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, kind])

  const updateQuery = (patch: Partial<QueryState>) => {
    const next = { ...query, ...patch, cursor: null }
    setQuery(next); localStorage.setItem(`db-data-admin:${kind}`, JSON.stringify(next))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveGridState(client, kind, next, version.current).then(result => { version.current = result?.version ?? version.current + 1 }).catch(() => setError('Your saved view changed elsewhere. Reload to use the newest version.')), 500)
  }

  const updateFilter = useCallback((prop: string, value: string) => setFilters(current => {
    const next = { ...current, [prop]: value }
    if (filterTimer.current) clearTimeout(filterTimer.current)
    filterTimer.current = setTimeout(() => setActiveFilters(next), 300)
    return next
  }), [])

  const updateSetFilter = useCallback((prop: string, selected: Set<string> | null) => {
    setSetFiltersState(current => ({ ...current, [prop]: selected }))
  }, [])

  const distinctValues = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const column of baseColumns) {
      const prop = String(column.prop)
      map[prop] = getDistinctColumnValues(rows, prop)
    }
    return map
  }, [rows])

  const columns = useMemo(
    () => baseColumns
      .filter(column => kind === 'customer' || column.prop !== 'plm_display')
      .map(column => ({
        ...column,
        readonly: !INLINE_EDITABLE_PROPS.has(String(column.prop)),
        columnTemplate: Template(FilterHeader, {
          filters,
          onFilter: updateFilter,
          setFilters: setFiltersState,
          onSetFilter: updateSetFilter,
          distinctValues,
          scope: kind,
          key: `${kind}-${String(column.prop)}`,
        }),
      })),
    [distinctValues, filters, kind, setFiltersState, updateFilter, updateSetFilter],
  )

  const visibleRows = useMemo(
    () => rows
      .filter(row => rowMatchesFilters(row, activeFilters, setFiltersState))
      .map(row => ({
        ...row,
        name_display: getCellDisplayValue(row, 'name_display'),
        plm_display: getCellDisplayValue(row, 'plm_display'),
      })),
    [rows, activeFilters, setFiltersState],
  )

  const openDetail = async (row: AdminRow) => {
    setDetailLoading(true); setAudit([]); setDetail({ ...row, name: row.display_name ?? row.name })
    try {
      const [loadedDetail, loadedAudit] = await Promise.all([loadDetail(client, kind, row.id), loadAudit(client, kind, row.id)])
      setDetail({ ...row, ...loadedDetail, name: row.display_name ?? row.name }); setAudit(loadedAudit)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Details could not be loaded.') }
    finally { setDetailLoading(false) }
  }

  const saveRecord = async (input: UpdateInput) => {
    if (!detail) throw new Error('No record is selected.')
    const result = await updateRecord(client, kind, String(detail.id), input)
    if (result.success && result.row) {
      setRows(current => current.map(row => row.id === result.row?.id ? { ...row, ...result.row } : row))
      setDetail(current => current ? { ...current, ...result.row, name: result.row?.display_name ?? result.row?.name } : current)
      setAudit(await loadAudit(client, kind, String(detail.id)))
    }
    return result
  }

  // Stale-token recovery: re-fetch the record's fresh detail (new updated_at)
  // and remount the editor so the next save carries the current concurrency
  // token instead of the stale one that was loudly rejected.
  const reloadRecord = async () => {
    if (!detail) return
    await openDetail(detail as AdminRow)
    setEditorReloadKey(key => key + 1)
  }

  // Refresh grid/detail/audit but leave the MergeDialog open so its persistent
  // success receipt (audit ID + final survivor) stays visible until dismissed.
  const mergeComplete = (result: MergeResult, loserId: string) => {
    setRows(current => current.filter(row => row.id !== loserId).map(row => row.id === result.survivor?.id ? { ...row, ...result.survivor } : row))
    setDetail(current => current && result.survivor ? { ...current, ...result.survivor, name: result.survivor.display_name ?? result.survivor.name } : current)
    if (detail) void loadAudit(client, kind, String(detail.id)).then(setAudit)
  }

  const persistInlineChanges = async (
    pending: Array<{ row: AdminRow; changes: Record<string, unknown> }>,
    options: { recordHistory?: boolean; reason?: string; allowOutsideEditMode?: boolean } = {},
  ) => {
    if ((!inlineEditing && !options.allowOutsideEditMode) || pending.length === 0) return false
    const inverse: UndoStep = pending.map(({ row, changes }) => ({
      id: row.id,
      changes: Object.fromEntries(
        Object.keys(changes)
          .filter(prop => INLINE_EDITABLE_PROPS.has(prop))
          .map(prop => [prop, row[prop]]),
      ),
    })).filter(entry => Object.keys(entry.changes).length > 0)
    setInlineSaving(count => count + pending.length)
    setInlineMessage(null)
    try {
      const savedRows = await Promise.all(pending.map(({ row, changes }) =>
        saveInlineRow(
          kind,
          row,
          changes,
          (entityKind, id, input) => updateRecord(client, entityKind, id, input),
          options.reason ?? INLINE_EDIT_REASON,
        ),
      ))
      const byId = new Map(savedRows.map(row => [row.id, row]))
      setRows(current => current.map(row => byId.has(row.id) ? { ...row, ...byId.get(row.id) } : row))
      if (options.recordHistory !== false && inverse.length > 0) {
        setUndoStack(current => [...current, inverse].slice(-10))
      }
      setInlineMessage(`${savedRows.length} ${savedRows.length === 1 ? 'row' : 'rows'} saved`)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The table change was not saved.')
      await fetchRows()
      setUndoStack([])
      return false
    } finally {
      setInlineSaving(count => Math.max(0, count - pending.length))
    }
  }

  const undoLastInlineEdit = async () => {
    const step = undoStack.at(-1)
    if (!step) return
    const pending = step.flatMap(({ id, changes }) => {
      const row = rows.find(candidate => candidate.id === id)
      return row ? [{ row, changes }] : []
    })
    if (pending.length !== step.length) {
      setError('Undo history no longer matches the loaded rows. Refresh the table.')
      setUndoStack([])
      return
    }
    const restored = await persistInlineChanges(pending, {
      recordHistory: false,
      reason: INLINE_UNDO_REASON,
      allowOutsideEditMode: true,
    })
    if (restored) {
      setUndoStack(current => current.slice(0, -1))
      setInlineMessage(`Last edit undone. ${Math.max(0, undoStack.length - 1)} undo ${undoStack.length - 1 === 1 ? 'step' : 'steps'} left`)
    }
  }

  const handleInlineCellEdit = (event: CustomEvent<BeforeSaveDataDetails>) => {
    event.preventDefault()
    if (!inlineEditing) return
    const row = event.detail.model as AdminRow
    void persistInlineChanges([{ row, changes: { [String(event.detail.prop)]: event.detail.val } }])
  }

  const handleInlineRangeEdit = (event: CustomEvent<BeforeRangeSaveDataDetails>) => {
    event.preventDefault()
    if (!inlineEditing) return
    const pending = Object.entries(event.detail.data).flatMap(([index, changes]) => {
      const row = event.detail.models[Number(index)] as AdminRow | undefined
      return row ? [{ row, changes: changes as Record<string, unknown> }] : []
    })
    void persistInlineChanges(pending)
  }

  // The Customers/Vendors screens require the `administrator` gate. Product Depth
  // deliberately does NOT — owner decision 1 on issue #597 opens
  // it to the shared Designer role as well. So a denial on the entity probe must not
  // hide the whole application: the tab strip stays, and the denial is scoped to the
  // section that actually refused. (Before this, a Designer saw a bare "Access denied"
  // page and could never reach the screen they were granted.)
  return <section className="workspace">
    <div className="workspace-bar"><div><strong>{email}</strong><span>{environmentLabel}</span></div><button className="secondary" onClick={onSignOut}><LogOut /> Sign out</button></div>
    <nav className="tabs" aria-label="Data type">
      <button className={section === 'entity' && kind === 'customer' ? 'active' : ''} onClick={() => { setSection('entity'); setKind('customer') }}>Customers</button>
      <button className={section === 'entity' && kind === 'vendor' ? 'active' : ''} onClick={() => { setSection('entity'); setKind('vendor') }}>Vendors</button>
      <button className={section === 'scraped-property' ? 'active' : ''} onClick={() => setSection('scraped-property')}>Scraped Properties</button>
      <button className={section === 'property-match' ? 'active' : ''} onClick={() => setSection('property-match')}>Property Matching</button>
      <button className={section === 'product-depth' ? 'active' : ''} onClick={() => setSection('product-depth')}>Product Depth</button>
      <button className={section === 'property-status' ? 'active' : ''} onClick={() => setSection('property-status')}>Property Status</button>
    </nav>
    {section === 'property-status'
      ? <PropertyTable client={client} />
      : section === 'product-depth'
      ? <ProductDepthTable client={client} />
      : section === 'property-match'
      ? <PropertyMatchReview client={client} />
      : section === 'scraped-property'
      ? <ScrapedPropertiesTable client={client} />
      : denied
      ? <section className="access-denied" role="alert"><h1>Access denied</h1><p>You are signed in, but this screen requires an active Administrator grant.</p><button className="secondary" onClick={onSignOut}><LogOut /> Sign out</button></section>
      : <>
    <div className="controls">
      <label className="search"><Search /><span className="sr-only">Search</span><input placeholder={`Search ${kind}s`} value={query.search} onChange={e => updateQuery({ search: e.target.value })} onKeyDown={e => e.key === 'Enter' && void fetchRows()} /></label>
      <select aria-label="Canonical status" value={query.status} onChange={e => updateQuery({ status: e.target.value })}><option value="">All statuses</option><option>active</option><option>inactive</option></select>
      <select aria-label="Application" value={query.app} onChange={e => updateQuery({ app: e.target.value })}><option value="">All apps</option><option value="crm">CRM</option><option value="pm">PM/PIM</option><option value="dam">DAM</option>{kind === 'customer' && <option value="plm">PLM</option>}</select>
      <select aria-label="Application status" value={query.appStatus} onChange={e => updateQuery({ appStatus: e.target.value })}><option value="">Any app status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
      {kind === 'customer' && <select aria-label="Channel" value={query.channelId} onChange={e => updateQuery({ channelId: e.target.value })}><option value="">All channels</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select>}
      <select aria-label="Data mode" value={dataMode} onChange={e => setDataMode(e.target.value as 'client' | 'server')}><option value="client">Client mode (&lt;5,000)</option><option value="server">Server mode</option></select>
      <label className="check"><input type="checkbox" checked={query.includeInactive} onChange={e => updateQuery({ includeInactive: e.target.checked })} /> Include inactive</label>
      <button
        className={inlineEditing ? 'primary inline-edit-toggle active' : 'secondary inline-edit-toggle'}
        onClick={() => {
          setInlineEditing(current => {
            const next = !current
            setInlineMessage(next ? 'Edit mode is on. Double-click a cell, paste, or drag the fill handle.' : null)
            if (next) { setDetail(null); setEditing(false); setMerging(false) }
            return next
          })
        }}
      >
        {inlineEditing ? <Check /> : <Pencil />}
        {inlineEditing ? 'Done editing' : 'Edit table'}
      </button>
      <button
        className="icon-button"
        aria-label="Undo last table edit"
        title={`Undo last table edit${undoStack.length ? ` (${undoStack.length} available)` : ''}`}
        disabled={undoStack.length === 0 || inlineSaving > 0}
        onClick={() => void undoLastInlineEdit()}
      >
        <Undo2 />
      </button>
      <button
        className="icon-button"
        aria-label="Refresh table"
        title="Refresh table"
        onClick={() => { setUndoStack([]); void fetchRows() }}
      >
        <RefreshCw />
      </button>
    </div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    {(inlineMessage || inlineSaving > 0) && <div className="inline-edit-message" role="status">{inlineSaving ? 'Saving changes…' : inlineMessage}</div>}
    <div className={`grid-wrap${inlineEditing ? ' editing' : ''}`} aria-busy={loading || inlineSaving > 0}>
      <RevoGrid
        theme="material"
        readonly={!inlineEditing || inlineSaving > 0}
        accessible
        resize
        range
        editors={gridEditors}
        columns={columns}
        source={visibleRows}
        rowHeaders
        onBeforeedit={handleInlineCellEdit}
        onBeforerangeedit={handleInlineRangeEdit}
        onBeforecellfocus={(event) => {
          if (inlineEditing) return
          const row = visibleRows[event.detail.rowIndex]
          if (row) void openDetail(row)
        }}
      />
      {loading && <div className="grid-loading">Loading…</div>}
    </div>
    <footer className="grid-footer"><span>{visibleRows.length} loaded</span>{nextCursor && <button className="secondary" disabled={loading} onClick={() => { const next = { ...query, cursor: nextCursor }; setQuery(next); void fetchRows(true, next) }}>Load more <ChevronRight /></button>}</footer>
    {detail && <aside className="detail-panel" aria-label={`${kind} details`}><button className="close" aria-label="Close details" onClick={() => { setDetail(null); setEditing(false); setMerging(false) }}><X /></button><h2>{String(detail.name ?? 'Details')}</h2><div className="detail-actions"><button className="primary edit-button" onClick={() => setEditing(true)}><Pencil /> Edit record</button><button className="secondary" onClick={() => setMerging(true)}><GitMerge /> Merge duplicate</button></div>{detailLoading ? <p>Loading details…</p> : <><h3>Aliases</h3><pre>{JSON.stringify(detail.aliases ?? [], null, 2)}</pre><h3>Source references</h3><pre>{JSON.stringify(detail.source_refs ?? [], null, 2)}</pre><h3 className="history-heading"><History /> Audit history</h3>{audit.length === 0 ? <p className="muted">No audited changes yet.</p> : <ol className="audit-list">{audit.map(event => <li key={event.id} className={event.succeeded ? '' : 'failed'}><strong>{event.succeeded ? event.action === 'merge' ? 'Records merged' : 'Change saved' : `Failed: ${event.error_code}`}</strong><span>{new Date(event.occurred_at).toLocaleString()} · {event.actor_label ?? 'Administrator'}</span><p>{event.reason}</p></li>)}</ol>}</>}</aside>}
    {editing && detail && <RecordEditor key={editorReloadKey} kind={kind} row={detail as AdminRow} channels={channels} onCancel={() => setEditing(false)} onSave={saveRecord} onReload={() => void reloadRecord()} />}
    {merging && detail && <MergeDialog kind={kind} survivor={detail as AdminRow} candidates={rows.filter(row => row.id !== detail.id)} onCancel={() => setMerging(false)} onPreview={loserId => previewMerge(client, kind, String(detail.id), loserId)} onMerge={(loserId, token, reason, resolutions) => executeMerge(client, kind, String(detail.id), loserId, token, reason, resolutions)} onMerged={mergeComplete} onSearchCandidates={term => searchMergeCandidates(client, kind, term, String(detail.id))} />}
    </>}
  </section>
}
